/**
 * Audit + repair of the 2009–2021 archive (taken_at 2009-01-01 … 2021-12-31 inclusive; 2022+ is never read or touched):
 *
 *  1. location_name: strips folder clutter ("day2 -", "29.08", numbering, Hebrew / Russian folder words, trip names)
 *     and replaces it with a clean English place name from Gemini ("Keukenhof Gardens, Lisse, Netherlands").
 *     The original string is copied into source_folder (admin-only) when that is still empty.
 *  2. GPS: older cameras wrote corrupted EXIF GPS (Keukenhof in Wyoming, Cantabria off Menorca). A photo is flagged when
 *       - its point is outside the expected country (country polygons, ~15 km coast/border slack), or over open sea, or
 *       - it is far from the named place (landmark / city > 60 km, region > 250 km). Labels that name only a
 *         country ("עליה לגנדולה, Bulgaria") or a journey ("train to Salzburg") get the country check only.
 *     Flagged photos get the Gemini landmark coordinates: latitude, longitude, country, gps_source = 'ai_geocoded'.
 *
 *   npm run fix:historical -- --dry-run       # default: report only, writes nothing to Supabase
 *   npm run fix:historical -- --apply         # writes the changes
 *   flags: --refresh  ask Gemini again instead of reusing scripts/.cache/historical-places.json
 *          --verbose  list every change (default: the first 60 of each kind; the full list is always in the CSV report)
 *
 * Manual locations (is_manual_location = true) keep their coordinates. Flight / aerial photos skip the GPS check.
 * Needs migration 012 for --apply (source_folder / country / gps_source columns); a dry run works without it.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isFlightPhoto } from "@/lib/countryGeo";
import { canonicalCountry, countryFromRegionHint } from "@/lib/countries";
import { resolveCountry as archiveCountry } from "./lib/archive";
import {
  aiPlaces,
  countryAt,
  countryFromTag,
  haversineKm,
  inCountry,
  isDirtyLocationName,
  loadCountryPolygons,
  stripFolderClutter,
  type PlaceAnswer,
  type PlaceKind,
  type PlaceQuery,
} from "./lib/places";

const FROM = "2009-01-01T00:00:00Z";
const TO_EXCLUSIVE = "2022-01-01T00:00:00Z";
const CACHE_DIR = path.resolve(process.cwd(), "scripts/.cache");
const CACHE_FILE = path.join(CACHE_DIR, "historical-places.json");
const REPORT_FILE = path.join(CACHE_DIR, "historical-locations-report.csv");
/** How far a photo may be from the place its name names */
const MAX_KM: Partial<Record<PlaceKind, number>> = { landmark: 60, city: 60, region: 250 };
/** "train to Salzburg", "drive to Hekla", "to Hekla": taken on the way, so no distance check against the destination */
const TRANSIT = /^(?:(?:train|bus|ferry|drive|driving|road|way|on the way)\s+to|to)\s/i;

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

interface Row {
  id: string;
  source_key: string | null;
  location_name: string | null;
  latitude: number;
  longitude: number;
  tags: string[] | null;
  taken_at: string;
  camera_model: string | null;
  is_manual_location: boolean | null;
  source_folder?: string | null;
  country?: string | null;
  gps_source?: string | null;
}

