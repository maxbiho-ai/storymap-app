/**
 * StoryMap archive importer: bulk-import the edited camera photos of a Lightroom trip folder.
 *
 *   npm run import:trip -- --dir "D:\Photki\איסלנד" --dry-run
 *   npm run import:trip -- --dir "D:\Photki\איסלנד" --ai --limit=20
 *
 * SAFETY: the archive is only ever READ (readdir / stat / read). Nothing is written, moved,
 * renamed or deleted on disk. All output goes to Supabase Storage + the photos table.
 *
 * Flags
 *   --dir <path>          trip folder to scan recursively (required)
 *   --dry-run             print what would happen (matches, keys, GPS tier, place); upload nothing
 *   --force               re-upload even if the source file is unchanged
 *   --limit=<n>           process only the first n matched photos
 *   --ai                  Gemini title + tags (no story), ~4s pacing, retry with backoff on 429
 *   --max-mb=<n>          size target for the stored main file (default 1.5, 0 = off: 3840px q92 4:4:4)
 *   --allow-faces         import photos with recognizable human faces too (skipped by default)
 *   --prune-faces         audit pins already imported from --dir for recognizable faces; with --dry-run only lists them,
 *                         otherwise deletes the flagged pins (row + image + thumbnail)
 *   --timelapse-hero      import the middle frame of each timelapse / sequence folder (#timelapse); folders are skipped otherwise
 *   --include-flights     import Flight / Ben Gurion folders at the arrival airport + #flight #aerial
 *   --country=<name>      country when it can't be read from the folder names (e.g. "Norway")
 *   --email=<address>     owner account (default maxbiho@gmail.com)
 *   --owner-id=<uuid>     owner by id instead of email
 */
import { createHash, randomUUID } from "node:crypto";
import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import exifr from "exifr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { aiEnrich, sanitizeTags, timeBasedTags } from "@/lib/server/ai";
import { geminiJson } from "@/lib/server/gemini";
import { resolveTakenAt } from "@/lib/time";
import {
  COUNTRIES,
  detectCountry,
  detectTimelapse,
  timelapseHero,
  placeFromFolders,
  scanArchive,
  walk,
  type Candidate,
  type Country,
  type ScanFile,
} from "./lib/archive";

// ---------------------------------------------------------------------------
// CLI + env
// ---------------------------------------------------------------------------

interface Args {
  dir: string;
  dryRun: boolean;
  force: boolean;
  limit: number;
  ai: boolean;
  maxMb: number;
  includeFlights: boolean;
  allowFaces: boolean;
  timelapseHero: boolean;
  pruneFaces: boolean;
  country: string | null;
  email: string;
  ownerId: string | null;
}

function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq > 0) flags.set(a.slice(2, eq), a.slice(eq + 1));
    else if (argv[i + 1] && !argv[i + 1].startsWith("--") && !BOOL_FLAGS.has(a.slice(2))) flags.set(a.slice(2), argv[++i]);
    else flags.set(a.slice(2), true);
  }
  const str = (k: string) => (typeof flags.get(k) === "string" ? (flags.get(k) as string) : null);
  const dir = str("dir");
  if (!dir) fail('Missing --dir. Example: npm run import:trip -- --dir "D:\\Photki\\Iceland" --dry-run');
  const limit = Number(str("limit") ?? 0);
  const maxMb = str("max-mb") == null ? 1.5 : Number(str("max-mb"));
  if (!Number.isFinite(limit) || limit < 0) fail("--limit must be a positive number");
  if (!Number.isFinite(maxMb) || maxMb < 0) fail("--max-mb must be a number (0 = off)");
  return {
    dir: dir!,
    dryRun: flags.has("dry-run"),
    force: flags.has("force"),
    limit,
    ai: flags.has("ai"),
    maxMb,
    includeFlights: flags.has("include-flights"),
    allowFaces: flags.has("allow-faces"),
    timelapseHero: flags.has("timelapse-hero"),
    pruneFaces: flags.has("prune-faces"),
    country: str("country"),
    email: str("email") ?? "maxbiho@gmail.com",
    ownerId: str("owner-id"),
  };
}
const BOOL_FLAGS = new Set(["dry-run", "force", "ai", "include-flights", "allow-faces", "timelapse-hero", "prune-faces"]);

function fail(msg: string): never {
  console.error(`\n✖ ${msg}`);
  process.exit(1);
}

