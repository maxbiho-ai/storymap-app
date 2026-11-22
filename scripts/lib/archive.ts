/**
 * Read-only archive scanning for scripts/import-trip.ts.
 * Nothing in here writes, moves or deletes: only readdir / stat / read.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const JPEG_RE = /\.jpe?g$/i;
const RAW_EXT = new Set([".nef", ".nrw", ".tif", ".tiff", ".dng", ".cr2", ".cr3", ".arw", ".raf", ".orf", ".rw2"]);
/** Phone photos: 20150713_142530.jpg (optionally with a suffix) */
const PHONE_RE = /^\d{8}[_-]\d{6}/;
const JUNK = new Set(["thumbs.db", "desktop.ini", ".ds_store"]);
/** Lightroom export / edit suffixes: -2, -3, -4, -Edit, -Edit-Edit, -Edit-2 */
const SUFFIX_RE = /(?:-(?:edit|\d{1,2}))+$/i;

export interface ScanFile {
  abs: string;
  /** folder relative to --dir, forward slashes ("" = the trip folder itself) */
  relDir: string;
  name: string;
  stem: string;
  ext: string;
  mtimeMs: number;
  size: number;
}

export interface Candidate {
  file: ScanFile;
  /** "<trip-folder>/<subfolder>/dsc_2366": lowercase, NFC, suffixes stripped */
  key: string;
  canonical: string;
  /** Other files of the same shot (older versions, originals, raws), for EXIF fallback */
  siblings: ScanFile[];
  /** Why it counts as an edited photo */
  reason: "suffix" | "raw-original" | "timelapse";
  flight: boolean;
  /** The middle frame of a timelapse / sequence folder (--timelapse-hero) */
  timelapse?: boolean;
}

export interface ScanResult {
  candidates: Candidate[];
  phones: Map<string, ScanFile[]>; // relDir -> phone photos
  skipped: { phone: number; unedited: number; superseded: number };
  /** Photos in Flight / Ben Gurion folders (imported only with --include-flights) */
  flights: Candidate[];
}

const norm = (s: string) => s.normalize("NFC");

export async function walk(root: string): Promise<ScanFile[]> {
  const out: ScanFile[] = [];
  async function rec(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      console.warn(`  ! cannot read ${dir}: ${(err as Error).message}`);
      return;
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (/^(\$recycle\.bin|system volume information)$/i.test(e.name)) continue;
        await rec(abs);
      } else if (e.isFile() && !JUNK.has(e.name.toLowerCase())) {
        const st = await fs.stat(abs);
        const ext = path.extname(e.name).toLowerCase();
        out.push({
          abs,
          relDir: norm(path.relative(root, dir).split(path.sep).join("/")),
          name: e.name,
          stem: e.name.slice(0, e.name.length - ext.length),
          ext,
          mtimeMs: st.mtimeMs,
          size: st.size,
        });
      }
    }
  }
  await rec(root);
  return out;
}

export function canonicalStem(stem: string): string {
  return stem.replace(SUFFIX_RE, "");
}

/** Higher = newer edit. Unsuffixed (the original) = 0. */
function versionRank(stem: string): [number, number] {
  const m = SUFFIX_RE.exec(stem);
  if (!m) return [0, 0];
  const parts = m[0].split("-").filter(Boolean);
  const nums = parts.filter((p) => /^\d+$/.test(p)).map(Number);
  const edits = parts.filter((p) => /^edit$/i.test(p)).length;
  return [Math.max(1, ...nums), edits];
}

const isFlightName = (s: string) => /flight|ben[\s_-]*gurion|airport|נתב|טיסה/i.test(s);
export const isFlightPath = (relDir: string, tripName: string) =>
  isFlightName(tripName) || relDir.split("/").some(isFlightName);

