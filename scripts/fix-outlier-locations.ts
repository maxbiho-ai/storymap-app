/**
 * One-off cleanup: find photos whose (lat, lng) contradicts the country implied by their trip/folder path
 * (source_key "<trip>/<subfolder>/.../<stem>") or location_name, re-geocode them with the strict ISO country filter
 * and the outlier guard, and update latitude / longitude / location_name.
 *
 *   npx tsx --conditions=react-server scripts/fix-outlier-locations.ts            # dry run: lists what would change
 *   npx tsx --conditions=react-server scripts/fix-outlier-locations.ts --apply    # writes to Supabase
 *
 * Manual locations (is_manual_location = true) are never touched.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { folderQueries, geocodeWithGuard, placeFromFolders, placeLabel, plausibleInCountry, resolveCountry } from "./lib/archive";

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
  is_manual_location: boolean | null;
}

async function main() {
  loadEnv();
  const apply = process.argv.includes("--apply");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const token = process.env.MAPBOX_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env.local");
  if (!token) throw new Error("No Mapbox token in .env.local");
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("photos").select("id, source_key, location_name, latitude, longitude, is_manual_location").range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data as Row[]));
    if (!data || data.length < 1000) break;
  }
  console.log(`Scanned ${rows.length} photos (${apply ? "APPLY" : "dry run"})`);

  const fixed: { id: string; key: string; before: string; after: string }[] = [];
  const unresolved: string[] = [];
  let outliers = 0;
  let skippedManual = 0;

  for (const r of rows) {
    // folder context: source_key minus the file stem; fall back to the location_name parts
    const folderParts = r.source_key ? r.source_key.split("/").slice(0, -1) : [];
    const nameParts = r.location_name ? r.location_name.split(",").map((s) => s.trim()).reverse() : [];
    const res = resolveCountry(folderParts) ?? resolveCountry(nameParts);
    if (!res || !res.country.iso) continue;
    if (plausibleInCountry(res.country.iso, r.latitude, r.longitude)) continue;
    outliers++;
    if (r.is_manual_location) {
      skippedManual++;
      continue;
    }
    const relParts = folderParts.slice(1); // drop the trip folder itself
    const relIdx = res.idx - 1;
    const place = placeFromFolders(relParts.join("/"));
    const queries = place.kind === "flight" ? [`${res.country.airport}, ${res.country.name}`] : folderQueries(relParts, { country: res.country, city: res.city, relIdx });
    const g = await geocodeWithGuard(queries, { country: res.country, city: res.city }, token);
    if (!g) {
      unresolved.push(`${r.id} ${r.source_key ?? r.location_name}`);
      continue;
    }
    // keep the original-case spot text from the old name (source_key is lowercased)
    const spot = r.location_name?.split(",")[0]?.trim() || place.label;
    const name = placeLabel(spot, res.country, res.city) ?? g.used;
    const before = `${r.location_name ?? "-"} (${r.latitude.toFixed(5)}, ${r.longitude.toFixed(5)})`;
    const after = `${name} (${g.geo.lat.toFixed(5)}, ${g.geo.lng.toFixed(5)})${g.fallback ? " [fallback]" : ""}`;
    if (apply) {
      const { error } = await db.from("photos").update({ latitude: g.geo.lat, longitude: g.geo.lng, location_name: name }).eq("id", r.id);
      if (error) {
        unresolved.push(`${r.id} update failed: ${error.message}`);
        continue;
      }
    }
    fixed.push({ id: r.id, key: r.source_key ?? "-", before, after });
  }

  console.log(`\nOutliers: ${outliers}  ${apply ? "fixed" : "would fix"}: ${fixed.length}  manual skipped: ${skippedManual}  unresolved: ${unresolved.length}\n`);
  for (const f of fixed) console.log(`${f.id}\n  key:    ${f.key}\n  before: ${f.before}\n  after:  ${f.after}`);
  if (unresolved.length) console.log(`\nUnresolved:\n${unresolved.map((u) => `  ${u}`).join("\n")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
