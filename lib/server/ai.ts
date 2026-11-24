import "server-only";
import { geminiConfigured, geminiJson } from "./gemini";
import { getSolarPhase, getTimeOfDay, isMorning, reconcileTimeTags, solarPhaseLabel, type TimeOfDay } from "@/lib/timeOfDay";
import { formatTakenAt, timezoneAt } from "@/lib/time";

/**
 * The AI pipeline, in one place, shared by:
 *   - /api/ai/tags and /api/ai/translate (browser uploads)
 *   - /api/external-publish (pins from MaxBi Social Planner / Content Lab)
 * Every function degrades gracefully: no GEMINI_API_KEY or a model error never blocks a pin.
 */

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

/** Tags that say nothing about a specific photo */
const BLOCKED_TAGS = new Set([
  "photo", "photos", "photography", "photographer", "photooftheday", "picoftheday", "instagood", "instadaily",
  "travel", "travelgram", "travelphotography", "image", "beautiful", "nature", "landscape", "camera", "art",
  "love", "explore", "follow", "like4like", "hiddengems", "travelguide", "traveltips",
]);
/** Any tag containing one of these is dropped (camera brands) */
const BLOCKED_PARTS = ["nikon", "canon", "sony", "fujifilm", "leica"];

/** Normalize (lowercase, no '#', no spaces/punctuation) and drop generic or brand tags */
export function sanitizeTags(tags: string[], max = 15): string[] {
  const out = tags
    .map((t) => t.normalize("NFKC").trim().replace(/^#+/, "").toLowerCase().replace(/[\s-]+/g, "").replace(/[^a-z0-9_]/g, ""))
    .filter((t) => t.length >= 2 && t.length <= 30)
    .filter((t) => !BLOCKED_TAGS.has(t) && !BLOCKED_PARTS.some((b) => t.includes(b)));
  return [...new Set(out)].slice(0, max);
}

/**
 * Pulls #hashtags out of a social post: collects them as tags and removes
 * hashtag-only lines (the block at the end of an Instagram caption).
 */
export function splitStoryHashtags(story: string | null): { text: string | null; hashtags: string[] } {
  if (!story) return { text: story, hashtags: [] };
  const hashtags = [...story.matchAll(/#([\p{L}\p{N}_]+)/gu)].map((m) => m[1]);
  const text = story
    .split("\n")
    .filter((line) => !/^\s*(#[\p{L}\p{N}_]+[\s,.]*)+$/u.test(line))
    .join("\n")
    .replace(/(\s*#[\p{L}\p{N}_]+)+\s*$/u, "") // trailing run on the last text line
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text: text || null, hashtags };
}

export interface AiTagsInput {
  /** base64 JPEG (thumbnail), no data: prefix */
  imageB64?: string | null;
  takenAt: string | null;
  lat: number | null;
  lng: number | null;
  locationName?: string | null;
  title?: string | null;
  story?: string | null;
}

/**
 * Vision tags + the timestamp rule: a golden sky in the morning is a sunrise, in the evening a sunset.
 * The solar phase computed from EXIF time + GPS always wins over what the image "looks like".
 */
export async function aiTags(input: AiTagsInput, extraTags: string[] = []): Promise<{ tags: string[]; phase: TimeOfDay | null; ai: boolean }> {
  try {
    return await aiTagsInner(input, extraTags);
  } catch (err) {
    console.error("[ai/tags] fallback to time-based tags:", err);
    return timeBasedTags(input, extraTags);
  }
}

/**
 * No AI at all: the caller's tags + the solar phase tag (sunrise / sunset / night) from EXIF time + GPS.
 * Used whenever Gemini is missing, down, or returns an error.
 */
export function timeBasedTags(input: Pick<AiTagsInput, "takenAt" | "lat" | "lng">, extraTags: string[] = []): { tags: string[]; phase: TimeOfDay | null; ai: false } {
  const { lat, lng, takenAt } = input;
  try {
    const located = lat != null && lng != null;
    const merged = sanitizeTags(extraTags, 30);
    const tags = located ? reconcileTimeTags(merged, takenAt, lat, lng) : merged;
    return { tags: sanitizeTags(tags, 15), phase: located ? getTimeOfDay(takenAt, lat, lng) : null, ai: false };
  } catch {
    return { tags: sanitizeTags(extraTags, 15), phase: null, ai: false };
  }
}

async function aiTagsInner(input: AiTagsInput, extraTags: string[]): Promise<{ tags: string[]; phase: TimeOfDay | null; ai: boolean }> {
  const { lat, lng, takenAt } = input;
  const located = lat != null && lng != null;
  const phase = located ? getTimeOfDay(takenAt, lat, lng) : null;

  let suggested: string[] = [];
  let ai = false;

  if (geminiConfigured() && input.imageB64) {
    const timeContext =
      phase && takenAt && located
        ? `Capture time (local at the location): ${formatTakenAt(takenAt, timezoneAt(lat, lng))}. ` +
          `Solar phase computed from the timestamp and GPS: ${solarPhaseLabel(getSolarPhase(takenAt, lat, lng)!)} ` +
          `(${isMorning(new Date(takenAt), lat, lng) ? "MORNING, before solar noon" : "EVENING, after solar noon"}). ` +
          `Golden or orange sky in the MORNING is a sunrise, in the EVENING it is a sunset. Never contradict the solar phase.`
        : "Capture time unknown: do not use sunrise or sunset tags unless the sun is clearly on the horizon.";

    const prompt = [
      "You tag photos for a photography map so people can search them.",
      "Return 4 to 10 short English tags: lowercase, no spaces (join words, e.g. milkyway, goldenhour), no '#'.",
      "Cover: main subject, scene/landscape type, light and sky, weather, season if obvious, notable landmark only if you are sure.",
      "Do NOT return generic tags (photography, travel, nature, beautiful, photooftheday), camera brands, or people's names.",
      timeContext,
      input.locationName ? `Location name given by the photographer: ${input.locationName}.` : "",
      input.title ? `Title: ${input.title}.` : "",
      input.story ? `The photographer's post about it (any language): ${input.story.slice(0, 1500)}` : "",
    ].filter(Boolean).join("\n");

    try {
      const out = await geminiJson<{ tags: string[] }>(
        [{ inline_data: { mime_type: "image/jpeg", data: input.imageB64 } }, { text: prompt }],
        { type: "OBJECT", properties: { tags: { type: "ARRAY", items: { type: "STRING" } } }, required: ["tags"] },
      );
      suggested = Array.isArray(out.tags) ? out.tags.filter((t): t is string => typeof t === "string") : [];
      ai = true;
    } catch (err) {
      console.error("[ai/tags]", err);
    }
  }

  // Caller's tags first (they were chosen by a human), then the model's; the time rule applies to all
  const merged = sanitizeTags([...extraTags, ...suggested], 30);
  const reconciled = located ? reconcileTimeTags(merged, takenAt, lat, lng) : reconcileTimeTags(merged, null, 0, 0);
  return { tags: sanitizeTags(reconciled, 15), phase, ai };
}

// ---------------------------------------------------------------------------
// Translation
// ---------------------------------------------------------------------------

/** Already English (or no letters)? Then skip the model call */
export function looksEnglish(s: string): boolean {
  if (/[^\u0000-ɏ -⁯₠-⃏\s\p{Emoji_Presentation}\p{Extended_Pictographic}]/u.test(s)) return false;
  if (/[À-ÿ]/.test(s)) return false;
  return true;
}

const noLongDashes = (s: string) => s.replace(/\s*[—–]\s*/g, " - ");

/** Translates every non-English item to natural English (same order). Returns originals on failure */
export async function aiTranslate(texts: string[]): Promise<{ texts: string[]; translated: boolean }> {
  try {
    return await aiTranslateInner(texts);
  } catch (err) {
    console.error("[ai/translate] fallback to original text:", err);
    return { texts, translated: false };
  }
}

async function aiTranslateInner(texts: string[]): Promise<{ texts: string[]; translated: boolean }> {
  const todo = texts.map((t, i) => ({ t, i })).filter(({ t }) => t.trim() && !looksEnglish(t));
  if (!todo.length || !geminiConfigured()) return { texts, translated: false };

  try {
    const out = await geminiJson<{ translations: string[] }>(
      [
        {
          text: [
            "Translate each item to natural, fluent English as a native-speaking photographer would write it.",
            "Keep the tone, line breaks and length. Keep place names in their common English form. Keep emojis.",
            "If an item is already English, return it unchanged. Return exactly one translation per item, same order.",
            "Never add quotes, notes or explanations. Use a plain hyphen or comma instead of long dashes.",
            "",
            JSON.stringify(todo.map(({ t }) => t)),
          ].join("\n"),
        },
      ],
      { type: "OBJECT", properties: { translations: { type: "ARRAY", items: { type: "STRING" } } }, required: ["translations"] },
    );
    if (!Array.isArray(out.translations) || out.translations.length !== todo.length) return { texts, translated: false };
    const result = [...texts];
    todo.forEach(({ i }, k) => {
      const tr = out.translations[k];
      if (typeof tr === "string" && tr.trim()) result[i] = noLongDashes(tr.trim());
    });
    return { texts: result, translated: true };
  } catch (err) {
    console.error("[ai/translate]", err);
    return { texts, translated: false };
  }
}

// ---------------------------------------------------------------------------
// Combined: translation + title + tags in ONE Gemini call (480px thumbnail only)
// ---------------------------------------------------------------------------

export interface EnrichInput extends AiTagsInput {
  /** Title sent by the caller (translated, never replaced). null = generate one */
  title: string | null;
  /** Also ask whether the photo shows recognizable human faces (result.hasFaces) */
  detectFaces?: boolean;
}

/** Does the text talk about parking, access, tickets, permits or drones? (skips the extraction otherwise) */
export const FIELD_NOTE_HINT =
  /park|walk|hike|trail|minutes?\b|\bmin\b|\bkm\b|\bmiles?\b|\bmetres?\b|\bmeters?\b|ticket|permit|licen[cs]e|\bfees?\b|entran|admission|entry|drone|uav|no.?fly|reserv|booking|toll|חני|גישה|כרטיס|היתר|רחפן|הליכה|דקות|כניסה|תשלום/i;

export interface FieldNotesResult {
  /** Parking & access: where to park, walking distance, trail / road conditions */
  accessInfo: string | null;
  /** Permit / drone / ticket: fees, permits, drone rules */
  permitInfo: string | null;
}

/** One short English sentence fragment, or null */
export function cleanNote(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = noLongDashes(raw).replace(/\s+/g, " ").replace(/^["'“”]+|["'“”]+$/g, "").trim();
  if (!s || /^(none|n\/a|null|not mentioned|unknown|-)$/i.test(s)) return null;
  return s.slice(0, 300);
}

const FIELD_NOTE_RULES = [
  "accessInfo (Parking & Access): ONLY what the text says about where to park, walking distance or time, trail / road conditions, or how to get there.",
  "permitInfo (Permit / Drone / Ticket): ONLY what the text says about tickets, entry fees, permits, reservations, or drone rules.",
  "Each: one or two concise English sentences (max 160 characters), plain hyphens only, no emojis. Never invent facts. Empty string if the text doesn't mention it.",
];


/** Text-only extraction for browser uploads (the photo's description). Never throws */
export async function aiFieldNotes(text: string | null): Promise<FieldNotesResult> {
  const empty: FieldNotesResult = { accessInfo: null, permitInfo: null };
  const t = text?.trim();
  if (!t || !geminiConfigured() || !FIELD_NOTE_HINT.test(t)) return empty;
  try {
    const out = await geminiJson<{ accessInfo?: string; permitInfo?: string }>(
      [{ text: ["Extract photographer field notes from this post (any language).", ...FIELD_NOTE_RULES, "", `Post: ${t.slice(0, 4000)}`].join("\n") }],
      {
        type: "OBJECT",
        properties: { accessInfo: { type: "STRING" }, permitInfo: { type: "STRING" } },
        required: ["accessInfo", "permitInfo"],
      },
    );
    return { accessInfo: cleanNote(out.accessInfo), permitInfo: cleanNote(out.permitInfo) };
  } catch (err) {
    console.error("[ai/field-notes]", err);
    return empty;
  }
}

export interface EnrichResult extends FieldNotesResult {
  /** null = not asked or unknown */
  hasFaces: boolean | null;
  story: string | null;
  title: string | null;
  tags: string[];
  phase: TimeOfDay | null;
  translated: boolean;
  titleGenerated: boolean;
  tagged: boolean;
}

/**
 * One structured-JSON call instead of three parallel ones. Never throws: on a missing key,
 * timeout, bad JSON or any model error it returns the originals + time-based tags.
 */
export async function aiEnrich(input: EnrichInput, extraTags: string[], timeoutMs?: number, opts?: { rethrow?: boolean; capMs?: number }): Promise<EnrichResult> {
  const { lat, lng, takenAt } = input;
  const located = lat != null && lng != null;
  const fallback = (): EnrichResult => {
    const t = timeBasedTags({ takenAt, lat, lng }, extraTags);
    return { story: input.story ?? null, title: input.title ?? null, tags: t.tags, phase: t.phase, translated: false, titleGenerated: false, tagged: false, accessInfo: null, permitInfo: null, hasFaces: null };
  };
  if (!geminiConfigured() || !input.imageB64) return fallback();

  try {
    const phase = located ? getTimeOfDay(takenAt, lat, lng) : null;
    const timeContext =
      phase && takenAt && located
        ? `Capture time (local): ${formatTakenAt(takenAt, timezoneAt(lat, lng))}. Solar phase: ${solarPhaseLabel(getSolarPhase(takenAt, lat, lng)!)} ` +
          `(${isMorning(new Date(takenAt), lat, lng) ? "MORNING" : "EVENING"}). Golden sky in the MORNING is a sunrise, in the EVENING a sunset. Never contradict the solar phase.`
        : "Capture time unknown: no sunrise or sunset tags unless the sun is clearly on the horizon.";

    const story = input.story?.trim() || null;
    const needTranslate = Boolean(story && !looksEnglish(story)) || Boolean(input.title && !looksEnglish(input.title));
    const wantNotes = Boolean(story && FIELD_NOTE_HINT.test(story));
    const prompt = [
      "You process one photo for a photography map. Return JSON with: tags, title, story, titleTranslated, accessInfo, permitInfo.",
      wantNotes ? FIELD_NOTE_RULES.join(" ") : "accessInfo and permitInfo: return empty strings.",
      "tags: 4 to 10 short English tags, lowercase, no spaces (milkyway, goldenhour), no '#'. Cover subject, scene, light/sky, weather, season, a landmark only if sure. No generic tags (photography, travel, nature, beautiful), camera brands or names of people.",
      input.title
        ? "title: return an empty string. titleTranslated: the given title translated to natural English (unchanged if already English)."
        : "title: 4 to 7 words, English, Title Case, specific, no quotes/emojis/hashtags/trailing period/long dashes. titleTranslated: empty string.",
      needTranslate
        ? "story: the post translated to natural, fluent English; keep tone, line breaks, emojis, common English place names; use plain hyphens, never long dashes."
        : "story: return the post unchanged.",
      input.detectFaces
        ? "hasRecognizableFaces: true if the photo is a portrait, group shot, selfie or shows recognizable human faces; false for landscapes, wildlife, architecture, or tiny distant figures in a vast landscape."
        : "",
      timeContext,
      input.locationName ? `Location: ${input.locationName}.` : "",
      input.title ? `Given title (any language): ${input.title}` : "",
      story ? `Post (any language): ${story.slice(0, 4000)}` : "Post: (none)",
    ].filter(Boolean).join("\n");

    const out = await geminiJson<{ hasRecognizableFaces?: boolean; tags?: string[]; title?: string; story?: string; titleTranslated?: string; accessInfo?: string; permitInfo?: string }>(
      [{ inline_data: { mime_type: "image/jpeg", data: input.imageB64 } }, { text: prompt }],
      {
        type: "OBJECT",
        properties: {
          tags: { type: "ARRAY", items: { type: "STRING" } },
          title: { type: "STRING" },
          story: { type: "STRING" },
          titleTranslated: { type: "STRING" },
          accessInfo: { type: "STRING" },
          permitInfo: { type: "STRING" },
          ...(input.detectFaces ? { hasRecognizableFaces: { type: "BOOLEAN" } } : {}),
        },
        required: ["tags", "title", "story", "titleTranslated", "accessInfo", "permitInfo", ...(input.detectFaces ? ["hasRecognizableFaces"] : [])],
      },
      timeoutMs,
      opts?.capMs,
    );

    const suggested = Array.isArray(out.tags) ? out.tags.filter((t): t is string => typeof t === "string") : [];
    const merged = sanitizeTags([...extraTags, ...suggested], 30);
    const reconciled = located ? reconcileTimeTags(merged, takenAt, lat, lng) : reconcileTimeTags(merged, null, 0, 0);

    const translatedStory =
      needTranslate && story && typeof out.story === "string" && out.story.trim() ? noLongDashes(out.story.trim()) : null;
    const translatedTitle =
      input.title && typeof out.titleTranslated === "string" && out.titleTranslated.trim() ? noLongDashes(out.titleTranslated.trim()) : null;
    const generated = input.title ? null : cleanTitle(out.title);

    return {
      story: translatedStory ?? story,
      title: input.title ? translatedTitle ?? input.title : generated,
      tags: sanitizeTags(reconciled, 15),
      phase,
      translated: Boolean(translatedStory || translatedTitle),
      titleGenerated: generated != null,
      tagged: suggested.length > 0,
      hasFaces: input.detectFaces && typeof out.hasRecognizableFaces === "boolean" ? out.hasRecognizableFaces : null,
      accessInfo: wantNotes ? cleanNote(out.accessInfo) : null,
      permitInfo: wantNotes ? cleanNote(out.permitInfo) : null,
    };
  } catch (err) {
    if (opts?.rethrow) throw err; // batch importers retry on 429 themselves
    console.error("[ai/enrich] fallback to originals + time-based tags:", err);
    return fallback();
  }
}

// ---------------------------------------------------------------------------
// Title
// ---------------------------------------------------------------------------

/** A short English title (4–7 words) from the story and the image. null if the model is unavailable */
export async function aiTitle(input: { story: string | null; imageB64?: string | null; locationName?: string | null; tags?: string[] }): Promise<string | null> {
  try {
    return await aiTitleInner(input);
  } catch (err) {
    console.error("[ai/title] fallback to no generated title:", err);
    return null;
  }
}

async function aiTitleInner(input: { story: string | null; imageB64?: string | null; locationName?: string | null; tags?: string[] }): Promise<string | null> {
  if (!geminiConfigured() || (!input.story && !input.imageB64)) return null;

  const prompt = [
    "Write a title for this photo on a photography map.",
    "Rules: English, 4 to 7 words, Title Case, specific to this photo and moment, like a photographer would title it.",
    "No quotes, no emojis, no hashtags, no trailing period, no long dashes, no camera brands, no clickbait.",
    input.locationName ? `Location: ${input.locationName}.` : "",
    input.tags?.length ? `Tags: ${input.tags.join(", ")}.` : "",
    input.story ? `The photographer's post (any language): ${input.story.slice(0, 2000)}` : "",
  ].filter(Boolean).join("\n");

  const parts: Parameters<typeof geminiJson>[0] = input.imageB64
    ? [{ inline_data: { mime_type: "image/jpeg", data: input.imageB64 } }, { text: prompt }]
    : [{ text: prompt }];

  try {
    const out = await geminiJson<{ title: string }>(parts, {
      type: "OBJECT",
      properties: { title: { type: "STRING" } },
      required: ["title"],
    });
    return cleanTitle(out.title);
  } catch (err) {
    console.error("[ai/title]", err);
    return null;
  }
}

const DANGLING = new Set(["a", "an", "the", "at", "in", "on", "over", "under", "of", "and", "with", "by", "for", "to", "from", "into", "near", "above", "below", "&"]);

/** Strips quotes/punctuation/hashtags and enforces 4–7 words (trims longer ones, rejects < 3) */
export function cleanTitle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const words = noLongDashes(raw)
    .replace(/#\S+/g, "")
    .replace(/["“”'‘’`]/g, "")
    .replace(/[.!?:;,]+$/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length < 3) return null;
  // Over 7 words: cut, then drop dangling connectors ("...Main River At" → "...Main River")
  const cut = words.slice(0, 7);
  while (cut.length > 4 && DANGLING.has(cut[cut.length - 1].toLowerCase())) cut.pop();
  return cut.join(" ");
}

// ---------------------------------------------------------------------------
// Photo Scout: "Plan a Photo Trip" spot recommendations along a day's route
// ---------------------------------------------------------------------------

export type ScoutPhase = "sunrise" | "sunset" | "midday";

export interface ScoutSpot {
  name: string;
  latitude: number;
  longitude: number;
  phase: ScoutPhase;
  /** One short sentence: what to shoot and why it works in that light */
  reason: string | null;
}

export interface ScoutInput {
  date: string;
  stops: { name: string; latitude: number; longitude: number }[];
}

const kmBetween = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const r = Math.PI / 180;
  const h = Math.sin(((bLat - aLat) * r) / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(((bLng - aLng) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

/**
 * Real, specific photography viewpoints around a day's stops, per light (sunrise / sunset / midday).
 * Coordinates that fall far from every stop are dropped as hallucinations. Never throws: [] when the model is down.
 */
export async function aiPhotoSpots(input: ScoutInput): Promise<ScoutSpot[]> {
  if (!geminiConfigured() || !input.stops.length) return [];
  const stops = input.stops.slice(0, 8);
  try {
    const out = await geminiJson<{ spots?: { name?: unknown; latitude?: unknown; longitude?: unknown; phase?: unknown; reason?: unknown }[] }>(
      [
        {
          text: [
            "You are a landscape and travel photography scout. Recommend REAL, specific photography viewpoints for one day of a trip.",
            `Date: ${input.date}.`,
            "The day's stops, in order:",
            ...stops.map((s, i) => `${i + 1}. ${s.name} (${s.latitude.toFixed(4)}, ${s.longitude.toFixed(4)})`),
            "",
            "Rules:",
            "- Suggest 2 or 3 spots for each phase: sunrise, sunset, midday. Spots must lie on or near the route (within about 30 km of a stop).",
            "- Only named places that really exist (viewpoints, bridges, squares, peaks, lakes, streets, ruins, parks). Never invent a place; if unsure, leave it out.",
            "- latitude / longitude: decimal degrees of that exact place, as accurate as you can.",
            "- reason: one short English sentence (max 140 characters) on what to shoot and why this light suits it. Plain hyphens only, no emojis.",
          ].join("\n"),
        },
      ],
      {
        type: "OBJECT",
        properties: {
          spots: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                name: { type: "STRING" },
                latitude: { type: "NUMBER" },
                longitude: { type: "NUMBER" },
                phase: { type: "STRING", enum: ["sunrise", "sunset", "midday"] },
                reason: { type: "STRING" },
              },
              required: ["name", "latitude", "longitude", "phase", "reason"],
            },
          },
        },
        required: ["spots"],
      },
      22_000,
      25_000,
    );
    const seen = new Set<string>();
    const spots: ScoutSpot[] = [];
    for (const s of out.spots ?? []) {
      const name = typeof s.name === "string" ? noLongDashes(s.name).replace(/\s+/g, " ").trim().slice(0, 120) : "";
      const lat = Number(s.latitude);
      const lng = Number(s.longitude);
      const phase = s.phase === "sunrise" || s.phase === "sunset" || s.phase === "midday" ? s.phase : null;
      if (!name || !phase || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
      if (Math.min(...stops.map((st) => kmBetween(lat, lng, st.latitude, st.longitude))) > 60) continue;
      const key = `${phase}|${name.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      spots.push({ name, latitude: lat, longitude: lng, phase, reason: cleanNote(s.reason) });
    }
    return spots.slice(0, 12);
  } catch (err) {
    console.error("[ai/photo-spots]", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// AI Trip Assistant: one prompt → an ordered, timed photo route
// ---------------------------------------------------------------------------

export interface AiRouteStop {
  name: string;
  latitude: number;
  longitude: number;
  description: string | null;
  durationMinutes: number;
  logistics: string | null;
  transitMinutes: number;
  transitNote: string | null;
}
export interface AiRoute {
  title: string | null;
  /** HH:MM local start of the first stop */
  startTime: string;
  stops: AiRouteStop[];
}

const clampInt = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

/**
 * Turns "I'm in Tbilisi tomorrow, build me a sunrise-to-sunset route" into ordered stops with exact coordinates, what to shoot,
 * how long to stay, and the transit from the previous stop. Stops are not capped. Throws on model failure so the caller can say so.
 */
export async function aiTripRoute(input: { prompt: string; date: string; near?: { latitude: number; longitude: number } | null }): Promise<AiRoute> {
  const out = await geminiJson<{ title?: unknown; startTime?: unknown; stops?: Record<string, unknown>[] }>(
    [
      {
        text: [
          "You are an expert local travel photographer planning one packed photography day. Build an ORDERED route from first light to last light.",
          `Date: ${input.date}.`,
          input.near ? `The traveller's map is currently centred near ${input.near.latitude.toFixed(3)}, ${input.near.longitude.toFixed(3)} (use it only if the request names no place).` : "",
          `Request: "${input.prompt.slice(0, 600)}"`,
          "",
          "Rules:",
          "- Only REAL, named places that exist (viewpoints, bridges, squares, old towns, churches, peaks, lakes, markets, streets, parks). Never invent one; leave it out if unsure.",
          "- latitude / longitude: decimal degrees of that exact place, as accurate as you can.",
          "- Order the stops so the route is geographically efficient AND matches the light: sunrise spots first, soft-light and interior spots mid-day, golden hour / sunset / blue hour spots last.",
          "- startTime: HH:MM (24h, the place's local time) at which the first stop begins, about 30-45 minutes before sunrise for that date and place.",
          "- durationMinutes: how long to stay at each stop (15-240).",
          "- transitMinutes: minutes to get there from the PREVIOUS stop (0 for the first stop); transitNote: how (walk / drive / metro) in at most 70 characters.",
          "- description: max 160 characters, what to shoot and which light suits it. logistics: entry / ticket / parking / permit / opening-hours note, max 120 characters, or empty.",
          "- Plain hyphens only, no emojis. If the request asks for many stops, give them all (up to 25).",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
    {
      type: "OBJECT",
      properties: {
        title: { type: "STRING" },
        startTime: { type: "STRING" },
        stops: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              name: { type: "STRING" },
              latitude: { type: "NUMBER" },
              longitude: { type: "NUMBER" },
              description: { type: "STRING" },
              durationMinutes: { type: "NUMBER" },
              logistics: { type: "STRING" },
              transitMinutes: { type: "NUMBER" },
              transitNote: { type: "STRING" },
            },
            required: ["name", "latitude", "longitude", "description", "durationMinutes", "transitMinutes"],
          },
        },
      },
      required: ["startTime", "stops"],
    },
    40_000,
    45_000,
  );
  const stops: AiRouteStop[] = [];
  const seen = new Set<string>();
  for (const s of out.stops ?? []) {
    const name = typeof s.name === "string" ? noLongDashes(s.name).replace(/\s+/g, " ").trim().slice(0, 120) : "";
    const lat = Number(s.latitude);
    const lng = Number(s.longitude);
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    stops.push({
      name,
      latitude: lat,
      longitude: lng,
      description: cleanNote(s.description),
      durationMinutes: clampInt(s.durationMinutes, 10, 480, 45),
      logistics: cleanNote(s.logistics),
      transitMinutes: stops.length ? clampInt(s.transitMinutes, 0, 600, 10) : 0,
      transitNote: cleanNote(s.transitNote),
    });
    if (stops.length >= 40) break;
  }
  const st = typeof out.startTime === "string" ? /^(\d{1,2}):(\d{2})/.exec(out.startTime.trim()) : null;
  const startTime = st && +st[1] < 24 && +st[2] < 60 ? `${st[1].padStart(2, "0")}:${st[2]}` : "07:00";
  return { title: typeof out.title === "string" ? noLongDashes(out.title).trim().slice(0, 100) || null : null, startTime, stops };
}
