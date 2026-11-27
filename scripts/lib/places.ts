/**
 * Place-name cleanup and AI geocoding shared by scripts/import-trip.ts and scripts/fix-historical-locations.ts.
 *
 * - stripFolderClutter / isDirtyLocationName: deterministic removal of "day2 -", "29.08", numbering, Hebrew trip words…
 * - aiPlaces: one Gemini call per batch of labels → clean English name, country, kind and landmark coordinates
 * - loadCountryPolygons: the app's Natural Earth polygons (public/data/countries-50m.json) for point-in-country checks
 *
 * Gemini needs the react-server condition: run scripts with `tsx --conditions=react-server`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { geminiJson } from "@/lib/server/gemini";
import { canonicalCountry } from "@/lib/countries";
import { countryAt, inCountry, primeCountryIndex } from "@/lib/countryGeo";

// ---------------------------------------------------------------------------
// Country polygons
// ---------------------------------------------------------------------------

let polygonsLoaded = false;
/** Compact tag form ("southkorea") → canonical country, built from the polygon names */
const COMPACT = new Map<string, string>();
const compact = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z]/g, "");

export function loadCountryPolygons(): void {
  if (polygonsLoaded) return;
  const file = path.resolve(process.cwd(), "public/data/countries-50m.json");
  const list = JSON.parse(readFileSync(file, "utf8")) as { n: string; b: [number, number, number, number]; p: number[][][] }[];
  primeCountryIndex(list);
  for (const e of list) {
    const c = canonicalCountry(e.n);
    if (c) {
      COMPACT.set(compact(e.n), c);
      COMPACT.set(compact(c), c);
    }
  }
  for (const extra of ["czechrepublic", "uk", "usa", "holland", "england", "scotland", "wales", "turkiye"]) {
    const c = canonicalCountry(extra === "czechrepublic" ? "czech republic" : extra);
    if (c) COMPACT.set(extra, c);
  }
  polygonsLoaded = true;
}

