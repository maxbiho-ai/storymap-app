/**
 * 🗺️ Ready Routes: curated multi-day photography itineraries (table `curated_routes`).
 * Pure helpers only (no Supabase client): shared by the app, the seed script and the public API.
 */

export type LightPhase = "Golden Hour" | "Blue Hour" | "Sunrise" | "Sunset";
export const LIGHT_PHASES: LightPhase[] = ["Sunrise", "Golden Hour", "Sunset", "Blue Hour"];
export const LIGHT_ICON: Record<LightPhase, string> = { Sunrise: "🌅", "Golden Hour": "✨", Sunset: "🌇", "Blue Hour": "🔵" };

export interface RouteStop {
  name: string;
  latitude: number;
  longitude: number;
  thumb?: string | null;
  light?: LightPhase | null;
  description?: string | null;
  logistics?: string | null;
  durationMinutes?: number | null;
  photo_id?: string | null;
}

export interface RouteDay {
  title?: string | null;
  stops: RouteStop[];
}

export type TipKind = "photo" | "parking" | "drone";
export const TIP_ICON: Record<TipKind, string> = { photo: "📷", parking: "🅿️", drone: "🛸" };

export interface RouteTip {
  kind: TipKind;
  text: string;
  stop?: string | null;
}

export interface CuratedRoute {
  id: string;
  slug: string;
  title: string;
  country: string | null;
  description: string | null;
  days: number;
  stops_count: number;
  cover_url: string | null;
  plan: { days: RouteDay[] };
  tips: RouteTip[];
  published: boolean;
  sort_order: number;
  created_at: string;
}

export type CuratedRouteInsert = Omit<CuratedRoute, "id" | "created_at">;

/** Tips everyone sees; the rest unlock with a free sign-in */
export const FREE_TIPS = 3;
export const SITE_URL = "https://my-storymap.netlify.app";

export function slugify(s: string): string {
  return (
    s
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80)
      .replace(/-+$/, "") || "route"
  );
}

export interface Utm {
  source?: string;
  medium?: string;
  campaign?: string;
}

/** https://my-storymap.netlify.app/?route=<slug>&utm_source=… */
export function routeShareUrl(slug: string, utm?: Utm, origin = SITE_URL): string {
  const q = new URLSearchParams({ route: slug });
  if (utm?.source) q.set("utm_source", utm.source);
  if (utm?.medium) q.set("utm_medium", utm.medium);
  if (utm?.source || utm?.campaign) q.set("utm_campaign", utm?.campaign || "ready_routes");
  return `${origin}/?${q.toString()}`;
}

export const allStops = (r: Pick<CuratedRoute, "plan">): RouteStop[] => r.plan?.days?.flatMap((d) => d.stops) ?? [];

const RAD = Math.PI / 180;
export function haversineKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const dLat = (b.latitude - a.latitude) * RAD;
  const dLng = (b.longitude - a.longitude) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * RAD) * Math.cos(b.latitude * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface Leg {
  km: number;
  minutes: number;
  mode: "walk" | "drive";
}

/** Estimated leg between two stops: walking under 1.5 km (5 km/h), else driving (1.3 road factor, ~50 km/h) */
export function legBetween(a: RouteStop, b: RouteStop): Leg {
  const straight = haversineKm(a, b);
  if (straight < 1.5) {
    const km = straight * 1.2;
    return { km, minutes: Math.max(1, Math.round((km / 5) * 60)), mode: "walk" };
  }
  const km = straight * 1.3;
  return { km, minutes: Math.max(1, Math.round((km / 50) * 60)), mode: "drive" };
}

export function routeDistanceKm(r: Pick<CuratedRoute, "plan">): number {
  let km = 0;
  for (const d of r.plan?.days ?? []) for (let i = 1; i < d.stops.length; i++) km += legBetween(d.stops[i - 1], d.stops[i]).km;
  return km;
}

export const fmtKm = (km: number) => (km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km).toLocaleString()} km`);
export const fmtMinutes = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ""}`.trim());