/** Minimal .env loader (tsx does not read .env files) */
function loadEnv(): void {
  for (const name of [".env.local", ".env"]) {
    let text: string;
    try {
      text = readFileSync(path.resolve(process.cwd(), name), "utf8");
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (!m || process.env[m[1]] !== undefined) continue;
      process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// EXIF
// ---------------------------------------------------------------------------

interface Exif {
  lat: number | null;
  lng: number | null;
  wall: string | null; // camera wall clock "YYYY-MM-DDTHH:MM:SS"
  offset: string | null;
  make: string | null;
  model: string | null;
  lens: string | null;
  focal: number | null;
  aperture: number | null;
  shutter: string | null;
  iso: number | null;
}

const EMPTY_EXIF: Exif = { lat: null, lng: null, wall: null, offset: null, make: null, model: null, lens: null, focal: null, aperture: null, shutter: null, iso: null };

const exifCache = new Map<string, Exif>();

function wallClock(d: unknown): string | null {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
const cleanStr = (v: unknown) => (typeof v === "string" && v.replace(/\0/g, "").trim() ? v.replace(/\0/g, "").trim() : null);
const finite = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
function shutterText(s: number | null): string | null {
  if (!s || s <= 0) return null;
  return s >= 1 ? `${Number(s.toFixed(1))}s` : `1/${Math.round(1 / s)}`;
}

async function readExif(file: ScanFile): Promise<Exif> {
  const hit = exifCache.get(file.abs);
  if (hit) return hit;
  let out = EMPTY_EXIF;
  try {
    const d = await exifr.parse(file.abs, {
      gps: true,
      tiff: true,
      exif: true,
      ifd1: false,
      xmp: false,
      icc: false,
      iptc: false,
      pick: ["latitude", "longitude", "DateTimeOriginal", "CreateDate", "OffsetTimeOriginal", "Make", "Model", "LensModel", "FocalLength", "FNumber", "ExposureTime", "ISO"],
    });
    if (d) {
      const lat = finite(d.latitude);
      const lng = finite(d.longitude);
      const offset = cleanStr(d.OffsetTimeOriginal);
      out = {
        lat: lat != null && lng != null && !(lat === 0 && lng === 0) ? lat : null,
        lng: lat != null && lng != null && !(lat === 0 && lng === 0) ? lng : null,
        wall: wallClock(d.DateTimeOriginal) ?? wallClock(d.CreateDate),
        offset: offset && /^[+-]\d{2}:\d{2}$/.test(offset) ? offset : null,
        make: cleanStr(d.Make),
        model: cleanStr(d.Model),
        lens: cleanStr(d.LensModel),
        focal: finite(d.FocalLength),
        aperture: finite(d.FNumber),
        shutter: shutterText(finite(d.ExposureTime)),
        iso: finite(d.ISO) == null ? null : Math.round(d.ISO),
      };
    }
  } catch {
    /* unreadable EXIF: treated as empty */
  }
  exifCache.set(file.abs, out);
  return out;
}

/** The export first, then older versions / originals / raws fill whatever it lacks */
async function mergedExif(c: Candidate): Promise<Exif> {
  const order = [c.file, ...[...c.siblings].sort((a, b) => b.mtimeMs - a.mtimeMs)];
  const merged: Exif = { ...EMPTY_EXIF };
  for (const f of order) {
    const e = await readExif(f);
    for (const k of Object.keys(merged) as (keyof Exif)[]) {
      if (merged[k] == null && e[k] != null) (merged as unknown as Record<string, unknown>)[k] = e[k];
    }
    if (merged.lat != null && merged.wall && merged.model) break;
  }
  // a GPS pair must come from one file
  return merged;
}

const wallMs = (w: string) => Date.parse(`${w}Z`);

// ---------------------------------------------------------------------------
// Mapbox geocoding (cached)
// ---------------------------------------------------------------------------

interface Geo {
  lat: number;
  lng: number;
  name: string;
}
const geoCache = new Map<string, Geo | null>();

async function geocode(q: string, iso: string | null): Promise<Geo | null> {
  const token = process.env.MAPBOX_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) fail("No Mapbox token: set NEXT_PUBLIC_MAPBOX_TOKEN in .env.local");
  const key = `${q}|${iso ?? ""}`;
  if (geoCache.has(key)) return geoCache.get(key)!;
  const url =
    `https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(q)}&limit=1&language=en` +
    `${iso ? `&country=${iso}` : ""}&access_token=${token}`;
  let result: Geo | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (res.status === 429) {
        await sleep(1500 * 2 ** attempt);
        continue;
      }
      if (!res.ok) break;
      const data = (await res.json()) as { features?: { geometry?: { coordinates?: [number, number] }; properties?: { name?: string; full_address?: string } }[] };
      const f = data.features?.[0];
      const c = f?.geometry?.coordinates;
      if (c && Number.isFinite(c[0]) && Number.isFinite(c[1])) result = { lat: c[1], lng: c[0], name: f?.properties?.full_address ?? f?.properties?.name ?? q };
      break;
    } catch {
      await sleep(1000 * 2 ** attempt);
    }
  }
  geoCache.set(key, result);
  return result;
}

// ---------------------------------------------------------------------------
// Location: 3 tiers
// ---------------------------------------------------------------------------

type Tier = "exif" | "phone" | "folder";
interface Located {
  lat: number;
  lng: number;
  tier: Tier;
  /** Human label used as location_name */
  name: string | null;
  /** Folder place label (title fallback) */
  label: string | null;
  note: string;
}

const phoneExifByDir = new Map<string, { file: ScanFile; exif: Exif }[]>();
const folderGeo = new Map<string, { geo: Geo | null; q: string }>();

async function phonesWithGps(dir: string, phones: Map<string, ScanFile[]>) {
  let cached = phoneExifByDir.get(dir);
  if (!cached) {
    cached = [];
    for (const f of phones.get(dir) ?? []) {
      const e = await readExif(f);
      if (e.lat != null && e.wall) cached.push({ file: f, exif: e });
    }
    phoneExifByDir.set(dir, cached);
  }
  return cached;
}

const THREE_HOURS = 3 * 3600_000;

async function locate(c: Candidate, exif: Exif, phones: Map<string, ScanFile[]>, rootAbs: string, country: Country | null): Promise<Located | null> {
  const place = placeFromFolders(c.file.relDir);
  const label = place.label && place.kind !== "flight" ? place.label : null;
  const nameFor = (spot: string | null) => [spot, country?.name].filter(Boolean).join(", ") || null;

  // Tier 1: GPS in the JPG itself (or its original / raw)
  if (exif.lat != null && exif.lng != null) {
    return { lat: exif.lat, lng: exif.lng, tier: "exif", name: nameFor(label), label, note: "EXIF GPS" };
  }

  // Tier 2: a phone photo in the same folder, taken within 3 hours
  if (exif.wall) {
    const t = wallMs(exif.wall);
    const near = (await phonesWithGps(c.file.relDir, phones))
      .map((p) => ({ p, dt: Math.abs(wallMs(p.exif.wall!) - t) }))
      .filter((x) => x.dt <= THREE_HOURS)
      .sort((a, b) => a.dt - b.dt)[0];
    if (near) {
      return { lat: near.p.exif.lat!, lng: near.p.exif.lng!, tier: "phone", name: nameFor(label), label, note: `phone ${near.p.file.name} (${Math.round(near.dt / 60000)} min)` };
    }
  }

  // Tier 3: folder names → Mapbox, one lookup per subfolder
  if (!country) return null;
  const iso = country.iso;
  const cacheKey = `${rootAbs}|${place.from}|${place.kind}`;
  let hit = folderGeo.get(cacheKey);
  if (!hit) {
    let geo: Geo | null = null;
    let used = "";
    const queries: string[] = [];
    if (place.kind === "flight") {
      queries.push(`${country.airport}, ${country.name}`);
    } else {
      // the folder itself, then each parent folder up to the trip root
      const parts = c.file.relDir ? c.file.relDir.split("/") : [];
      for (let i = parts.length; i >= 1; i--) {
        const p = placeFromFolders(parts.slice(0, i).join("/"));
        if (p.spot && p.kind !== "flight") {
          if (country.region) queries.push([p.spot, country.region, country.name].join(", "));
          queries.push([p.spot, country.name].join(", "));
        }
      }
    }
    for (const q of [...new Set(queries)]) {
      geo = await geocode(q, iso);
      if (geo) {
        used = q;
        break;
      }
    }
    hit = { geo, q: used };
    folderGeo.set(cacheKey, hit);
  }
  const { geo, q: used } = hit;
  if (!geo) return null;
  const nm = place.kind === "flight" ? `${country.airport}` : used;
  return { lat: geo.lat, lng: geo.lng, tier: "folder", name: nm, label, note: `Mapbox "${used}"` };
}

// ---------------------------------------------------------------------------
// Image pipeline
// ---------------------------------------------------------------------------

interface Encoded {
  main: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
  quality: number;
  edge: number;
}

/** 2560px for pre-2020 photos, 3840px for 2020+ (and when the date is unknown) */
function edgeFor(wall: string | null): number {
  const y = wall ? Number(wall.slice(0, 4)) : NaN;
  return Number.isFinite(y) && y < 2020 ? 2560 : 3840;
}

async function encode(buf: Buffer, wall: string | null, maxMb: number): Promise<Encoded> {
  const base = sharp(buf, { failOn: "error" }).rotate();
  const thumb = await base.clone().resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true }).withIccProfile("srgb").jpeg({ quality: 80, mozjpeg: true }).toBuffer();

  const encodeAt = (edge: number, quality: number) =>
    base
      .clone()
      .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true, kernel: "lanczos3" })
      .withIccProfile("srgb") // sRGB, and no EXIF/GPS in the public file
      .jpeg({ quality, mozjpeg: true, chromaSubsampling: "4:4:4", progressive: true })
      .toBuffer({ resolveWithObject: true });

  let edge = edgeFor(wall);
  if (maxMb <= 0) {
    const { data, info } = await encodeAt(3840, 92);
    return { main: data, thumb, width: info.width, height: info.height, quality: 92, edge: 3840 };
  }
  const limit = maxMb * 1024 * 1024;
  let last: { data: Buffer; info: sharp.OutputInfo; quality: number } | null = null;
  for (let shrink = 0; shrink < 5; shrink++) {
    for (const quality of [85, 80, 75]) {
      const r = await encodeAt(edge, quality);
      last = { ...r, quality };
      if (r.data.byteLength <= limit) return { main: r.data, thumb, width: r.info.width, height: r.info.height, quality, edge };
    }
    edge = Math.round(edge * 0.88); // still too big at q75: a slightly smaller canvas
  }
  return { main: last!.data, thumb, width: last!.info.width, height: last!.info.height, quality: last!.quality, edge };
}

