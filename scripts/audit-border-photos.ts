/**
 * Finds photos whose coordinates fall in a different country than their location_name says (border drift, flight shots).
 *
 *   npx tsx scripts/audit-border-photos.ts            # dry run
 *   npx tsx scripts/audit-border-photos.ts --apply    # Kazbegi-area drift only: moves RU-side photos to Stepantsminda, Georgia
 *
 * Manual locations are never touched.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

for (const name of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(path.resolve(process.cwd(), name), "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
    }
  } catch {}
}
interface Entry { n: string; b: number[]; p: number[][][] }
const unwrap = (r: number[]) => (r.some((v, i) => i > 1 && i % 2 === 0 && Math.abs(v - r[i - 2]) > 18000) ? r.map((v, i) => (i % 2 === 0 && v < 0 ? v + 36000 : v)) : r);
const world: Entry[] = (JSON.parse(readFileSync("public/data/countries-50m.json", "utf8")) as Entry[]).map((e) => ({ ...e, p: e.p.map((poly) => poly.map(unwrap)) }));
const ring = (x: number, y: number, r: number[]) => {
  let inside = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    if (r[i + 1] > y !== r[j + 1] > y && x < ((r[j] - r[i]) * (y - r[i + 1])) / (r[j + 1] - r[i + 1]) + r[i]) inside = !inside;
  }
  return inside;
};
const countryAt = (lat: number, lng: number) => {
  const x = Math.round(lng * 100), y = Math.round(lat * 100);
  for (const e of world) {
    if (lng < e.b[0] || lng > e.b[2] || lat < e.b[1] || lat > e.b[3]) continue;
    if (e.p.some((poly) => [x, x + 36000].some((xx) => ring(xx, y, poly[0]) && !poly.slice(1).some((h) => ring(xx, y, h))))) return e.n;
  }
  return null;
};

async function main() {
  const apply = process.argv.includes("--apply");
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("photos").select("id, location_name, latitude, longitude, tags, is_manual_location").range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...data!);
    if (data!.length < 1000) break;
  }
  console.log(`Scanned ${rows.length} photos`);
  const flights = rows.filter((r) => (r.tags ?? []).some((t: string) => /airplane|flight|aerial|plane|window.?seat/i.test(t)));
  console.log(`Flight/airplane-tagged: ${flights.length}`);
  const bad: any[] = [];
  for (const r of rows) {
    const named = /,\s*([^,]+)$/.exec((r.location_name ?? "").trim())?.[1]?.trim();
    if (!named) continue;
    const poly = countryAt(r.latitude, r.longitude);
    if (poly && poly !== named && !(named === "United States" && poly === "United States of America")) bad.push({ ...r, named, poly });
  }
  const ru = bad.filter((b) => b.poly === "Russia" && b.named === "Georgia");
  console.log(`Name/polygon mismatches: ${bad.length}; named Georgia but inside Russia: ${ru.length}`);
  for (const b of bad.slice(0, 60)) console.log(`  ${b.id.slice(0, 8)} "${b.location_name}" (${b.latitude}, ${b.longitude}) polygon=${b.poly}${b.is_manual_location ? " [manual]" : ""}`);
  const ruAll = rows.filter((r) => countryAt(r.latitude, r.longitude) === "Russia");
  console.log(`All photos inside Russia polygon: ${ruAll.length}`);
  for (const r of ruAll.slice(0, 40)) console.log(`  ${r.id.slice(0, 8)} "${r.location_name}" (${r.latitude}, ${r.longitude}) tags=${(r.tags ?? []).join("|")}`);
  if (apply) {
    for (const b of ru.filter((x) => !x.is_manual_location && x.latitude > 42.5 && x.latitude < 42.9 && x.longitude > 44.3 && x.longitude < 44.9)) {
      const { error } = await db.from("photos").update({ latitude: 42.6625, longitude: 44.6203, location_name: "Stepantsminda, Georgia" }).eq("id", b.id);
      console.log(error ? `FAIL ${b.id}: ${error.message}` : `moved ${b.id}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
