/**
 * Seeds 🗺️ Ready Routes (curated_routes) with starter itineraries built from the geotagged photos already in StoryMap:
 * Iceland, Portugal, South Korea and Uganda. Run supabase/migrations/011_curated_routes.sql first.
 *
 *   npm run seed:routes -- --dry-run     print the routes, write nothing
 *   npm run seed:routes                  upsert them (by slug; re-running refreshes them)
 *   npm run seed:routes -- --only=iceland
 *
 * Only public photos are used. Places are the most-photographed spots of each country, at least 2 km apart,
 * ordered as a nearest-neighbour loop (+2-opt) and split into days. Each stop's light is the light most of its photos were shot in.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { countryFromLocation } from "@/lib/countries";
import { lightKeyOf } from "@/lib/gear";
import { haversineKm, type CuratedRouteInsert, type LightPhase, type RouteStop, type RouteTip } from "@/lib/readyRoutes";

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

interface Seed {
  key: string;
  country: string;
  like: string;
  slug: string;
  title: string;
  days: number;
  description: string;
  tips: RouteTip[];
}

const COMMON: RouteTip[] = [
  { kind: "photo", text: "Check the light chip on each stop: plan to arrive 30–45 minutes before that window to scout compositions." },
  { kind: "drone", text: "Drone rules change by country and by park: check the local aviation authority and any reserve signage before every flight, and keep clear of people and wildlife." },
];

const SEEDS: Seed[] = [
  {
    key: "iceland",
    country: "Iceland",
    like: "%Iceland%",
    slug: "iceland-photo-road-trip",
    title: "Iceland Photo Road Trip",
    days: 5,
    description: "Waterfalls, black-sand beaches and glacier light: the most-photographed StoryMap spots in Iceland as a 5-day road trip.",
    tips: [
      { kind: "photo", text: "Pack a circular polarizer and microfibre cloths: waterfall spray coats the front element within seconds." },
      { kind: "photo", text: "In summer the golden hour stretches for hours around midnight; in winter it spans most of the short day." },
      { kind: "parking", text: "Popular waterfalls and beaches have paid parking, often by app or machine: keep a card handy and never park on the roadside." },
      { kind: "photo", text: "Check road.is and vedur.is every morning: wind and closed F-roads change plans fast." },
      ...COMMON,
    ],
  },
  {
    key: "portugal",
    country: "Portugal",
    like: "%Portugal%",
    slug: "portugal-golden-hour-route",
    title: "Portugal Golden Hour Route",
    days: 4,
    description: "Tiled streets, viewpoints (miradouros) and Atlantic sunsets: StoryMap's favourite Portuguese spots in 4 days.",
    tips: [
      { kind: "photo", text: "Miradouros fill up before sunset: arrive early for a spot at the railing, and use a 70–200mm to compress rooftops." },
      { kind: "photo", text: "Old-town streets are steep and narrow: shoot them at blue hour when the street lamps balance the sky." },
      { kind: "parking", text: "City centres have limited, paid parking: use the park-and-ride lots and walk or take the tram into the old towns." },
      { kind: "photo", text: "On the Atlantic coast the sun sets over the sea: bring an ND grad for the bright horizon." },
      ...COMMON,
    ],
  },
  {
    key: "south-korea",
    country: "South Korea",
    like: "%Korea%",
    slug: "south-korea-photo-route",
    title: "South Korea Photo Route",
    days: 4,
    description: "Palaces, neon streets and city viewpoints: the South Korea spots StoryMap photographers shot the most, in 4 days.",
    tips: [
      { kind: "photo", text: "Palaces open early: the first hour gives you empty courtyards and soft side light." },
      { kind: "photo", text: "City skylines glow at blue hour, roughly 20 minutes after sunset: set up on the viewpoint before the lights switch on." },
      { kind: "parking", text: "Public transport reaches almost every stop: parking downtown is scarce and expensive." },
      { kind: "photo", text: "Tripods may be restricted inside palaces and some observatories: ask at the entrance." },
      ...COMMON,
    ],
  },
  {
    key: "uganda",
    country: "Uganda",
    like: "%Uganda%",
    slug: "uganda-photo-safari",
    title: "Uganda Photo Safari",
    days: 4,
    description: "Crater lakes, savannah and the Nile: a 4-day photo safari through StoryMap's Uganda spots.",
    tips: [
      { kind: "photo", text: "Wildlife is most active at sunrise and late afternoon: book game drives for the first and last light." },
      { kind: "photo", text: "Bring a 100–400mm (or longer) and a bean bag to steady it on the vehicle window frame." },
      { kind: "parking", text: "National parks charge entry and vehicle fees at the gate: carry the receipts, rangers check them inside the park." },
      { kind: "photo", text: "Ask before photographing people and respect any no-photography signs at border and government sites." },
      ...COMMON,
    ],
  },
];

interface Row {
  id: string;
  latitude: number;
  longitude: number;
  location_name: string | null;
  thumb_url: string | null;
  photo_url: string;
  taken_at: string | null;
}

interface Place {
  name: string;
  lat: number;
  lng: number;
  n: number;
  thumb: string | null;
  thumbScore: number;
  photoId: string;
  phases: Record<string, number>;
}

const MIN_SPACING_KM = 2;
const STOPS_PER_DAY = 4;

function lightOf(phases: Record<string, number>): LightPhase {
  const score: [LightPhase, number][] = [
    ["Sunrise", phases.sunrise ?? 0],
    ["Sunset", phases.sunset ?? 0],
    ["Blue Hour", (phases.blue ?? 0) + (phases.night ?? 0)],
  ];
  score.sort((a, b) => b[1] - a[1]);
  return score[0][1] > 0 ? score[0][0] : "Golden Hour";
}

const ll = (p: Place) => ({ latitude: p.lat, longitude: p.lng });
const tourKm = (t: Place[]) => t.slice(1).reduce((a, p, i) => a + haversineKm(ll(t[i]), ll(p)), 0);

/** Nearest-neighbour path from the westernmost place, improved with 2-opt */
function orderPlaces(places: Place[]): Place[] {
  if (places.length < 3) return places;
  const left = [...places];
  left.sort((a, b) => a.lng - b.lng);
  const tour = [left.shift()!];
  while (left.length) {
    const last = tour[tour.length - 1];
    let bi = 0;
    let bd = Infinity;
    left.forEach((p, i) => {
      const d = haversineKm(ll(last), ll(p));
      if (d < bd) {
        bd = d;
        bi = i;
      }
    });
    tour.push(left.splice(bi, 1)[0]);
  }
  let improved = true;
  for (let pass = 0; improved && pass < 50; pass++) {
    improved = false;
    for (let i = 1; i < tour.length - 1; i++) {
      for (let j = i + 1; j < tour.length; j++) {
        const next = [...tour.slice(0, i), ...tour.slice(i, j + 1).reverse(), ...tour.slice(j + 1)];
        if (tourKm(next) + 1e-6 < tourKm(tour)) {
          tour.splice(0, tour.length, ...next);
          improved = true;
        }
      }
    }
  }
  return tour;
}