export function scanArchive(files: ScanFile[], tripName: string, includeFlights: boolean): ScanResult {
  const phones = new Map<string, ScanFile[]>();
  const skipped = { phone: 0, unedited: 0, superseded: 0 };
  // group everything per folder + canonical stem
  const groups = new Map<string, ScanFile[]>();
  for (const f of files) {
    const isJpg = JPEG_RE.test(f.name);
    if (isJpg && PHONE_RE.test(f.stem)) {
      skipped.phone++;
      const list = phones.get(f.relDir) ?? [];
      list.push(f);
      phones.set(f.relDir, list);
      continue;
    }
    if (!isJpg && !RAW_EXT.has(f.ext)) continue;
    const k = `${f.relDir}\u0000${canonicalStem(f.stem).toLowerCase()}`;
    const list = groups.get(k) ?? [];
    list.push(f);
    groups.set(k, list);
  }

  const candidates: Candidate[] = [];
  const flights: Candidate[] = [];
  for (const group of groups.values()) {
    const jpgs = group.filter((f) => JPEG_RE.test(f.name));
    if (!jpgs.length) continue;
    const suffixed = jpgs.filter((f) => SUFFIX_RE.test(f.stem));
    const hasRaw = group.some((f) => RAW_EXT.has(f.ext));
    let pick: ScanFile;
    let reason: Candidate["reason"];
    if (suffixed.length) {
      // highest version wins; mtime breaks ties (e.g. -Edit vs -2)
      pick = [...suffixed].sort((a, b) => {
        const [an, ae] = versionRank(a.stem);
        const [bn, be] = versionRank(b.stem);
        return bn - an || be - ae || b.mtimeMs - a.mtimeMs;
      })[0];
      reason = "suffix";
      skipped.superseded += jpgs.length - 1;
    } else if (hasRaw) {
      pick = [...jpgs].sort((a, b) => b.mtimeMs - a.mtimeMs)[0]; // export sitting next to its raw
      reason = "raw-original";
      skipped.superseded += jpgs.length - 1;
    } else {
      skipped.unedited += jpgs.length;
      continue;
    }
    const canonical = canonicalStem(pick.stem);
    const key = norm([tripName, pick.relDir, canonical].filter(Boolean).join("/")).toLowerCase();
    const flight = isFlightPath(pick.relDir, tripName);
    const cand: Candidate = { file: pick, key, canonical, siblings: group.filter((f) => f !== pick), reason, flight };
    if (flight) flights.push(cand);
    if (!flight || includeFlights) candidates.push(cand);
  }
  candidates.sort((a, b) => a.key.localeCompare(b.key));
  flights.sort((a, b) => a.key.localeCompare(b.key));
  return { candidates, phones, skipped, flights };
}

// ---------------------------------------------------------------------------
// Place names from folders
// ---------------------------------------------------------------------------

export interface Country {
  name: string;
  iso: string;
  /** Sub-region used as extra context for the geocoder ("Black Forest") */
  region?: string;
  airport: string;
  he: string[];
}