// ---------------------------------------------------------------------------
// Gemini: title + tags only, paced, retried on 429
// ---------------------------------------------------------------------------

const AI_PACE_MS = 4000;
let lastAiAt = 0;

async function paceAi(): Promise<void> {
  const wait = lastAiAt + AI_PACE_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastAiAt = Date.now();
}
const isRateLimit = (msg: string) => /429|RESOURCE_EXHAUSTED|rate/i.test(msg);

/** Lightweight vision check (no --ai): true / false, or null if Gemini could not answer */
async function faceCheck(thumb: Buffer): Promise<boolean | null> {
  for (let attempt = 0; attempt < 6; attempt++) {
    await paceAi();
    try {
      const r = await geminiJson<{ hasRecognizableFaces?: boolean }>(
        [
          { inline_data: { mime_type: "image/jpeg", data: thumb.toString("base64") } },
          { text: "hasRecognizableFaces: true if the photo is a portrait, group shot, selfie or shows recognizable human faces; false for pure landscapes, wildlife, architecture, or tiny distant figures in a vast landscape." },
        ],
        { type: "OBJECT", properties: { hasRecognizableFaces: { type: "BOOLEAN" } }, required: ["hasRecognizableFaces"] },
        8000,
      );
      return typeof r.hasRecognizableFaces === "boolean" ? r.hasRecognizableFaces : null;
    } catch (err) {
      const msg = String((err as Error).message ?? err);
      if (isRateLimit(msg) && attempt < 5) {
        const backoff = Math.min(60_000, AI_PACE_MS * 2 ** (attempt + 1));
        console.log(`    Gemini rate limit, retrying in ${Math.round(backoff / 1000)}s…`);
        await sleep(backoff);
        continue;
      }
      console.warn(`    Face check failed (${msg.slice(0, 120)})`);
      return null;
    }
  }
  return null;
}

