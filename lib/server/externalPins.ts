import "server-only";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import exifr from "exifr";
import { getSupabaseAdmin } from "./supabaseAdmin";
import { r2Put, r2PublicUrl, r2DeleteAll } from "./r2";
import { serverEnv } from "./env";
import { resolveTakenAt, timezoneAt } from "@/lib/time";
import { aiEnrich, splitStoryHashtags } from "./ai";
import { GEMINI_MAX_TIMEOUT_MS } from "./gemini";

/** Photographer for planner pins when the payload has none (override with EXTERNAL_DEFAULT_PHOTOGRAPHER) */
const DEFAULT_PHOTOGRAPHER = "Max Bihovskiy";

export const EXTERNAL_SOURCE = "maxbi-planner";
const MAX_IMAGES = 10;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;
/** Total function budget (env FUNCTION_TIMEOUT_MS, default Netlify's 26s sync limit) */
const FUNCTION_TIMEOUT_MS = Number(process.env.FUNCTION_TIMEOUT_MS) || 26_000;
/** Time kept free for the R2 upload + Supabase insert after the AI step */
const RESERVE_MS = 6_000;
const MIN_AI_BUDGET_MS = 1_500;

/** שגיאה עם קוד HTTP, נזרקת מהלוגיקה ומתורגמת לתשובה ב-route */
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// ולידציה של גוף הבקשה
// ---------------------------------------------------------------------------

export interface PublishInput {
  images: string[];
  lat: number;
  lng: number;
  locationName: string | null;
  capturedAt: string | null;
  exif: {
    camera: string | null;
    lens: string | null;
    aperture: number | null;
    shutter: string | null;
    iso: number | null;
    focalLength: number | null;
  };
  story: string | null;
  /** Optional field notes; when given they win over the AI-extracted ones */
  accessInfo: string | null;
  permitInfo: string | null;
  /** אופציונליים: */
  title: string | null;
  photographerName: string | null;
  tags: string[];
  postId: string | null;
}

const str = (v: unknown, max: number): string | null => {
  if (v == null) return null;
  if (typeof v !== "string") throw new HttpError(400, "Expected string field");
  const s = v.trim();
  if (s.length > max) throw new HttpError(400, `Field too long (max ${max} chars)`);
  return s || null;
};

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    // "f/2.8" → 2.8, "35mm" → 35, "ISO 400" → 400
    const m = v.replace(",", ".").match(/-?\d+(\.\d+)?/);
    return m ? Number(m[0]) : null;
  }
  return null;
};

export function parsePublishBody(raw: unknown): PublishInput {
  if (!raw || typeof raw !== "object") throw new HttpError(400, "Body must be a JSON object");
  const b = raw as Record<string, unknown>;

  if (!Array.isArray(b.images) || b.images.length === 0) {
    throw new HttpError(400, "`images` must be a non-empty array of URLs");
  }
  if (b.images.length > MAX_IMAGES) throw new HttpError(400, `Too many images (max ${MAX_IMAGES})`);
  const images = b.images.map((u, i) => {
    if (typeof u !== "string") throw new HttpError(400, `images[${i}] must be a string URL`);
    return u.trim();
  });

  const lat = num(b.lat);
  const lng = num(b.lng);
  if (lat == null || lat < -90 || lat > 90) throw new HttpError(400, "`lat` must be a number between -90 and 90");
  if (lng == null || lng < -180 || lng > 180) throw new HttpError(400, "`lng` must be a number between -180 and 180");

  // "2024-03-22T19:08:00+01:00" / "...Z" → exact instant.
  // "2024-03-22T19:08:00" (no offset) → wall-clock time at the pin's location, resolved later.
  let capturedAt: string | null = null;
  if (b.capturedAt != null && b.capturedAt !== "") {
    const raw = String(b.capturedAt).trim().replace(" ", "T");
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) throw new HttpError(400, "`capturedAt` is not a valid date");
    capturedAt = /(Z|[+-]\d{2}:?\d{2})$/i.test(raw) ? d.toISOString() : raw.slice(0, 19);
  }

  const e = (b.exif && typeof b.exif === "object" ? b.exif : {}) as Record<string, unknown>;
  const shutterRaw = e.shutter ?? e.shutterSpeed;
  const iso = num(e.iso);

  if (b.tags != null && !Array.isArray(b.tags)) throw new HttpError(400, "`tags` must be an array of strings");
  const tags = Array.isArray(b.tags) ? b.tags.filter((t): t is string => typeof t === "string").slice(0, 30) : [];

  return {
    images,
    lat,
    lng,
    locationName: str(b.locationName, 200),
    capturedAt,
    exif: {
      camera: str(e.camera, 120),
      lens: str(e.lens, 160),
      aperture: num(e.aperture),
      shutter: shutterRaw == null ? null : str(String(shutterRaw), 20),
      iso: iso == null ? null : Math.round(iso),
      focalLength: num(e.focalLength ?? e.focal_length),
    },
    story: str(b.story, 10_000),
    accessInfo: str(b.accessInfo, 600),
    permitInfo: str(b.permitInfo, 600),
    title: str(b.title, 200),
    photographerName: str(b.photographerName, 120),
    tags, // merged with AI + story hashtags and sanitized in createExternalPin
    postId: b.postId == null ? null : str(String(b.postId), 200),
  };
}

