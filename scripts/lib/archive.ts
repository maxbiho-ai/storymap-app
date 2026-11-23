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
  { name: "South Korea", iso: "kr", airport: "Incheon International Airport", he: ["דרום קוריאה"] },
  { name: "Uganda", iso: "ug", airport: "Entebbe International Airport", he: ["אוגנדה"] },
  { name: "Kenya", iso: "ke", airport: "Jomo Kenyatta International Airport", he: ["קניה", "קניה"] },
  { name: "Tanzania", iso: "tz", airport: "Julius Nyerere International Airport", he: ["טנזניה"] },
  { name: "Vietnam", iso: "vn", airport: "Noi Bai International Airport", he: ["וייטנאם"] },
  { name: "Indonesia", iso: "id", airport: "Ngurah Rai International Airport", he: ["אינדונזיה"] },
  { name: "Morocco", iso: "ma", airport: "Mohammed V International Airport", he: ["מרוקו"] },
  { name: "Nepal", iso: "np", airport: "Tribhuvan International Airport", he: ["נפאל"] },
  { name: "India", iso: "in", airport: "Indira Gandhi International Airport", he: ["הודו"] },
  { name: "Mexico", iso: "mx", airport: "Mexico City International Airport", he: ["מקסיקו"] },
];

// More countries (found via hub cities / aliases below)
COUNTRIES.push(
  { name: "Slovakia", iso: "sk", airport: "Bratislava Airport", he: ["סלובקיה"] },
  { name: "Belgium", iso: "be", airport: "Brussels Airport", he: ["בלגיה"] },
  { name: "Denmark", iso: "dk", airport: "Copenhagen Airport", he: ["דנמרק"] },
  { name: "Sweden", iso: "se", airport: "Stockholm Arlanda Airport", he: ["שוודיה"] },
  { name: "Finland", iso: "fi", airport: "Helsinki Airport", he: ["פינלנד"] },
  { name: "Serbia", iso: "rs", airport: "Belgrade Nikola Tesla Airport", he: ["סרביה"] },
  { name: "Bosnia and Herzegovina", iso: "ba", airport: "Sarajevo International Airport", he: ["בוסניה"] },
  { name: "Lithuania", iso: "lt", airport: "Vilnius Airport", he: ["ליטא"] },
  { name: "Latvia", iso: "lv", airport: "Riga International Airport", he: ["לטביה"] },
  { name: "Estonia", iso: "ee", airport: "Tallinn Airport", he: ["אסטוניה"] },
  { name: "Luxembourg", iso: "lu", airport: "Luxembourg Airport", he: ["לוקסמבורג"] },
  { name: "Egypt", iso: "eg", airport: "Cairo International Airport", he: ["מצרים"] },
  { name: "Jordan", iso: "jo", airport: "Queen Alia International Airport", he: ["ירדן"] },
  { name: "Cyprus", iso: "cy", airport: "Larnaca Airport", he: ["קפריסין"] },
);

/** Alternative country spellings → ISO */
const COUNTRY_ALIASES: Record<string, string> = {
  "czech republic": "cz",
  czechia: "cz",
  uk: "gb",
  england: "gb",
  wales: "gb",
  "great britain": "gb",
  holland: "nl",
  "the netherlands": "nl",
  "republic of korea": "kr",
  korea: "kr",
};