const makeClient = (url: string, key: string) => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const LIGHT_WORD = "(sunrise|sunset|night|morning|evening|foggy[a-z ]*|rain[a-z ]*|white|blue hour|golden hour)";
const LEADING_LIGHT = new RegExp(`^${LIGHT_WORD}\\s+`, "i");
const ONLY_LIGHT = new RegExp(`^${LIGHT_WORD}$`, "i");
const ROAD_ONLY = /^(route|road|on road|on the road|highway)(\s|$)/i;
/** "Miradouro X - rain sunrise, Portugal" → "Miradouro X"; "sunrise Queen Elizabeth National Park, Uganda" → "Queen Elizabeth National Park" */
function placeName(raw: string, country: string): string | null {
  const segs = raw
    .split(" - ")[0]
    .split(",")
    .map((x) => x.trim().replace(LEADING_LIGHT, ""))
    .filter((x) => x && x.toLowerCase() !== country.toLowerCase() && !ONLY_LIGHT.test(x));
  const name = segs.join(", ").trim();
  if (!name || ROAD_ONLY.test(name)) return null;
  return name;
}

async function fetchCountry(sb: ReturnType<typeof makeClient>, seed: Seed): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await sb
      .from("photos")
      .select("id, latitude, longitude, location_name, thumb_url, photo_url, taken_at")
      .eq("is_private", false)
      .ilike("location_name", seed.like)
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Row[];
    out.push(...rows.filter((r) => countryFromLocation(r.location_name) === seed.country));
    if (rows.length < 1000) break;
  }
  return out;
}

