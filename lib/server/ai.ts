import "server-only";
import { geminiConfigured, geminiJson } from "./gemini";
import { getTimeOfDay, isMorning, reconcileTimeTags, TIME_OF_DAY_LABEL, type TimeOfDay } from "@/lib/timeOfDay";
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
          `Solar phase computed from the timestamp and GPS: ${TIME_OF_DAY_LABEL[phase]} ` +
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
