"use client";

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const cache = new Map<string, Promise<[number, number][] | null>>();

/**
 * Driving route geometry through [lng, lat] points (Mapbox Directions, max 25 points).
 * Resolves null when unavailable: callers fall back to straight lines.
 */
export function fetchRoute(points: [number, number][]): Promise<[number, number][] | null> {
  if (!TOKEN || points.length < 2 || points.length > 25) return Promise.resolve(null);
  const coords = points.map((p) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`).join(";");
  const hit = cache.get(coords);
  if (hit) return hit;
  const p = fetch(`https://api.mapbox.com/directions/v5/mapbox/driving/${coords}?geometries=geojson&overview=full&access_token=${TOKEN}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { routes?: { geometry?: { coordinates?: [number, number][] } }[] } | null) => j?.routes?.[0]?.geometry?.coordinates ?? null)
    .catch(() => null);
  cache.set(coords, p);
  return p;
}