/** Major cities / hubs → ISO (matched as whole words in a folder name) */
const HUB_CITIES: Record<string, string> = {
  vienna: "at", wien: "at", salzburg: "at", innsbruck: "at", hallstatt: "at",
  bratislava: "sk", kosice: "sk",
  berlin: "de", munich: "de", frankfurt: "de", hamburg: "de", cologne: "de", dresden: "de", stuttgart: "de", dusseldorf: "de", nuremberg: "de",
  brussels: "be", bruges: "be", antwerp: "be", ghent: "be",
  amsterdam: "nl", rotterdam: "nl", "the hague": "nl", utrecht: "nl",
  paris: "fr", lyon: "fr", marseille: "fr", strasbourg: "fr", bordeaux: "fr",
  london: "gb", edinburgh: "gb", manchester: "gb", glasgow: "gb", liverpool: "gb",
  istanbul: "tr", ankara: "tr", antalya: "tr", cappadocia: "tr",
  prague: "cz", brno: "cz",
  krakow: "pl", warsaw: "pl", gdansk: "pl", wroclaw: "pl",
  budapest: "hu",
  rome: "it", milan: "it", venice: "it", florence: "it", naples: "it", turin: "it", verona: "it",
  madrid: "es", barcelona: "es", seville: "es", valencia: "es", granada: "es",
  lisbon: "pt", porto: "pt",
  athens: "gr", thessaloniki: "gr", santorini: "gr",
  zurich: "ch", geneva: "ch", bern: "ch", lucerne: "ch", interlaken: "ch",
  oslo: "no", bergen: "no", tromso: "no",
  stockholm: "se", copenhagen: "dk", helsinki: "fi",
  reykjavik: "is", keflavik: "is",
  dublin: "ie", sofia: "bg", plovdiv: "bg", bucharest: "ro", zagreb: "hr", dubrovnik: "hr", ljubljana: "si", belgrade: "rs", sarajevo: "ba",
  tirana: "al", podgorica: "me", kotor: "me", tbilisi: "ge", vilnius: "lt", riga: "lv", tallinn: "ee", luxembourg: "lu",
  seoul: "kr", busan: "kr", jeju: "kr", tokyo: "jp", kyoto: "jp", osaka: "jp", bangkok: "th", beijing: "cn", shanghai: "cn",
  kampala: "ug", entebbe: "ug", nairobi: "ke", mombasa: "ke", arusha: "tz", zanzibar: "tz", hanoi: "vn", bali: "id", marrakech: "ma", kathmandu: "np",
  delhi: "in", cairo: "eg", amman: "jo", petra: "jo",
};

/** Rough country centre + radius (km). A geocode further than radius + SLACK_KM away is an outlier. */
const COUNTRY_BOUNDS: Record<string, [number, number, number]> = {
  is: [64.9, -18.6, 350], bg: [42.7, 25.5, 250], at: [47.6, 14.1, 300], cn: [35, 103, 2600], hr: [45.1, 15.2, 300],
  es: [40.3, -3.7, 1300], nl: [52.2, 5.3, 150], de: [51.2, 10.4, 450], it: [42.5, 12.5, 700], gr: [39, 22.5, 550],
  fr: [46.6, 2.5, 600], ch: [46.8, 8.2, 200], no: [64, 12, 1100], pt: [39.6, -8, 400], ge: [42.3, 43.4, 250],
  jp: [36.5, 138, 1500], th: [15, 101, 800], gb: [54, -2.5, 600], si: [46.1, 14.8, 150], cz: [49.8, 15.5, 250],
  hu: [47.1, 19.4, 250], pl: [52, 19.4, 400], tr: [39, 35, 1000], me: [42.8, 19.2, 150], al: [41.1, 20.1, 200],
  ro: [45.9, 25, 400], ie: [53.4, -8, 250], fo: [62, -6.9, 100], kr: [36.4, 127.8, 350], ug: [1.3, 32.4, 450],
  ke: [0.2, 37.9, 700], tz: [-6.3, 34.9, 800], vn: [16, 106, 900], id: [-2.5, 118, 2500], ma: [31.8, -6.5, 800],
  np: [28.3, 84, 500], in: [22, 79, 2000], mx: [23.6, -102.5, 1800], sk: [48.7, 19.5, 250], be: [50.6, 4.6, 150],
  dk: [56, 10, 350], se: [62, 15, 900], fi: [64.5, 26, 800], rs: [44, 21, 250], ba: [44, 17.8, 200],
  lt: [55.3, 23.9, 200], lv: [56.9, 24.9, 200], ee: [58.7, 25.5, 200], lu: [49.8, 6.1, 60], eg: [26.5, 29.8, 900],
  jo: [31.2, 36.8, 300], cy: [35, 33, 150],
};
const SLACK_KM = 500;