interface Plan {
  row: Row;
  key: string;
  expected: string | null;
  newName: string | null;
  gpsReason: string | null;
  fix: { lat: number; lng: number; source: "ai_geocoded" } | null;
  unresolved: string | null;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const fmt = (lat: number, lng: number) => `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
const csv = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const tripOf = (r: Row) => (r.source_key ? r.source_key.split("/")[0] : "");
const foldersOf = (r: Row) => (r.source_key ? r.source_key.split("/").slice(0, -1).join("/") : "");

/** Country this photo should be in, without AI: a country / region named in location_name, a country tag, the trip folder */
function deterministicCountry(r: Row): string | null {
  const fromName = countryFromRegionHint(r.location_name);
  if (fromName) return fromName;
  for (const t of r.tags ?? []) {
    const c = countryFromTag(t);
    if (c) return c;
  }
  const parts = r.source_key ? r.source_key.split("/").slice(0, -1) : [];
  const res = archiveCountry(parts);
  return res ? canonicalCountry(res.country.name) : null;
}

async function fetchRows(db: SupabaseClient): Promise<{ rows: Row[]; has012: boolean }> {
  const base = "id, source_key, location_name, latitude, longitude, tags, taken_at, camera_model, is_manual_location";
  let cols = `${base}, source_folder, country, gps_source`;
  let has012 = true;
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("photos").select(cols).gte("taken_at", FROM).lt("taken_at", TO_EXCLUSIVE).order("id").range(from, from + 999);
    if (error) {
      if (has012 && /source_folder|gps_source|country/.test(error.message)) {
        has012 = false;
        cols = base;
        rows.length = 0;
        from = -1000;
        continue;
      }
      throw new Error(error.message);
    }
    rows.push(...((data ?? []) as unknown as Row[]));
    if (!data || data.length < 1000) break;
  }
  return { rows, has012 };
}

function loadCache(): Record<string, PlaceAnswer> {
  try {
    return JSON.parse(readFileSync(CACHE_FILE, "utf8"));
  } catch {
    return {};
  }
}

async function main() {
  loadEnv();
  const apply = process.argv.includes("--apply");
  const refresh = process.argv.includes("--refresh");
  const verbose = process.argv.includes("--verbose");
  if (apply && process.argv.includes("--dry-run")) throw new Error("Pass either --dry-run or --apply, not both");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env.local");
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY missing in .env.local (needed for names and landmark geocoding)");
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  loadCountryPolygons();

  const { rows, has012 } = await fetchRows(db);
  if (apply && !has012) throw new Error("Migration 012 is missing: run supabase/migrations/012_photo_source_folder.sql in the Supabase SQL Editor first.");
  console.log(`Historical location audit ${apply ? "(APPLY: writes to Supabase)" : "(DRY RUN: nothing is written)"}`);
  console.log(`  ${rows.length} photos taken 2009-01-01 … 2021-12-31 (2022+ untouched)${has012 ? "" : "  [migration 012 not applied yet]"}\n`);

  // ---- 1. one Gemini answer per distinct (label, trip) ----
  const keyOf = (r: Row) => `${r.location_name ?? ""}\u0001${tripOf(r)}`;
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const k = keyOf(r);
    const g = groups.get(k) ?? [];
    g.push(r);
    groups.set(k, g);
  }
  const cache = refresh ? {} : loadCache();
  const queries: PlaceQuery[] = [];
  for (const [k, g] of groups) {
    if (cache[k]) continue;
    const r = g[0];
    const hints = [...new Set(g.flatMap((x) => (x.tags ?? []).map(countryFromTag).filter((c): c is string => Boolean(c))))];
    const det = deterministicCountry(r);
    queries.push({ key: k, raw: r.location_name ?? stripFolderClutter(foldersOf(r).split("/").pop() ?? "").name, folders: foldersOf(r) || null, hints, country: det });
  }
  if (queries.length) {
    console.log(`Asking Gemini to clean + geocode ${queries.length} distinct labels (${groups.size - queries.length} cached)…`);
    const answers = await aiPlaces(queries, { batchSize: 25 });
    for (const [k, a] of answers) cache[k] = a;
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 1));
  }

  // ---- 2. plan every row ----
  const plans: Plan[] = [];
  for (const [k, g] of groups) {
    const ai = cache[k] ?? null;
    // Countries the photos may legitimately be in: the name's / tags' / trip's country and Gemini's
    const det = deterministicCountry(g[0]);
    const expected = det ?? ai?.country ?? null;
    const allowed = [...new Set([det, ai?.country].filter((c): c is string => Boolean(c)))];
    const okCountry = (lat: number, lng: number) => (allowed.length ? allowed.some((c) => inCountry(c, lat, lng)) : countryAt(lat, lng) != null);

    // Reference point for the named place: Gemini's, unless the in-country photos of this place agree on another spot
    // A label that names nothing below the country ("עליה לגנדולה, Bulgaria") makes Gemini's place a guess, and a
    // transit label ("train to Salzburg") names the destination: only the country check applies to those.
    const raw = g[0].location_name ?? "";
    const named = stripFolderClutter(raw).name.split(",").map((s) => s.trim()).filter((s) => s && !canonicalCountry(s));
    const guessed = !named.length || TRANSIT.test(raw.replace(/^(?:day|night)\s*\d+\s*(?:-\s*[\d.]+\s*)?-\s*/i, ""));
    const limit = ai && !guessed ? MAX_KM[ai.kind] : undefined;
    // Gemini's landmark is the reference. (The photos' own EXIF cluster is NOT trusted over it: a corrupting camera writes
    // the same wrong point for a whole folder, e.g. all of "Cantabria" off Menorca.)
    const ref = ai?.lat != null && ai.lng != null ? { lat: ai.lat, lng: ai.lng, source: "ai_geocoded" as const } : null;

    for (const r of g) {
      const p: Plan = { row: r, key: k, expected, newName: null, gpsReason: null, fix: null, unresolved: null };
      // name
      if (r.location_name && isDirtyLocationName(r.location_name)) {
        const fallback = stripFolderClutter(r.location_name).name;
        const name = ai?.name ?? (fallback && (!expected || fallback.endsWith(expected)) ? fallback : [fallback, expected].filter(Boolean).join(", "));
        if (name && name !== r.location_name) p.newName = name;
      }
      // GPS
      if (!r.is_manual_location && !isFlightPhoto(r.tags)) {
        const at = countryAt(r.latitude, r.longitude);
        if (!okCountry(r.latitude, r.longitude)) p.gpsReason = at ? `in ${at}, expected ${allowed.join(" / ") || "?"}` : `open sea, expected ${allowed.join(" / ") || "land"}`;
        else if (ref && limit) {
          const km = haversineKm(r.latitude, r.longitude, ref.lat, ref.lng);
          if (km > limit) p.gpsReason = `${Math.round(km)} km from ${ai?.name ?? "the named place"} (limit ${limit} km)`;
        }
        if (p.gpsReason) {
          if (ref && (!expected || inCountry(expected, ref.lat, ref.lng, 0.3) || allowed.some((c) => inCountry(c, ref!.lat, ref!.lng, 0.3)))) p.fix = { ...ref };
          else p.unresolved = ai ? "Gemini gave no confident coordinates for this place" : "Gemini could not identify this place";
        }
      }
      plans.push(p);
    }
  }

  // ---- 3. summary ----
  const dirty = plans.filter((p) => p.newName);
  const mism = plans.filter((p) => p.gpsReason);
  const kind = (p: Plan) => (p.gpsReason!.startsWith("open sea") ? "open sea" : p.gpsReason!.startsWith("in ") ? "wrong country" : "far from named place");
  const byKind = new Map<string, number>();
  mism.forEach((p) => byKind.set(kind(p), (byKind.get(kind(p)) ?? 0) + 1));
  const byTrip = new Map<string, { n: number; names: number; gps: number }>();
  for (const p of plans) {
    const t = tripOf(p.row) || "(no source_key)";
    const s = byTrip.get(t) ?? { n: 0, names: 0, gps: 0 };
    s.n++;
    if (p.newName) s.names++;
    if (p.gpsReason) s.gps++;
    byTrip.set(t, s);
  }
  const byCamera = new Map<string, number>();
  mism.forEach((p) => byCamera.set(p.row.camera_model ?? "(unknown)", (byCamera.get(p.row.camera_model ?? "(unknown)") ?? 0) + 1));

  console.log("\n================ SUMMARY (2009–2021) ================");
  console.log(`Photos scanned:                 ${plans.length}`);
  console.log(`Manual locations (GPS kept):    ${plans.filter((p) => p.row.is_manual_location).length}`);
  console.log(`Dirty location_name:            ${dirty.length} photos, ${new Set(dirty.map((p) => p.row.location_name)).size} distinct names`);
  console.log(`Mismatched GPS:                 ${mism.length} photos`);
  for (const [k, n] of byKind) console.log(`  - ${k.padEnd(28)} ${n}`);
  console.log(`  → fixable:                    ${mism.filter((p) => p.fix).length}  (all ai_geocoded)`);
  console.log(`  → unresolved (left as is):    ${mism.filter((p) => p.unresolved).length}`);
  console.log(`Mismatched GPS by camera:       ${[...byCamera].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(", ")}`);
  console.log("\nBy trip folder (photos / dirty names / bad GPS):");
  for (const [t, s] of [...byTrip].sort((a, b) => b[1].gps - a[1].gps || b[1].names - a[1].names)) if (s.names || s.gps) console.log(`  ${String(s.n).padStart(4)} ${String(s.names).padStart(4)} ${String(s.gps).padStart(4)}  ${t}`);

  const cap = verbose ? Infinity : 60;
  console.log(`\nName changes (distinct, ${verbose ? "all" : `first ${cap}`}):`);
  const seenNames = new Map<string, { to: string; n: number }>();
  for (const p of dirty) {
    const s = seenNames.get(p.row.location_name!) ?? { to: p.newName!, n: 0 };
    s.n++;
    seenNames.set(p.row.location_name!, s);
  }
  [...seenNames].sort((a, b) => b[1].n - a[1].n).slice(0, cap).forEach(([from, s]) => console.log(`  ${String(s.n).padStart(3)}× ${JSON.stringify(from)}\n        → ${JSON.stringify(s.to)}`));
  console.log(`\nGPS fixes (${verbose ? "all" : `first ${cap}`}):`);
  mism.slice(0, cap).forEach((p) =>
    console.log(
      `  ${p.row.id}  ${p.row.taken_at.slice(0, 10)}  ${p.row.camera_model ?? "-"}\n    ${p.newName ?? p.row.location_name ?? "-"}\n    ${fmt(p.row.latitude, p.row.longitude)}  ✖ ${p.gpsReason}\n    ${p.fix ? `→ ${fmt(p.fix.lat, p.fix.lng)}  (${p.fix.source})` : `unresolved: ${p.unresolved}`}`,
    ),
  );

  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(
    REPORT_FILE,
    "﻿" +
      ["id,taken_at,camera,trip,old_name,new_name,old_lat,old_lng,gps_problem,new_lat,new_lng,gps_source,country"]
        .concat(
          plans
            .filter((p) => p.newName || p.gpsReason)
            .map((p) =>
              [p.row.id, p.row.taken_at, p.row.camera_model, tripOf(p.row), p.row.location_name, p.newName, p.row.latitude, p.row.longitude, p.gpsReason, p.fix?.lat, p.fix?.lng, p.fix?.source, p.expected].map(csv).join(","),
            ),
        )
        .join("\n"),
  );
  console.log(`\nFull report: ${REPORT_FILE}`);

  if (!apply) {
    console.log("\nDry run: nothing was written. Re-run with --apply to write these changes.");
    return;
  }

  // ---- 4. apply ----
  let ok = 0;
  let failed = 0;
  const work = plans.filter((p) => p.newName || p.fix || (p.expected && !p.row.country));
  const queue = [...work];
  async function worker() {
    for (let p = queue.shift(); p; p = queue.shift()) {
      const patch: Record<string, unknown> = {};
      if (p.newName) patch.location_name = p.newName;
      if ((p.newName || p.fix) && !p.row.source_folder && p.row.location_name) patch.source_folder = p.row.location_name;
      if (p.fix) {
        patch.latitude = p.fix.lat;
        patch.longitude = p.fix.lng;
        patch.gps_source = p.fix.source;
      }
      if (p.expected && (p.fix || !p.row.country)) patch.country = p.expected;
      const { error } = await db.from("photos").update(patch).eq("id", p.row.id).gte("taken_at", FROM).lt("taken_at", TO_EXCLUSIVE);
      if (error) {
        failed++;
        console.error(`  ✖ ${p.row.id}: ${error.message}`);
      } else ok++;
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  console.log(`\nApplied: ${ok} photos updated, ${failed} failed.`);
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