// ---------------------------------------------------------------------------
// הורדת תמונה ועיבוד
// ---------------------------------------------------------------------------

async function downloadImage(url: string): Promise<Buffer> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new HttpError(400, `Invalid image URL: ${url}`);
  }
  if (u.protocol !== "https:") throw new HttpError(400, `Image URL must be https: ${url}`);

  const allow = serverEnv.imageHostAllowlist();
  const host = u.hostname.toLowerCase();
  if (allow.length && !allow.some((h) => host === h || host.endsWith(`.${h}`))) {
    throw new HttpError(400, `Image host not allowed: ${host}`);
  }

  let res: Response;
  try {
    res = await fetch(u, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: "follow" });
  } catch (err) {
    throw new HttpError(422, `Could not download image ${url}: ${(err as Error).message}`);
  }
  if (!res.ok) throw new HttpError(422, `Could not download image ${url}: HTTP ${res.status}`);

  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_IMAGE_BYTES) throw new HttpError(413, `Image too large: ${url}`);

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_IMAGE_BYTES) throw new HttpError(413, `Image too large: ${url}`);
  return buf;
}

interface Processed {
  main: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
}

/** Long edge of the stored main image (4K); smaller images are never upscaled */
export const MAIN_MAX_EDGE = 3840;
/** Originals up to this size can be stored byte-for-byte */
const PASSTHROUGH_MAX_BYTES = 20 * 1024 * 1024;

/** Main image: photographic quality. Full chroma (4:4:4), sRGB profile embedded, no other metadata (no GPS). */
const MAIN_JPEG = { quality: 92, mozjpeg: true, chromaSubsampling: "4:4:4", progressive: true } as const;

/**
 * Main image up to 3840px at JPEG q92 4:4:4 + a 480px thumbnail (map pins and the Gemini call only).
 * A JPEG that is already web-ready (≤3840px, upright, no GPS in its EXIF, ≤20MB) is stored as is:
 * re-encoding can only lose detail. Otherwise it is re-encoded, which drops EXIF (incl. GPS) from
 * the public file; the EXIF values that matter are kept in the DB.
 */
export async function processImage(input: Buffer, url: string): Promise<Processed> {
  try {
    const meta = await sharp(input, { failOn: "error" }).metadata();
    const w = meta.autoOrient?.width ?? meta.width ?? 0;
    const h = meta.autoOrient?.height ?? meta.height ?? 0;
    const base = sharp(input, { failOn: "error" }).rotate(); // apply EXIF Orientation

    const thumb = await base
      .clone()
      .resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true })
      .withIccProfile("srgb")
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer();

    if (await canStoreOriginal(input, meta, w, h)) {
      return { main: input, thumb, width: w, height: h };
    }

    const { data: main, info } = await base
      .clone()
      .resize({ width: MAIN_MAX_EDGE, height: MAIN_MAX_EDGE, fit: "inside", withoutEnlargement: true, kernel: "lanczos3" })
      .withIccProfile("srgb") // convert to sRGB and embed the profile: colors match on every screen
      .jpeg(MAIN_JPEG)
      .toBuffer({ resolveWithObject: true });
    return { main, thumb, width: info.width, height: info.height };
  } catch {
    throw new HttpError(422, `File is not a supported image: ${url}`);
  }
}