export const haversineKm = (aLat: number, aLng: number, bLat: number, bLng: number): number => {
  const r = Math.PI / 180;
  const h = Math.sin(((bLat - aLat) * r) / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(((bLng - aLng) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
};

/** Outlier guard: is (lat, lng) within ~500 km of the country's bounds? Unknown country → true. */
export function plausibleInCountry(iso: string, lat: number, lng: number): boolean {
  const b = COUNTRY_BOUNDS[iso];
  if (!b) return true;
  return haversineKm(lat, lng, b[0], b[1]) <= b[2] + SLACK_KM;
}

/** Centre of a known country, for the last-resort fallback */
export function countryCenter(iso: string): { lat: number; lng: number } | null {
  const b = COUNTRY_BOUNDS[iso];
  return b ? { lat: b[0], lng: b[1] } : null;
}

export const countryByIso = (iso: string): Country | null =>
  COUNTRIES.find((c) => c.iso === iso && !c.region) ?? COUNTRIES.find((c) => c.iso === iso) ?? null;

const plain = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const titleCase = (s: string) => s.replace(/\b\p{L}/gu, (m) => m.toUpperCase());

export interface Resolved {
  country: Country;
  /** Hub city that matched ("Bratislava"), when the matching folder named a city */
  city: string | null;
  /** Index in the `parts` array handed to resolveCountry where the match was found */
  idx: number;
}

function matchSegment(seg: string): { country: Country; city: string | null } | null {
  const p = norm(seg);
  // longest Hebrew keyword first so "היער השחור" beats shorter ones
  const heHit = COUNTRIES.flatMap((c) => c.he.map((k) => ({ c, k })))
    .filter(({ k }) => p.includes(k))
    .sort((a, b) => b.k.length - a.k.length)[0];
  const lp = plain(p);
  let country: Country | null = heHit?.c ?? null;
  if (!country) country = COUNTRIES.find((c) => new RegExp(`\\b${escRe(plain(c.name))}\\b`).test(lp)) ?? null;
  if (!country) {
    const alias = Object.entries(COUNTRY_ALIASES).find(([k]) => new RegExp(`\\b${escRe(k)}\\b`).test(lp));
    if (alias) country = countryByIso(alias[1]);
  }
  let city: string | null = null;
  let hubIso: string | null = null;
  for (const [h, iso] of Object.entries(HUB_CITIES)) {
    if (new RegExp(`\\b${escRe(h)}\\b`).test(lp)) {
      city = titleCase(h);
      hubIso = iso;
      break;
    }
  }
  if (!country && hubIso) country = countryByIso(hubIso);
  return country ? { country, city } : null;
}

/**
 * Bottom-up country resolution: the DEEPEST folder that names a known country or hub city wins
 * ("Trip 35 - Vienna/30 - 30.04 - Bratislava/4 - Old Town" → Slovakia; ".../2 - 28.04 - Stephansplatz" → Austria).
 * Inside one folder name the last " - " part is tried first.
 */
export function resolveCountry(parts: string[]): Resolved | null {
  for (let i = parts.length - 1; i >= 0; i--) {
    const segs = norm(parts[i]).split(/\s+[-–]\s+/).reverse();
    for (const seg of segs) {
      const hit = matchSegment(seg);
      if (hit) return { ...hit, idx: i };
    }
  }
  return null;
}

/** Country from any folder name in the path (deepest first) */
export function detectCountry(parts: string[]): Country | null {
  return resolveCountry(parts)?.country ?? null;
}

/**
 * Country named in the ROOT trip folder: "Trip 49 - 17.09 - 1.10.26 - South Korea" → South Korea.
 * Known countries / hub cities match anywhere in the folder name; otherwise the last " - " segment is used as an
 * ad-hoc country (no ISO filter), so subfolder geocoding still gets a country without --country.
 */
export function countryFromTripName(tripName: string): Country | null {
  const name = norm(tripName);
  const known = detectCountry([name]);
  if (known) return known;
  const last = name.split(/\s+[-–]\s+/).pop()?.trim() ?? "";
  if (!/^[\p{L}][\p{L}\s.'’]{1,40}$/u.test(last) || /^trip\b/i.test(last)) return null;
  return { name: last, iso: "", airport: "international airport", he: [] };
}

/** "Old Town" + city "Bratislava" + country → "Old Town, Bratislava, Slovakia" (city skipped if the spot already names it) */
export function placeLabel(spot: string | null, country: Country | null, city: string | null): string | null {
  const c = city && spot && plain(spot).includes(plain(city)) ? null : city;
  return [spot, c, country?.name].filter(Boolean).join(", ") || null;
}

/** Mapbox queries for a folder path, deepest folder first; spots below the hub-city folder carry the city name */
export function folderQueries(relParts: string[], r: { country: Country; city: string | null; relIdx: number }): string[] {
  const out: string[] = [];
  for (let i = relParts.length; i >= 1; i--) {
    const p = placeFromFolders(relParts.slice(0, i).join("/"));
    if (!p.spot || p.kind === "flight") continue;
    const withCity = r.city && r.relIdx < i - 1 && !plain(p.spot).includes(plain(r.city));
    if (r.country.region) out.push([p.spot, r.country.region, r.country.name].join(", "));
    if (withCity) out.push([p.spot, r.city, r.country.name].join(", "));
    out.push([p.spot, r.country.name].join(", "));
  }
  return [...new Set(out)];
}

// ---------------------------------------------------------------------------
// Mapbox geocoding (cached). `iso` is sent as &country= so namesakes (Berlin VT, Rome NY) never win.
// ---------------------------------------------------------------------------

export interface Geo {
  lat: number;
  lng: number;
  name: string;
}
const geoCache = new Map<string, Geo | null>();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function geocode(q: string, iso: string | null, token: string): Promise<Geo | null> {
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
        await wait(1500 * 2 ** attempt);
        continue;
      }
      if (!res.ok) break;
      const data = (await res.json()) as { features?: { geometry?: { coordinates?: [number, number] }; properties?: { name?: string; full_address?: string } }[] };
      const f = data.features?.[0];
      const c = f?.geometry?.coordinates;
      if (c && Number.isFinite(c[0]) && Number.isFinite(c[1])) result = { lat: c[1], lng: c[0], name: f?.properties?.full_address ?? f?.properties?.name ?? q };
      break;
    } catch {
      await wait(1000 * 2 ** attempt);
    }
  }
  geoCache.set(key, result);
  return result;
}

/**
 * Geocode the queries in order, rejecting outliers (outside the country's bounds + 500 km). Falls back to the hub
 * city, then the country centre. Returns null only if nothing is known.
 */
export async function geocodeWithGuard(
  queries: string[],
  r: { country: Country; city: string | null },
  token: string,
): Promise<{ geo: Geo; used: string; fallback: boolean } | null> {
  const iso = r.country.iso || null;
  const ok = (g: Geo | null) => (g && (!iso || plausibleInCountry(iso, g.lat, g.lng)) ? g : null);
  for (const q of queries) {
    const g = ok(await geocode(q, iso, token));
    if (g) return { geo: g, used: q, fallback: false };
  }
  if (r.city) {
    const q = `${r.city}, ${r.country.name}`;
    const g = ok(await geocode(q, iso, token));
    if (g) return { geo: g, used: q, fallback: true };
  }
  const c = iso ? countryCenter(iso) : null;
  if (c) return { geo: { lat: c.lat, lng: c.lng, name: r.country.name }, used: r.country.name, fallback: true };
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