async function aiTitleTags(thumb: Buffer, takenAt: string | null, lat: number, lng: number, locationName: string | null, extra: string[], detectFaces: boolean) {
  const wait = lastAiAt + AI_PACE_MS - Date.now();
  if (wait > 0) await sleep(wait);
  for (let attempt = 0; attempt < 6; attempt++) {
    lastAiAt = Date.now();
    try {
      const r = await aiEnrich({ imageB64: thumb.toString("base64"), takenAt, lat, lng, locationName, title: null, story: null, detectFaces }, extra, 8000, { rethrow: true });
      return { title: r.titleGenerated ? r.title : null, tags: r.tags, ai: r.tagged, hasFaces: r.hasFaces };
    } catch (err) {
      const msg = String((err as Error).message ?? err);
      if (/429|RESOURCE_EXHAUSTED|rate/i.test(msg) && attempt < 5) {
        const backoff = Math.min(60_000, AI_PACE_MS * 2 ** (attempt + 1));
        console.log(`    Gemini rate limit, retrying in ${Math.round(backoff / 1000)}s…`);
        await sleep(backoff);
        continue;
      }
      console.warn(`    Gemini failed (${msg.slice(0, 120)}): using time-based tags`);
      break;
    }
  }
  return { title: null as string | null, tags: timeBasedTags({ takenAt, lat, lng }, extra).tags, ai: false, hasFaces: null as boolean | null };
}

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