async function canStoreOriginal(input: Buffer, meta: sharp.Metadata, w: number, h: number): Promise<boolean> {
  if (meta.format !== "jpeg" || input.byteLength > PASSTHROUGH_MAX_BYTES) return false;
  if (Math.max(w, h) > MAIN_MAX_EDGE) return false;
  if (meta.orientation && meta.orientation !== 1) return false; // browsers would show it rotated
  if (meta.space && meta.space !== "srgb") return false; // CMYK etc.
  if (!meta.exif) return true;
  try {
    // Never publish a file that still carries GPS
    const gps = await exifr.gps(input);
    return !(gps && Number.isFinite(gps.latitude) && Number.isFinite(gps.longitude));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// יצירה ומחיקה
// ---------------------------------------------------------------------------

export function buildPinUrl(pinId: string, req: Request): string {
  // בלי דומיין קשיח: NEXT_PUBLIC_SITE_URL, ואם חסר, הדומיין שהבקשה הגיעה אליו
  const base = (process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin).replace(/\/+$/, "");
  return `${base}/?pin=${encodeURIComponent(pinId)}`;
}

export interface CreatedPin {
  pinId: string;
  existing: boolean;
  title: string | null;
  tags: string[];
  /** What the AI pipeline actually did (false = skipped or failed, pin still created) */
  ai: { translated: boolean; titleGenerated: boolean; tagged: boolean };
}

export async function createExternalPin(input: PublishInput): Promise<CreatedPin> {
  const startedAt = Date.now();
  const db = getSupabaseAdmin();

  // ניסיון חוזר עם אותו postId: מחזירים את הסיכה הקיימת במקום ליצור כפילות
  if (input.postId) {
    const { data } = await db
      .from("photos")
      .select("id, title, tags")
      .eq("source", EXTERNAL_SOURCE)
      .eq("external_id", input.postId)
      .maybeSingle();
    if (data) {
      return {
        pinId: data.id as string,
        existing: true,
        title: (data.title as string | null) ?? null,
        tags: (data.tags as string[]) ?? [],
        ai: { translated: false, titleGenerated: false, tagged: false },
      };
    }
  }

  // הורדה ועיבוד במקביל; כל כשל עוצר לפני שנכתב משהו
  const processed = await Promise.all(
    input.images.map(async (url) => processImage(await downloadImage(url), url)),
  );

  const ownerId = serverEnv.publishUserId();
  const photographer = input.photographerName || process.env.EXTERNAL_DEFAULT_PHOTOGRAPHER || DEFAULT_PHOTOGRAPHER;
  const isWall = input.capturedAt != null && !input.capturedAt.endsWith("Z");
  const taken = isWall
    ? resolveTakenAt(input.capturedAt, null, input.lat, input.lng)
    : { taken_at: input.capturedAt, taken_tz: timezoneAt(input.lat, input.lng) };

  // --- Same AI pipeline as browser uploads (runs in parallel, never blocks the pin) ---
  // Hashtags at the end of a social post become tags, not story text
  // allSettled + per-step fallback: a Gemini error (404 model, 429, timeout, bad JSON)
  // never fails the request. The pin is saved with the original title/story and time-based tags.
  let storyText = input.story;
  let hashtags: string[] = [];
  try {
    ({ text: storyText, hashtags } = splitStoryHashtags(input.story));
  } catch (err) {
    console.error("[external-publish] hashtag split failed, keeping story as is:", err);
  }
  const thumbB64 = processed[0].thumb.toString("base64");
  // ONE combined Gemini call (tags + title + translation) on the 480px thumbnail only.
  // Budget: never let a slow call eat the time needed for the R2 upload + Supabase insert.
  const remaining = FUNCTION_TIMEOUT_MS - (Date.now() - startedAt) - RESERVE_MS;
  const aiBudget = Math.min(GEMINI_MAX_TIMEOUT_MS, remaining);
  const enriched = await aiEnrich(
    {
      imageB64: aiBudget >= MIN_AI_BUDGET_MS ? thumbB64 : null, // null image => Gemini skipped, fallback used
      takenAt: taken.taken_at,
      lat: input.lat,
      lng: input.lng,
      locationName: input.locationName,
      title: input.title,
      story: storyText,
    },
    [...input.tags, ...hashtags],
    Math.max(aiBudget, MIN_AI_BUDGET_MS),
  );

  const story = enriched.story?.trim() || storyText || null;
  const title = enriched.title;
  const tags = enriched.tags;
  const translation = { translated: enriched.translated };
  const generatedTitle = enriched.titleGenerated ? title : null;
  const tagged = { ai: enriched.tagged };

  const pinId = randomUUID();
  const prefix = `pins/${pinId}/`;
  const keys: string[] = [];

  try {
    await Promise.all(
      processed.flatMap((p, i) => {
        const mainKey = `${prefix}${i}.jpg`;
        const thumbKey = `${prefix}${i}_thumb.jpg`;
        keys.push(mainKey, thumbKey);
        return [r2Put(mainKey, p.main), r2Put(thumbKey, p.thumb)];
      }),
    );

    const imageUrls = processed.map((_, i) => r2PublicUrl(`${prefix}${i}.jpg`));

    const { error } = await db.from("photos").insert({
      id: pinId,
      user_id: ownerId,
      photographer_name: photographer,
      taken_tz: taken.taken_tz,
      title,
      description: null,
      story,
      access_info: input.accessInfo ?? enriched.accessInfo,
      permit_info: input.permitInfo ?? enriched.permitInfo,
      storage_provider: "r2",
      storage_path: `${prefix}0.jpg`,
      storage_keys: keys,
      photo_url: imageUrls[0],
      thumb_url: r2PublicUrl(`${prefix}0_thumb.jpg`),
      image_urls: imageUrls,
      latitude: input.lat,
      longitude: input.lng,
      is_manual_location: false,
      location_name: input.locationName,
      taken_at: taken.taken_at,
      camera_make: null,
      camera_model: input.exif.camera,
      lens: input.exif.lens,
      focal_length: input.exif.focalLength,
      aperture: input.exif.aperture,
      shutter_speed: input.exif.shutter,
      iso: input.exif.iso,
      width: processed[0].width,
      height: processed[0].height,
      tags,
      is_private: false,
      source: EXTERNAL_SOURCE,
      external_id: input.postId,
    });
    if (error) throw new HttpError(500, `Database insert failed: ${error.message}`);

    return {
      pinId,
      existing: false,
      title,
      tags,
      ai: { translated: translation.translated, titleGenerated: generatedTitle != null, tagged: tagged.ai },
    };
  } catch (err) {
    // לא להשאיר קבצים יתומים ב-R2
    await r2DeleteAll(keys, prefix).catch(() => {});
    throw err;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * מוחק סיכה שנוצרה ע"י ה-Planner + כל הקבצים שלה ב-R2.
 * סיכות שהועלו ידנית באפליקציה לא נמחקות דרך ה-API הזה (מחזיר 404).
 */
export async function deleteExternalPin(pinId: string | null): Promise<void> {
  if (!pinId || !UUID_RE.test(pinId)) throw new HttpError(400, "`pinId` must be a valid pin id");
  const db = getSupabaseAdmin();

  const { data: pin, error } = await db
    .from("photos")
    .select("id, storage_keys")
    .eq("id", pinId)
    .eq("source", EXTERNAL_SOURCE)
    .maybeSingle();
  if (error) throw new HttpError(500, `Database lookup failed: ${error.message}`);
  if (!pin) throw new HttpError(404, "Pin not found");

  // קודם הקבצים, אחר כך השורה: אם R2 נכשל, הסיכה נשארת ואפשר לנסות שוב
  await r2DeleteAll((pin.storage_keys as string[]) ?? [], `pins/${pinId}/`);

  const { error: delErr } = await db.from("photos").delete().eq("id", pinId);
  if (delErr) throw new HttpError(500, `Database delete failed: ${delErr.message}`);
}
