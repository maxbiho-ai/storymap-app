"use client";

/**
 * Place names from Mapbox, in the browser with the public token (NEXT_PUBLIC_MAPBOX_TOKEN):
 * - Autocomplete: Search Box API /forward: landmarks, peaks, venues, towns, streets, with coordinates in one call.
 * - Reverse: Tilequery on mapbox-streets-v8 (named POIs and natural features such as peaks and viewpoints
 *   near the point) + Geocoding v5 (neighborhood → town → region). Search Box /reverse only returns street
 *   addresses, which make poor location names.
 */

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

export interface PlaceSuggestion {
  id: string;
  /** Short official name, e.g. "5 Fingers, Obertraun, Austria" */
  name: string;
  /** Longer description for the dropdown's second line */
  full: string;
  /** "poi" | "peak" | "place" | "locality" | "street" | ... */
  kind: string;
  latitude: number;
  longitude: number;
}

const KIND_LABEL: Record<string, string> = {
  poi: "Landmark",
  natural: "Nature",
  address: "Address",
  street: "Street",
  neighborhood: "Area",
  locality: "Locality",
  place: "Town",
  district: "District",
  region: "Region",
  country: "Country",
  postcode: "Postcode",
};
export const kindLabel = (k: string) => KIND_LABEL[k] ?? k;

const stripPostcode = (s: string) =>
  s.split(", ").map((p) => p.replace(/^\d{3,6}\s+/, "").replace(/\s+\d{3,6}$/, "").trim()).filter((p) => p && !/^\d+$/.test(p));

/** name + town + country, without repeats: "Dachstein, Ramsau am Dachstein, Austria" */
function compose(name: string, context: string[]): string {
  const parts = [name, ...context].filter(Boolean);
  const uniq = parts.filter((p, i) => parts.indexOf(p) === i);
  if (uniq.length <= 3) return uniq.join(", ");
  return [uniq[0], uniq[1], uniq[uniq.length - 1]].join(", ");
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Mapbox request failed (${res.status})`);
  return (await res.json()) as T;
}

/* ------------------------------------------------------------------ */
/* Autocomplete (Search Box API /forward)                              */
/* ------------------------------------------------------------------ */

interface SearchBoxFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    mapbox_id: string;
    feature_type: string;
    name: string;
    full_address?: string;
    place_formatted?: string;
    poi_category?: string[];
  };
}

/** Live autocomplete: landmarks, peaks, towns, streets */
export async function searchPlaces(
  query: string,
  opts: { proximity?: { latitude: number; longitude: number } | null; signal?: AbortSignal; limit?: number } = {},
): Promise<PlaceSuggestion[]> {
  const q = query.trim();
  if (!TOKEN || q.length < 2) return [];
  const params = new URLSearchParams({
    q,
    access_token: TOKEN,
    auto_complete: "true",
    limit: String(opts.limit ?? 6),
    language: "en",
    types: "poi,place,locality,neighborhood,street,address,district,region,country",
  });
  if (opts.proximity) params.set("proximity", `${opts.proximity.longitude.toFixed(4)},${opts.proximity.latitude.toFixed(4)}`);
  const json = await getJson<{ features?: SearchBoxFeature[] }>(`https://api.mapbox.com/search/searchbox/v1/forward?${params}`, opts.signal);
  return (json.features ?? []).map((f) => {
    const p = f.properties;
    const context = stripPostcode(p.place_formatted ?? "");
    // keep the town + country only: "Winkl, 4831 Obertraun, Austria" → "Obertraun, Austria"
    const short = context.length > 2 ? [context[context.length - 2], context[context.length - 1]] : context;
    return {
      id: p.mapbox_id,
      name: compose(p.name, short),
      full: [p.poi_category?.[0], p.full_address ?? p.place_formatted].filter(Boolean).join(" · "),
      kind: p.feature_type,
      latitude: f.geometry.coordinates[1],
      longitude: f.geometry.coordinates[0],
    };
  });
}

/* ------------------------------------------------------------------ */
/* Reverse (Tilequery + Geocoding v5)                                  */
/* ------------------------------------------------------------------ */

interface TileFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    name?: string;
    name_en?: string;
    class?: string;
    type?: string;
    tilequery: { distance: number; layer: string };
  };
}