const BUCKET = "photos";

interface ExistingRow {
  id: string;
  storage_path: string;
}

async function findOwner(db: SupabaseClient, args: Args): Promise<string> {
  if (args.ownerId) return args.ownerId;
  for (let page = 1; page < 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) fail(`Could not look up ${args.email}: ${error.message}`);
    const u = data.users.find((x) => x.email?.toLowerCase() === args.email.toLowerCase());
    if (u) return u.id;
    if (data.users.length < 200) break;
  }
  return fail(`No StoryMap account with the email ${args.email} (sign in once in the app first).`);
}

async function loadExisting(db: SupabaseClient, owner: string): Promise<Map<string, ExistingRow>> {
  const map = new Map<string, ExistingRow>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("photos").select("id, storage_path, source_key").eq("user_id", owner).not("source_key", "is", null).range(from, from + 999);
    if (error) {
      if (/source_key/.test(error.message)) fail("The photos.source_key column is missing: run supabase/migrations/008_archive_source_key.sql in the Supabase SQL Editor first.");
      fail(`Could not read existing photos: ${error.message}`);
    }
    for (const r of data ?? []) map.set(r.source_key as string, { id: r.id as string, storage_path: r.storage_path as string });
    if ((data?.length ?? 0) < 1000) break;
  }
  return map;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