function buildRoute(seed: Seed, rows: Row[]): CuratedRouteInsert | null {
  const byPlace = new Map<string, Place & { latSum: number; lngSum: number }>();
  for (const r of rows) {
    const name = placeName(r.location_name!, seed.country);
    if (!name) continue;
    const key = name.toLowerCase();
    const phase = lightKeyOf(r) ?? "unknown";
    let p = byPlace.get(key);
    if (!p) {
      p = { name, lat: 0, lng: 0, latSum: 0, lngSum: 0, n: 0, thumb: null, thumbScore: -1, photoId: r.id, phases: {} };
      byPlace.set(key, p);
    }
    p.n++;
    p.latSum += r.latitude;
    p.lngSum += r.longitude;
    p.phases[phase] = (p.phases[phase] ?? 0) + 1;
    const ts = (phase === "sunrise" || phase === "sunset" || phase === "blue" ? 2 : 0) + (r.thumb_url ? 1 : 0);
    if (ts > p.thumbScore) {
      p.thumbScore = ts;
      p.thumb = r.thumb_url ?? r.photo_url;
      p.photoId = r.id;
    }
  }
  const ranked = [...byPlace.values()].map((p) => ({ ...p, lat: p.latSum / p.n, lng: p.lngSum / p.n })).sort((a, b) => b.n - a.n);
  const picked: Place[] = [];
  for (const p of ranked) {
    if (picked.length >= seed.days * STOPS_PER_DAY) break;
    if (picked.some((q) => haversineKm(ll(q), ll(p)) < MIN_SPACING_KM)) continue;
    picked.push(p);
  }
  if (picked.length < 2) return null;
  const tour = orderPlaces(picked);
  const days = Math.max(1, Math.min(seed.days, Math.ceil(tour.length / 2)));
  const per = Math.ceil(tour.length / days);
  const plan = Array.from({ length: days }, (_, d) => ({
    title: null,
    stops: tour.slice(d * per, (d + 1) * per).map<RouteStop>((p) => {
      const light = lightOf(p.phases);
      return {
        name: p.name,
        latitude: Number(p.lat.toFixed(6)),
        longitude: Number(p.lng.toFixed(6)),
        thumb: p.thumb,
        light,
        description: `${p.n} StoryMap photo${p.n === 1 ? "" : "s"} taken here · best in ${light.toLowerCase()} light.`,
        logistics: null,
        durationMinutes: 60,
        photo_id: p.photoId,
      };
    }),
  })).filter((d) => d.stops.length);
  const cover = [...picked].sort((a, b) => b.thumbScore - a.thumbScore || b.n - a.n)[0];
  return {
    slug: seed.slug,
    title: seed.title,
    country: seed.country,
    description: seed.description,
    days: plan.length,
    stops_count: plan.reduce((n, d) => n + d.stops.length, 0),
    cover_url: cover?.thumb ?? null,
    plan: { days: plan },
    tips: seed.tips,
    published: true,
    sort_order: SEEDS.indexOf(seed),
  };
}

async function main() {
  loadEnv();
  const dry = process.argv.includes("--dry-run");
  const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
  const sb = makeClient(url, key);

  if (!dry) {
    const { error } = await sb.from("curated_routes").select("id").limit(1);
    if (error) throw new Error(`curated_routes is not reachable (${error.message}). Run supabase/migrations/011_curated_routes.sql first.`);
  }

  for (const seed of SEEDS.filter((s) => !only || s.key === only)) {
    const rows = await fetchCountry(sb, seed);
    const route = buildRoute(seed, rows);
    if (!route) {
      console.log(`- ${seed.country}: only ${rows.length} public photos / not enough distinct places, skipped`);
      continue;
    }
    console.log(`\n${route.title} (${route.country}) · ${route.days} days · ${route.stops_count} stops · from ${rows.length} photos`);
    route.plan.days.forEach((d, i) => console.log(`  Day ${i + 1}: ${d.stops.map((s) => `${s.name} [${s.light}]`).join("  →  ")}`));
    if (dry) continue;
    const { error } = await sb.from("curated_routes").upsert({ ...route, updated_at: new Date().toISOString() }, { onConflict: "slug" });
    if (error) throw new Error(`${seed.slug}: ${error.message}`);
    console.log(`  ✓ saved: /?route=${route.slug}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