interface GeocodeFeature {
  id: string;
  text: string;
  place_name: string;
  place_type: string[];
  center: [number, number];
}

/** POI classes that make a good location name (not shops, toilets or guideposts) */
const GOOD_POI = new Set(["landmark", "park_like", "sport_and_leisure", "historic", "religion", "arts_and_entertainment", "lodging", "education", "general", "place_like"]);
const NOISE_TYPE = /^(board|guidepost|information|toilets?|parking|bench|waste|atm|bicycle_parking|shelter)$/i;

const reverseCache = new Map<string, Promise<PlaceSuggestion[]>>();

/**
 * Name candidates for a point, best first: the nearest named landmark / peak / viewpoint
 * (within ~600m), then the neighborhood, town and region. Cached per ~10m.
 */
export function reverseGeocode(latitude: number, longitude: number): Promise<PlaceSuggestion[]> {
  if (!TOKEN) return Promise.resolve([]);
  const key = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
  const hit = reverseCache.get(key);
  if (hit) return hit;

  const ll = `${longitude.toFixed(6)},${latitude.toFixed(6)}`;
  const tq = new URLSearchParams({ radius: "800", limit: "15", layers: "poi_label,natural_label", dedupe: "true", access_token: TOKEN });
  const gc = new URLSearchParams({ language: "en", types: "neighborhood,locality,place,district,region,country", access_token: TOKEN });

  const p = Promise.all([
    getJson<{ features?: TileFeature[] }>(`https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/tilequery/${ll}.json?${tq}`).catch(() => ({ features: [] })),
    getJson<{ features?: GeocodeFeature[] }>(`https://api.mapbox.com/geocoding/v5/mapbox.places/${ll}.json?${gc}`).catch(() => ({ features: [] })),
  ])
    .then(([tiles, geo]) => {
      const admin = geo.features ?? [];
      const town = admin.find((f) => f.place_type[0] === "place") ?? admin.find((f) => f.place_type[0] === "locality");
      const country = admin.find((f) => f.place_type[0] === "country");
      const townCtx = [town?.text, country?.text].filter((x): x is string => Boolean(x));

      const landmarks: PlaceSuggestion[] = (tiles.features ?? [])
        .filter((f) => {
          const name = f.properties.name_en ?? f.properties.name;
          if (!name) return false;
          if (f.properties.tilequery.layer === "natural_label") return true;
          return GOOD_POI.has(f.properties.class ?? "") && !NOISE_TYPE.test(f.properties.type ?? "");
        })
        .sort((a, b) => a.properties.tilequery.distance - b.properties.tilequery.distance)
        .slice(0, 2)
        .map((f) => {
          const name = (f.properties.name_en ?? f.properties.name)!;
          const natural = f.properties.tilequery.layer === "natural_label";
          return {
            id: `tq-${name}-${f.geometry.coordinates.join(",")}`,
            name: compose(name, townCtx),
            full: `${f.properties.type ?? f.properties.class ?? "Landmark"} · ${Math.round(f.properties.tilequery.distance)} m away`,
            kind: natural ? "natural" : "poi",
            latitude: f.geometry.coordinates[1],
            longitude: f.geometry.coordinates[0],
          };
        });

      const areas: PlaceSuggestion[] = admin
        .filter((f) => ["neighborhood", "locality", "place", "region"].includes(f.place_type[0]))
        .map((f) => ({
          id: f.id,
          name: f.place_type[0] === "region" ? compose(f.text, [country?.text ?? ""]) : compose(f.text, townCtx),
          full: f.place_name,
          kind: f.place_type[0],
          latitude: f.center[1],
          longitude: f.center[0],
        }));

      const seen = new Set<string>();
      return [...landmarks, ...areas].filter((s) => !seen.has(s.name) && seen.add(s.name)).slice(0, 4);
    })
    .catch((err) => {
      reverseCache.delete(key); // allow a retry
      console.warn("Reverse geocoding failed", err);
      return [] as PlaceSuggestion[];
    });
  reverseCache.set(key, p);
  return p;
}

/** "47.47542, 13.62135" */
export function formatLatLng(latitude: number, longitude: number): string {
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}