/** Normalizes a row from the DB (JSON columns may be null / malformed) */
export function normalizeRoute(row: Partial<CuratedRoute> & { id: string; slug: string; title: string }): CuratedRoute {
  const days = Array.isArray(row.plan?.days) ? row.plan!.days.map((d) => ({ title: d?.title ?? null, stops: Array.isArray(d?.stops) ? d.stops.filter((s) => Number.isFinite(s?.latitude) && Number.isFinite(s?.longitude)) : [] })) : [];
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    country: row.country ?? null,
    description: row.description ?? null,
    days: row.days ?? Math.max(1, days.length),
    stops_count: row.stops_count ?? days.reduce((n, d) => n + d.stops.length, 0),
    cover_url: row.cover_url ?? days.flatMap((d) => d.stops).find((s) => s.thumb)?.thumb ?? null,
    plan: { days },
    tips: Array.isArray(row.tips) ? row.tips.filter((t) => t && typeof t.text === "string") : [],
    published: row.published ?? true,
    sort_order: row.sort_order ?? 0,
    created_at: row.created_at ?? new Date(0).toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* GPX / KML                                                           */
/* ------------------------------------------------------------------ */

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function routeToGpx(r: CuratedRoute): string {
  const wpts: string[] = [];
  const trks: string[] = [];
  r.plan.days.forEach((d, di) => {
    d.stops.forEach((s, si) => {
      const desc = [s.light && `Light: ${s.light}`, s.description, s.logistics].filter(Boolean).join(" | ");
      wpts.push(`  <wpt lat="${s.latitude.toFixed(6)}" lon="${s.longitude.toFixed(6)}"><name>${xml(`D${di + 1}.${si + 1} ${s.name}`)}</name>${desc ? `<desc>${xml(desc)}</desc>` : ""}</wpt>`);
    });
    if (d.stops.length > 1) {
      const pts = d.stops.map((s) => `      <rtept lat="${s.latitude.toFixed(6)}" lon="${s.longitude.toFixed(6)}"><name>${xml(s.name)}</name></rtept>`).join("\n");
      trks.push(`  <rte><name>${xml(`Day ${di + 1}${d.title ? `: ${d.title}` : ""}`)}</name>\n${pts}\n  </rte>`);
    }
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="StoryMap Ready Routes" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${xml(r.title)}</name><link href="${xml(routeShareUrl(r.slug))}"><text>StoryMap</text></link></metadata>
${wpts.join("\n")}
${trks.join("\n")}
</gpx>
`;
}

export function routeToKml(r: CuratedRoute): string {
  const folders = r.plan.days.map((d, di) => {
    const marks = d.stops
      .map((s, si) => {
        const desc = [s.light && `Light: ${s.light}`, s.description, s.logistics].filter(Boolean).join("\n");
        return `      <Placemark><name>${xml(`${si + 1}. ${s.name}`)}</name>${desc ? `<description>${xml(desc)}</description>` : ""}<Point><coordinates>${s.longitude.toFixed(6)},${s.latitude.toFixed(6)},0</coordinates></Point></Placemark>`;
      })
      .join("\n");
    const line =
      d.stops.length > 1
        ? `\n      <Placemark><name>Day ${di + 1} route</name><LineString><tessellate>1</tessellate><coordinates>${d.stops.map((s) => `${s.longitude.toFixed(6)},${s.latitude.toFixed(6)},0`).join(" ")}</coordinates></LineString></Placemark>`
        : "";
    return `    <Folder><name>${xml(`Day ${di + 1}${d.title ? `: ${d.title}` : ""}`)}</name>\n${marks}${line}\n    </Folder>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${xml(r.title)}</name>
    <description>${xml(r.description ?? routeShareUrl(r.slug))}</description>
${folders.join("\n")}
  </Document>
</kml>
`;
}