type Action = "new" | "update" | "unchanged" | "new?" | "skip";
interface Row {
  cand: Candidate;
  action: Action;
  tier: string;
  place: string;
  note: string;
}

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Audit (and delete) already-imported pins of a trip folder that show recognizable faces */
async function pruneFaces(args: Args, tripName: string): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) fail("--prune-faces needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
  if (!process.env.GEMINI_API_KEY) fail("--prune-faces needs GEMINI_API_KEY in .env.local");
  const db = createClient(url!, serviceKey!, { auth: { persistSession: false, autoRefreshToken: false } });
  const owner = await findOwner(db, args);

  // source_key = "<trip-folder>/..." (lowercase, NFC); escape LIKE wildcards in the folder name
  const prefix = `${tripName.normalize("NFC").toLowerCase()}/`;
  const pattern = prefix.replace(/[\\%_]/g, (c) => `\\${c}`) + "%";
  type Pin = { id: string; source_key: string; title: string | null; location_name: string | null; storage_path: string; thumb_url: string | null; photo_url: string };
  const pins: Pin[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("photos")
      .select("id, source_key, title, location_name, storage_path, thumb_url, photo_url")
      .eq("user_id", owner)
      .like("source_key", pattern)
      .order("source_key")
      .range(from, from + 999);
    if (error) {
      if (/source_key/.test(error.message)) fail("The photos.source_key column is missing: run supabase/migrations/008_archive_source_key.sql first.");
      fail(`Could not read photos: ${error.message}`);
    }
    pins.push(...((data ?? []) as Pin[]));
    if ((data?.length ?? 0) < 1000) break;
  }
  console.log(`StoryMap face audit ${args.dryRun ? "(DRY RUN, nothing is deleted)" : "(DELETES flagged pins)"}`);
  console.log(`  ${pins.length} imported pins with source_key "${prefix}…" for this account\n`);

  const flagged: Pin[] = [];
  const unchecked: Pin[] = [];
  let n = 0;
  for (const p of pins) {
    n++;
    const img = p.thumb_url ?? p.photo_url;
    let faces: boolean | null = null;
    try {
      const res = await fetch(img, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      faces = await faceCheck(Buffer.from(await res.arrayBuffer()));
    } catch (err) {
      console.warn(`    could not load ${img}: ${(err as Error).message}`);
    }
    if (faces === true) flagged.push(p);
    else if (faces === null) unchecked.push(p);
    console.log(`[${n}/${pins.length}] ${p.source_key}: ${faces === true ? "FACES" : faces === null ? "unchecked" : "ok"}`);
  }

  console.log(`\nFlagged as having recognizable human faces: ${flagged.length}`);
  flagged.forEach((p, i) => console.log(`  ${i + 1}. id=${p.id}\n     source_key=${p.source_key}\n     title=${p.title ?? "-"}  location=${p.location_name ?? "-"}`));
  if (unchecked.length) {
    console.log(`\nCould not be checked (not touched, re-run to retry): ${unchecked.length}`);
    unchecked.forEach((p) => console.log(`  - ${p.source_key}`));
  }
  if (args.dryRun || !flagged.length) {
    console.log(args.dryRun ? "\nDry run: nothing was deleted." : "\nNothing to remove.");
    return;
  }

  let removed = 0;
  const bucket = db.storage.from(BUCKET);
  for (const p of flagged) {
    // row first (likes/comments cascade), then the files
    const { error } = await db.from("photos").delete().eq("id", p.id).eq("user_id", owner);
    if (error) {
      console.error(`  ✖ ${p.source_key}: ${error.message}`);
      continue;
    }
    const { error: fe } = await bucket.remove([p.storage_path, p.storage_path.replace(/\.jpg$/i, "_thumb.jpg")]);
    if (fe) console.warn(`  ! ${p.source_key}: row deleted, files could not be removed (${fe.message})`);
    removed++;
  }
  console.log(`\nRemoved ${removed} of ${flagged.length} pins (rows + image + thumbnail files).`);
  if (removed < flagged.length) process.exitCode = 1;
}

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(args.dir);
  const st = await fs.stat(root).catch(() => null);
  if (!st?.isDirectory()) fail(`Not a folder: ${root}`);
  const tripName = path.basename(root);
  if (args.pruneFaces) return pruneFaces(args, tripName);

  console.log(`StoryMap archive import ${args.dryRun ? "(DRY RUN, nothing is uploaded)" : ""}`);
  console.log(`  folder : ${root}  (read-only: no file on disk is modified, moved or deleted)`);
  console.log(`  options: ai=${args.ai} max-mb=${args.maxMb || "off"} force=${args.force} flights=${args.includeFlights}${args.limit ? ` limit=${args.limit}` : ""}\n`);

  const files = await walk(root);
  const scan = scanArchive(files, tripName, args.includeFlights);
  // Timelapse / panorama sequence folders: skipped, or just their middle frame
  const tl = await detectTimelapse(files, tripName);
  let list = scan.candidates.filter((c) => !tl.has(c.file.relDir));
  const tlPhotos = scan.candidates.length - list.length;
  if (args.timelapseHero) {
    for (const t of tl.values()) {
      const hero = timelapseHero(t, tripName);
      if (!hero.flight || args.includeFlights) list.push(hero);
    }
    list.sort((a, b) => a.key.localeCompare(b.key));
  }
  if (args.limit) list = list.slice(0, args.limit);
  console.log(`  scanned ${files.length} files → ${scan.candidates.length} edited photos (skipped: ${scan.skipped.phone} phone, ${scan.skipped.unedited} unedited, ${scan.skipped.superseded} older versions)`);
  if (tl.size) {
    console.log(`  timelapse / sequence folders: ${tl.size} ${args.timelapseHero ? "(middle frame of each imported with #timelapse)" : "skipped (use --timelapse-hero to import one frame each)"}`);
    for (const t of tl.values()) console.log(`    - ${t.relDir || tripName}: ${t.frames.length} frames, ${t.why}`);
  }
  if (!list.length) {
    console.log("\nNothing to import.");
    return;
  }

  // country from the --dir path and each photo's folders
  const fullParts = root.split(path.sep).filter(Boolean);
  const forced = args.country ? COUNTRIES.find((c) => c.name.toLowerCase() === args.country!.toLowerCase()) ?? { name: args.country, iso: "", airport: `international airport`, he: [] } : null;
  const countryOf = (c: Candidate): Country | null => forced ?? detectCountry([...fullParts, ...(c.file.relDir ? c.file.relDir.split("/") : [])]);

  // Supabase (needed for upsert; in a dry run only to tell new from update)
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let db: SupabaseClient | null = null;
  let owner: string | null = null;
  let existing = new Map<string, ExistingRow>();
  if (url && serviceKey) {
    db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    owner = await findOwner(db, args);
    existing = await loadExisting(db, owner);
  } else if (!args.dryRun) {
    fail("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local (Supabase → Project Settings → API → service_role).");
  } else {
    console.log("  (no SUPABASE_SERVICE_ROLE_KEY: the dry run can't tell new photos from updates)");
  }
  if (!args.dryRun && !args.allowFaces && !process.env.GEMINI_API_KEY) fail("The face check needs GEMINI_API_KEY in .env.local (or pass --allow-faces to import without it).");
  if (args.dryRun && !args.allowFaces) console.log("  (face check runs on real imports only; a dry run does not call Gemini)");
  if (args.ai && !process.env.GEMINI_API_KEY) console.warn("  ! --ai given but GEMINI_API_KEY is not set: titles will come from folder names, tags from the solar phase");

  const rows: Row[] = [];
  const stats = { new: 0, update: 0, unchanged: 0, skipped: 0, failed: 0, bytes: 0, faces: 0, faceUnknown: 0 };
  const faceFiles: string[] = [];
  const faceUnknownFiles: string[] = [];
  const tierCount: Record<string, number> = { exif: 0, phone: 0, folder: 0 };
  const photographer = process.env.EXTERNAL_DEFAULT_PHOTOGRAPHER || "Max Bihovskiy";

  let i = 0;
  for (const cand of list) {
    i++;
    const tag = `[${i}/${list.length}]`;
    const display = `${cand.file.relDir ? `${cand.file.relDir}/` : ""}${cand.file.name}`;
    try {
      const country = countryOf(cand);
      const exif = await mergedExif(cand);
      const loc = await locate(cand, exif, scan.phones, root, country);
      const ex = existing.get(cand.key);

      if (!loc) {
        stats.skipped++;
        rows.push({ cand, action: "skip", tier: "-", place: "", note: country ? "no GPS and no folder place found" : "no GPS and no country in the folder names (use --country)" });
        console.log(`${tag} ${display}: skipped, ${rows.at(-1)!.note}`);
        continue;
      }
      tierCount[loc.tier]++;

      const buf = await fs.readFile(cand.file.abs); // read-only
      const fp = createHash("sha1").update(buf).digest("hex").slice(0, 10);
      const unchanged = ex && !args.force && ex.storage_path.includes(`_${fp}.jpg`);
      const action: Action = ex ? (unchanged ? "unchanged" : "update") : db ? "new" : "new?";
      const row: Row = { cand, action, tier: loc.tier, place: loc.name ?? "", note: loc.note };
      rows.push(row);

      if (action === "unchanged") {
        stats.unchanged++;
        console.log(`${tag} ${display}: unchanged`);
        continue;
      }
      if (args.dryRun) {
        if (action === "update") stats.update++;
        else stats.new++;
        continue;
      }

      // ---- real import ----
      const enc = await encode(buf, exif.wall, args.maxMb);
      const taken = resolveTakenAt(exif.wall, exif.offset, loc.lat, loc.lng);
      const baseTags = [country?.name, cand.flight ? "flight" : null, cand.flight ? "aerial" : null, cand.timelapse ? "timelapse" : null]
        .filter((x): x is string => Boolean(x))
        .map((x) => x.toLowerCase().replace(/\s+/g, ""));
      let title: string | null = null;
      let tags: string[] = [];
      if (!ex) {
        // Title / tags / face check BEFORE anything is uploaded
        let faces: boolean | null = false;
        if (args.ai) {
          const r = await aiTitleTags(enc.thumb, taken.taken_at, loc.lat, loc.lng, loc.name, baseTags, !args.allowFaces);
          title = r.title;
          tags = r.tags;
          if (!args.allowFaces) faces = r.hasFaces;
        } else {
          tags = timeBasedTags({ takenAt: taken.taken_at, lat: loc.lat, lng: loc.lng }, baseTags).tags;
          if (!args.allowFaces) faces = await faceCheck(enc.thumb);
        }
        if (faces === true) {
          stats.faces++;
          faceFiles.push(display);
          console.log(`${tag} ${display}: Skipped (human face detected)`);
          continue;
        }
        if (faces === null) {
          stats.faceUnknown++;
          faceUnknownFiles.push(display);
          console.log(`${tag} ${display}: Skipped (face check unavailable, will retry next run)`);
          continue;
        }
        title = title ?? loc.label; // no AI title: the folder's place name
        tags = sanitizeTags([...tags, ...baseTags.filter((t2) => t2 === "flight" || t2 === "aerial" || t2 === "timelapse")], 15);
      }
      stats.bytes += enc.main.byteLength;
      const id = ex?.id ?? randomUUID();
      const mainPath = `${owner}/${id}_${fp}.jpg`;
      const thumbPath = `${owner}/${id}_${fp}_thumb.jpg`;
      const bucket = db!.storage.from(BUCKET);
      const opts = { contentType: "image/jpeg", cacheControl: "31536000", upsert: true };
      const [m, t] = await Promise.all([bucket.upload(mainPath, enc.main, opts), bucket.upload(thumbPath, enc.thumb, opts)]);
      if (m.error || t.error) {
        await bucket.remove([mainPath, thumbPath]);
        throw new Error(`Storage upload failed: ${(m.error ?? t.error)!.message}`);
      }
      const photoUrl = bucket.getPublicUrl(mainPath).data.publicUrl;
      const thumbUrl = bucket.getPublicUrl(thumbPath).data.publicUrl;
      const mb = (enc.main.byteLength / 1048576).toFixed(2);

      if (ex) {
        // Re-edit: swap the image files only. Likes, comments, title, tags and any manual location stay.
        const patch: Record<string, unknown> = { storage_path: mainPath, photo_url: photoUrl, thumb_url: thumbUrl, width: enc.width, height: enc.height };
        if (exif.make) patch.camera_make = exif.make;
        if (exif.model) patch.camera_model = exif.model;
        if (exif.lens) patch.lens = exif.lens;
        const { error } = await db!.from("photos").update(patch).eq("id", ex.id).eq("user_id", owner!);
        if (error) {
          await bucket.remove([mainPath, thumbPath]);
          throw new Error(`Database update failed: ${error.message}`);
        }
        await bucket.remove([ex.storage_path, ex.storage_path.replace(/\.jpg$/i, "_thumb.jpg")]); // old files, after the row points at the new ones
        stats.update++;
        console.log(`${tag} ${display}: updated in place (${mb} MB, ${enc.width}x${enc.height}, q${enc.quality})`);
        continue;
      }

      const { error } = await db!.from("photos").insert({
        id,
        user_id: owner,
        photographer_name: photographer,
        source_key: cand.key,
        storage_path: mainPath,
        photo_url: photoUrl,
        thumb_url: thumbUrl,
        width: enc.width,
        height: enc.height,
        camera_make: exif.make,
        camera_model: exif.model,
        lens: exif.lens,
        focal_length: exif.focal,
        aperture: exif.aperture,
        shutter_speed: exif.shutter,
        iso: exif.iso,
        latitude: loc.lat,
        longitude: loc.lng,
        is_manual_location: false,
        location_name: loc.name,
        taken_at: taken.taken_at,
        taken_tz: taken.taken_tz,
        title,
        description: null,
        story: "", // archive imports carry no story
        tags,
        is_private: false,
      });
      if (error) {
        await bucket.remove([mainPath, thumbPath]);
        throw new Error(`Database insert failed: ${error.message}`);
      }
      stats.new++;
      console.log(`${tag} ${display}: imported "${title ?? ""}" (${mb} MB, ${enc.width}x${enc.height}, q${enc.quality}, ${loc.tier})`);
    } catch (err) {
      stats.failed++;
      console.error(`${tag} ${display}: FAILED ${(err as Error).message}`);
    }
  }

  // ---- report ----
  if (args.dryRun) {
    console.log("\n#   action     tier    file → canonical key");
    rows.forEach((r, n) => {
      const f = `${r.cand.file.relDir ? `${r.cand.file.relDir}/` : ""}${r.cand.file.name}`;
      console.log(`${String(n + 1).padEnd(3)} ${r.action.padEnd(10)} ${r.tier.padEnd(7)} ${short(f, 60)} → ${short(r.cand.key, 70)}`);
      console.log(`${" ".repeat(23)}${r.action === "skip" ? `✖ ${r.note}` : `📍 ${short(r.place, 50)}  (${r.note})`}`);
    });
  }
  const flightsSkipped = args.includeFlights ? [] : scan.flights;
  if (flightsSkipped.length) {
    const byDir = new Map<string, number>();
    flightsSkipped.forEach((f) => byDir.set(f.file.relDir || tripName, (byDir.get(f.file.relDir || tripName) ?? 0) + 1));
    console.log("\nFlight folders skipped (pass --include-flights to import them at the arrival airport):");
    byDir.forEach((n, d) => console.log(`  - ${d}: ${n} photo${n === 1 ? "" : "s"}`));
  }
  if (faceFiles.length) {
    console.log("\nSkipped (human face detected):");
    faceFiles.forEach((f) => console.log(`  - ${f}`));
  }
  if (faceUnknownFiles.length) {
    console.log("\nNot imported, face check unavailable (re-run to retry):");
    faceUnknownFiles.forEach((f) => console.log(`  - ${f}`));
  }
  console.log(`\nTimelapse / sequence folders ${args.timelapseHero ? "reduced to one frame" : "skipped"}: ${tl.size}${tlPhotos ? ` (${tlPhotos} edited photos inside)` : ""}. Photos with faces skipped: ${stats.faces}.`);
  console.log(
    `\nDone: ${stats.new} ${args.dryRun ? "to import" : "imported"}, ${stats.update} ${args.dryRun ? "to update" : "updated"}, ${stats.unchanged} unchanged, ${stats.skipped} without a location, ${stats.failed} failed.` +
      `  GPS tiers: EXIF ${tierCount.exif}, phone ${tierCount.phone}, folder ${tierCount.folder}.` +
      (stats.bytes ? `  Uploaded ${(stats.bytes / 1048576).toFixed(1)} MB.` : ""),
  );
  if (stats.failed) process.exitCode = 1;
}

main().catch((err) => fail(String(err?.stack ?? err)));