export const COUNTRIES: Country[] = [
  { name: "Iceland", iso: "is", airport: "Keflavik International Airport", he: ["איסלנד"] },
  { name: "Bulgaria", iso: "bg", airport: "Sofia Airport", he: ["בולגריה"] },
  { name: "Austria", iso: "at", airport: "Vienna International Airport", he: ["אוסטריה"] },
  { name: "China", iso: "cn", airport: "Beijing Capital International Airport", he: ["סין"] },
  { name: "Croatia", iso: "hr", airport: "Zagreb Airport", he: ["קרואטיה"] },
  { name: "Spain", iso: "es", airport: "Madrid Barajas Airport", he: ["ספרד"] },
  { name: "Netherlands", iso: "nl", airport: "Amsterdam Airport Schiphol", he: ["הולנד"] },
  { name: "Germany", iso: "de", region: "Black Forest", airport: "Stuttgart Airport", he: ["היער השחור"] },
  // common extras
  { name: "Germany", iso: "de", airport: "Frankfurt Airport", he: ["גרמניה"] },
  { name: "Italy", iso: "it", airport: "Rome Fiumicino Airport", he: ["איטליה"] },
  { name: "Greece", iso: "gr", airport: "Athens International Airport", he: ["יוון"] },
  { name: "France", iso: "fr", airport: "Paris Charles de Gaulle Airport", he: ["צרפת"] },
  { name: "Switzerland", iso: "ch", airport: "Zurich Airport", he: ["שוויץ"] },
  { name: "Norway", iso: "no", airport: "Oslo Airport", he: ["נורבגיה"] },
  { name: "Portugal", iso: "pt", airport: "Lisbon Airport", he: ["פורטוגל"] },
  { name: "Georgia", iso: "ge", airport: "Tbilisi International Airport", he: ["גאורגיה"] },
  { name: "Japan", iso: "jp", airport: "Narita International Airport", he: ["יפן"] },
  { name: "Thailand", iso: "th", airport: "Suvarnabhumi Airport", he: ["תאילנד"] },
  { name: "United Kingdom", iso: "gb", airport: "London Heathrow Airport", he: ["אנגליה", "בריטניה"] },
  { name: "Scotland", iso: "gb", airport: "Edinburgh Airport", he: ["סקוטלנד"] },
  { name: "Slovenia", iso: "si", airport: "Ljubljana Airport", he: ["סלובניה"] },
  { name: "Czechia", iso: "cz", airport: "Vaclav Havel Airport Prague", he: ["צכיה", "צ׳כיה"] },
  { name: "Hungary", iso: "hu", airport: "Budapest Ferenc Liszt International Airport", he: ["הונגריה"] },
  { name: "Poland", iso: "pl", airport: "Warsaw Chopin Airport", he: ["פולין"] },
  { name: "Turkey", iso: "tr", airport: "Istanbul Airport", he: ["טורקיה"] },
  { name: "Montenegro", iso: "me", airport: "Podgorica Airport", he: ["מונטנגרו"] },
  { name: "Albania", iso: "al", airport: "Tirana International Airport", he: ["אלבניה"] },
  { name: "Romania", iso: "ro", airport: "Henri Coanda International Airport", he: ["רומניה"] },
  { name: "Ireland", iso: "ie", airport: "Dublin Airport", he: ["אירלנד"] },
  { name: "Faroe Islands", iso: "fo", airport: "Vagar Airport", he: ["איי פארו"] },
];

/** Country from any folder name in the path (deepest first): Hebrew keyword or the English name */
export function detectCountry(parts: string[]): Country | null {
  for (const part of [...parts].reverse()) {
    const p = norm(part);
    // longest Hebrew keyword first so "היער השחור" beats shorter ones
    const hit = COUNTRIES.flatMap((c) => c.he.map((k) => ({ c, k })))
      .filter(({ k }) => p.includes(k))
      .sort((a, b) => b.k.length - a.k.length)[0];
    if (hit) return hit.c;
    const en = COUNTRIES.find((c) => new RegExp(`\\b${c.name}\\b`, "i").test(p));
    if (en) return en;
  }
  return null;
}

export interface FolderPlace {
  /** Text to geocode before ", <country>", or null if the folder gives only the country */
  spot: string | null;
  /** Cleaned folder label for display */
  label: string | null;
  kind: "spot" | "road" | "flight" | "country";
  /** Folder (relative path) the spot came from: the geocode cache key */
  from: string;
}

/** "13 - 25.07.15 - Gjainfoss" → "Gjainfoss"; "" if only a date/number */
export function cleanFolderName(name: string): string {
  return norm(name).replace(/^[\d\s.\-–_/,]+/, "").replace(/[\s\-–_,.]+$/, "").trim();
}

/** "road 208, 209" → "Route 208"; "road F208" / "F208" → "F208"; null if not a road folder */
export function roadFromName(name: string): string | null {
  const m =
    /^(?:road|route|rd|highway|hwy|דרך|כביש)\s*[-_.]?\s*([a-z]?\d{1,4})\b/i.exec(name) ?? /^([fF]\d{1,4})\b/.exec(name);
  if (!m) return null;
  const id = m[1].toUpperCase();
  return /^F/.test(id) ? id : `Route ${id}`;
}