/** "netherlands" / "#southkorea" / "Czech Republic" → canonical country, or null */
export function countryFromTag(tag: string): string | null {
  return canonicalCountry(tag.replace(/^#/, "")) ?? COMPACT.get(compact(tag)) ?? null;
}

export { countryAt, inCountry };

export const haversineKm = (aLat: number, aLng: number, bLat: number, bLng: number): number => {
  const r = Math.PI / 180;
  const h = Math.sin(((bLat - aLat) * r) / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(((bLng - aLng) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
};

// ---------------------------------------------------------------------------
// Deterministic folder-clutter removal
// ---------------------------------------------------------------------------

const NON_LATIN = /[֐-׿Ѐ-ӿ؀-ۿ一-鿿぀-ヿ가-힯]/;
/** "day2", "day 14", "night 3", "יום 2" */
const DAY_RE = /^(?:day|night|יום|לילה|день)\s*\d{1,3}$/i;
/** "28.05", "29.08.18", "30.04.2018", "4/06" */
const DATE_RE = /^\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?$/;
/** Folder words that are never a place */
const GENERIC = /^(?:sunrise|sunset|night|morning|evening|night-morning|team|airplans?|airplanes?|planes?|boat rent|last day|misc|other|best|edited|export|selected|timelapse|panorama?s?)$/i;

const latinPart = (s: string) => !NON_LATIN.test(s) && /\p{L}/u.test(s);

/**
 * Strip folder clutter from an imported label, keeping the order of what is left:
 *   "day9 - 29.08 - Cantabria, Spain"                       → "Cantabria, Spain"
 *   "day2 - Keukenhof - פארק הפרחים, טיול לאמסטרדם"          → "Keukenhof"  (+ needsAi: Hebrew trip words dropped)
 *   "day 2 - 30.04.18 - מסלול צהוב - 12 - Reichstag, Berlin, Germany" → "Reichstag, Berlin, Germany"
 * `needsAi` is true when non-Latin text had to be dropped or kept, or nothing but generic words remained.
 */
export function stripFolderClutter(raw: string): { name: string; needsAi: boolean } {
  let needsAi = false;
  const out: string[] = [];
  const seen = new Set<string>();
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    const segs = part.split(/\s+[-–]\s+|\s*\/\s*/).map((s) => s.trim()).filter(Boolean);
    const kept: string[] = [];
    for (let seg of segs) {
      seg = seg.replace(/^(?:road|way) to\s+/i, "").replace(/\s+(?:area|at night|night)$/i, "").replace(/\s*\((?:[^)]*)\)\s*/g, " ").trim();
      if (!seg || DAY_RE.test(seg) || DATE_RE.test(seg) || /^\d+$/.test(seg) || GENERIC.test(seg)) continue;
      // "sunrise Brachera Beach" → "Brachera Beach"
      seg = seg.replace(/^(?:sunrise|sunset|night|morning)\s+/i, "").trim();
      if (NON_LATIN.test(seg)) {
        needsAi = true;
        // mixed "הר פלדברג Feldbergbahn" → keep the Latin words
        const latin = seg.replace(new RegExp(`${NON_LATIN.source}+[\\p{P}\\s]*`, "gu"), " ").replace(/\s+/g, " ").trim();
        if (latin && latinPart(latin) && latin.length > 2) kept.push(latin);
        continue;
      }
      kept.push(seg);
    }
    if (!kept.length) continue;
    const joined = kept.join(" - ");
    const k = joined.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(joined);
  }
  const name = out.join(", ");
  // nothing left, or a folder-joined part ("Keukenhof - Lisse") the model should tidy
  if (!name || out.some((p) => / - /.test(p))) needsAi = true;
  return { name, needsAi };
}

/** Does this location_name carry folder clutter (day prefixes, dates, numbering, non-Latin folder words, duplicates)? */
export function isDirtyLocationName(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const s = raw.trim();
  if (NON_LATIN.test(s)) return true;
  const { name, needsAi } = stripFolderClutter(s);
  return needsAi || name !== s;
}

/** A clean public name: Latin script, no day / date prefixes, no " - " folder joins */
export function looksClean(name: string | null | undefined): boolean {
  if (!name) return false;
  if (NON_LATIN.test(name)) return false;
  return !name.split(/,|\s+[-–]\s+/).some((s) => DAY_RE.test(s.trim()) || DATE_RE.test(s.trim()));
}

// ---------------------------------------------------------------------------
// Gemini: clean name + landmark geocode, batched
// ---------------------------------------------------------------------------

export type PlaceKind = "landmark" | "city" | "region" | "road" | "country" | "unknown";

export interface PlaceQuery {
  /** Caller's id for this label */
  key: string;
  /** The label as imported (folder names joined) */
  raw: string;
  /** Archive trip folder / subfolders, for context */
  folders?: string | null;
  /** Country hints: tags, trip folder country */
  hints?: string[];
  /** Expected country when the caller already knows it */
  country?: string | null;
}

export interface PlaceAnswer {
  key: string;
  /** Clean English public name, "Place, City, Country" */
  name: string;
  /** Canonical country (lib/countries.ts), or null */
  country: string | null;
  kind: PlaceKind;
  /** Landmark / place centre; null if Gemini was unsure or the point is outside `country` */
  lat: number | null;
  lng: number | null;
}

const KINDS: PlaceKind[] = ["landmark", "city", "region", "road", "country", "unknown"];

const PROMPT = `You clean photo location labels for a PUBLIC travel photo map and geocode them.
Each item's "raw" label was built from a photographer's LOCAL folder names. It may contain day prefixes ("day2 -", "night 3 -"),
dates ("29.08", "30.04.18"), numbering ("12 -"), Hebrew or Russian words (e.g. "טיול לאמסטרדם" = "trip to Amsterdam",
"פארק הפרחים" = "the flower park", "מסלול צהוב" = "yellow route", "Ночной Санкт Петербург" = "Saint Petersburg at night"),
generic words (sunrise, night, team, road to, boat rent) and repeated parts. "folders" and "hints" give the trip context.

For every item return:
- name: a concise, clean ENGLISH place name for public display, most specific first, at most 3 comma-separated parts,
  ending with the country: e.g. "Keukenhof Gardens, Lisse, Netherlands", "Rostral Columns, Saint Petersburg, Russia",
  "Cantabria, Spain", "Reichstag, Berlin, Germany". Use the well-known English name of landmarks; translate Hebrew/Russian.
  Never include day numbers, dates, numbering, trip words, times of day or other folder clutter.
  If no place below the country can be identified, return the city of the trip ("Amsterdam, Netherlands") or just the country.
- country: the English country name ("Netherlands", "Russia", "Germany").
- kind: landmark | city | region | road | country (what "name" refers to).
- lat, lng: WGS84 coordinates of that place (its centre for a city / region / country). Use null if you are not confident.
Return exactly one result per input item, with the same "key".`;

const SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      key: { type: "STRING" },
      name: { type: "STRING" },
      country: { type: "STRING" },
      kind: { type: "STRING", enum: KINDS },
      lat: { type: "NUMBER", nullable: true },
      lng: { type: "NUMBER", nullable: true },
    },
    required: ["key", "name", "country", "kind"],
  },
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface AiPlacesOptions {
  batchSize?: number;
  timeoutMs?: number;
  /** Called before each Gemini request (pacing / call caps); throw to stop */
  beforeCall?: () => void | Promise<void>;
  log?: (msg: string) => void;
}

/** Validate one raw Gemini answer: canonical country, finite coordinates inside that country, a clean name */
function validate(q: PlaceQuery, a: Partial<PlaceAnswer> | undefined): PlaceAnswer | null {
  if (!a || typeof a.name !== "string") return null;
  const name = a.name.replace(/\s+/g, " ").trim();
  if (!name || !looksClean(name)) return null;
  const country = canonicalCountry(a.country ?? null) ?? canonicalCountry(name.split(",").pop() ?? null) ?? null;
  const kind = KINDS.includes(a.kind as PlaceKind) ? (a.kind as PlaceKind) : "unknown";
  let lat = typeof a.lat === "number" && Number.isFinite(a.lat) && Math.abs(a.lat) <= 90 ? a.lat : null;
  let lng = typeof a.lng === "number" && Number.isFinite(a.lng) && Math.abs(a.lng) <= 180 ? a.lng : null;
  if (lat == null || lng == null || (lat === 0 && lng === 0)) lat = lng = null;
  // a landmark the model placed outside its own country is a hallucination: drop the coordinates, keep the name
  if (lat != null && lng != null && country && polygonsLoaded && !inCountry(country, lat, lng, 0.3)) lat = lng = null;
  return { key: q.key, name, country, kind, lat, lng };
}

/**
 * Clean + geocode labels with Gemini, `batchSize` per request. Retries 429 / transient errors with backoff.
 * Items Gemini could not answer are missing from the result map.
 */
export async function aiPlaces(items: PlaceQuery[], opts: AiPlacesOptions = {}): Promise<Map<string, PlaceAnswer>> {
  const out = new Map<string, PlaceAnswer>();
  const size = opts.batchSize ?? 25;
  const log = opts.log ?? ((m: string) => console.log(m));
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    const payload = batch.map((q) => ({ key: q.key, raw: q.raw, folders: q.folders ?? undefined, hints: q.hints?.length ? q.hints : undefined, country: q.country ?? undefined }));
    let answers: Partial<PlaceAnswer>[] | null = null;
    for (let attempt = 0; attempt < 6 && !answers; attempt++) {
      await opts.beforeCall?.();
      try {
        answers = await geminiJson<Partial<PlaceAnswer>[]>([{ text: `${PROMPT}\n\nItems:\n${JSON.stringify(payload)}` }], SCHEMA, opts.timeoutMs ?? 90_000, opts.timeoutMs ?? 90_000);
      } catch (err) {
        const msg = String((err as Error).message ?? err);
        const retry = /429|RESOURCE_EXHAUSTED|rate|5\d\d|timeout|aborted|fetch failed|ECONNRESET|ETIMEDOUT|Unexpected end|JSON/i.test(msg);
        if (!retry || attempt === 5) {
          log(`    Gemini place lookup failed for ${batch.length} labels (${msg.slice(0, 140)})`);
          break;
        }
        const backoff = Math.min(60_000, 4000 * 2 ** attempt);
        log(`    Gemini busy (${msg.slice(0, 60)}), retrying in ${Math.round(backoff / 1000)}s…`);
        await sleep(backoff);
      }
    }
    const byKey = new Map((answers ?? []).map((a) => [String(a.key), a]));
    for (const q of batch) {
      const v = validate(q, byKey.get(q.key));
      if (v) out.set(q.key, v);
    }
    log(`  Gemini places: ${Math.min(i + size, items.length)}/${items.length}`);
  }
  return out;
}