/** Deepest meaningful destination folder under the trip root */
export function placeFromFolders(relDir: string): FolderPlace {
  const parts = relDir ? relDir.split("/") : [];
  for (let i = parts.length - 1; i >= 0; i--) {
    const raw = parts[i];
    const from = parts.slice(0, i + 1).join("/");
    if (isFlightName(raw)) return { spot: null, label: cleanFolderName(raw) || raw, kind: "flight", from };
    const cleaned = cleanFolderName(raw);
    if (!cleaned) continue;
    const road = roadFromName(cleaned);
    if (road) return { spot: road, label: road, kind: "road", from };
    return { spot: cleaned, label: cleaned, kind: "spot", from };
  }
  return { spot: null, label: null, kind: "country", from: "" };
}

// ---------------------------------------------------------------------------
// Timelapse / panorama sequence folders
// ---------------------------------------------------------------------------

const TIMELAPSE_NAME_RE = /timelaps|timelapse|pano raw|sequence/i;
const PROJECT_EXT = new Set([".prproj", ".prin", ".aep"]);
const FRAME_RE = /^DSC_(\d+)$/i;
const MIN_SEQUENCE = 25; // more than this many small sequential frames = a timelapse
const FRAME_MAX_EDGE = 2048;

export interface TimelapseFolder {
  relDir: string;
  why: string;
  /** All camera JPGs of the folder in file order */
  frames: ScanFile[];
}

const byName = (a: ScanFile, b: ScanFile) => a.name.localeCompare(b.name, "en", { numeric: true });

/** Folders that hold a timelapse / raw panorama sequence instead of single photos */
export async function detectTimelapse(files: ScanFile[], tripName: string): Promise<Map<string, TimelapseFolder>> {
  const dirs = new Map<string, ScanFile[]>();
  for (const f of files) {
    const list = dirs.get(f.relDir) ?? [];
    list.push(f);
    dirs.set(f.relDir, list);
  }
  const out = new Map<string, TimelapseFolder>();
  for (const [relDir, list] of dirs) {
    const frames = list.filter((f) => JPEG_RE.test(f.name) && !PHONE_RE.test(f.stem)).sort(byName);
    if (!frames.length) continue;
    const names = relDir ? relDir.split("/") : [tripName];
    let why = "";
    const hit = names.find((n) => TIMELAPSE_NAME_RE.test(n));
    if (hit) why = `folder name "${hit}"`;
    else if (list.some((f) => PROJECT_EXT.has(f.ext))) why = "video project file (.prproj/.prin/.aep)";
    else {
      const dsc = frames.filter((f) => FRAME_RE.test(f.stem));
      if (dsc.length > MIN_SEQUENCE) {
        // small sequential frames: header-only reads
        const small: number[] = [];
        for (const f of dsc) {
          try {
            const m = await sharp(f.abs).metadata();
            if (Math.max(m.width ?? 0, m.height ?? 0) <= FRAME_MAX_EDGE) small.push(Number(FRAME_RE.exec(f.stem)![1]));
          } catch {
            /* unreadable: not a frame */
          }
        }
        small.sort((a, b) => a - b);
        let run = 1;
        let best = small.length ? 1 : 0;
        for (let i = 1; i < small.length; i++) {
          run = small[i] === small[i - 1] + 1 ? run + 1 : 1;
          best = Math.max(best, run);
        }
        if (best > MIN_SEQUENCE) why = `${best} sequential small frames (<= ${FRAME_MAX_EDGE}px)`;
      }
    }
    if (why) out.set(relDir, { relDir, why, frames });
  }
  return out;
}

/** The single middle frame, under a stable key so re-runs update the same pin */
export function timelapseHero(t: TimelapseFolder, tripName: string): Candidate {
  const frame = t.frames[Math.floor(t.frames.length / 2)];
  return {
    file: frame,
    key: norm([tripName, t.relDir, "timelapse-hero"].filter(Boolean).join("/")).toLowerCase(),
    canonical: frame.stem,
    siblings: [],
    reason: "timelapse",
    flight: isFlightPath(t.relDir, tripName),
    timelapse: true,
  };
}
