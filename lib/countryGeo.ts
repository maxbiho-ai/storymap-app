"use client";

import { canonicalCountry, countryFromLocation, countryFromRegionHint } from "@/lib/countries";

/**
 * Point-in-polygon country lookup. The polygons are Natural Earth 50m countries (world-atlas@2.0.2),
 * quantized to 0.01° (~1 km) and served as /data/countries-50m.json; fetched once, on first use.
 * Format: [{ n: name, b: [w, s, e, n], p: polygons[ rings[ flat [x0, y0, x1, y1, ...] in 1/100° ] ] }]
 */
interface Entry {
  n: string;
  b: [number, number, number, number];
  p: number[][][];
}

const Q = 100;
/** A photo this close (degrees) to a country that doesn't contain it (coast, 1 km border error) still belongs to it */
const NEAR_DEG = 0.15;

let entries: (Entry & { country: string | null })[] | null = null;
let loading: Promise<boolean> | null = null;
const cache = new Map<string, string | null>();

/** Fetches the polygons once; resolves true when they are available */
export function loadCountryIndex(): Promise<boolean> {
  if (entries) return Promise.resolve(true);
  loading ??= fetch("/data/countries-50m.json")
    .then((r) => (r.ok ? (r.json() as Promise<Entry[]>) : Promise.reject(new Error(String(r.status)))))
    .then((list) => {
      entries = list.map((e) => ({ ...e, p: e.p.map((poly) => poly.map(unwrapRing)), country: canonicalCountry(e.n) }));
      return true;
    })
    .catch((err) => {
      console.warn("Country polygons failed to load; falling back to location names", err);
      loading = null;
      return false;
    });
  return loading;
}

/**
 * Rings that cross the antimeridian (Russia's Chukotka, Fiji, Antarctica) jump from +180 to -180 in the data, which makes the
 * ray test treat half the world (Iceland!) as inside. Shift their western part to 180..360 so the ring is continuous;
 * countryAt() then also tests the point shifted by +360°.
 */
/** Node scripts: hand over the polygons read from public/data/countries-50m.json instead of fetching them */
export function primeCountryIndex(list: Entry[]): void {
  entries = list.map((e) => ({ ...e, p: e.p.map((poly) => poly.map(unwrapRing)), country: canonicalCountry(e.n) }));
  cache.clear();
}

/**
 * Is (lat, lng) inside this canonical country, or within `slackDeg` of its border / coast? The slack keeps border photos
 * (Untersberg summit, a lake shore) from counting as "in the neighbour". Unknown country / polygons not loaded → true.
 */
export function inCountry(country: string, lat: number, lng: number, slackDeg = NEAR_DEG): boolean {
  if (!entries) return true;
  const own = entries.filter((e) => e.country === country);
  if (!own.length) return true;
  if (countryAt(lat, lng) === country) return true;
  const d2 = slackDeg * slackDeg;
  for (const e of own) {
    if (lng < e.b[0] - slackDeg || lng > e.b[2] + slackDeg || lat < e.b[1] - slackDeg || lat > e.b[3] + slackDeg) continue;
    for (const poly of e.p)
      for (const ring of poly)
        for (let i = 0; i < ring.length; i += 2) {
          const dx = ring[i] / Q - lng;
          const dy = ring[i + 1] / Q - lat;
          if (dx * dx + dy * dy < d2) return true;
        }
  }
  return false;
}

function unwrapRing(ring: number[]): number[] {
  let jumps = false;
  for (let i = 2; i < ring.length; i += 2) if (Math.abs(ring[i] - ring[i - 2]) > 180 * Q) { jumps = true; break; }
  if (!jumps) return ring;
  return ring.map((v, i) => (i % 2 === 0 && v < 0 ? v + 360 * Q : v));
}

function inRing(x: number, y: number, ring: number[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i], yi = ring[i + 1], xj = ring[j], yj = ring[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Inside the outer ring and in none of the holes */
const inPolygon = (x: number, y: number, rings: number[][]) => inRing(x, y, rings[0]) && !rings.slice(1).some((h) => inRing(x, y, h));

function nearestWithin(lat: number, lng: number, deg: number): string | null {
  let best: string | null = null;
  let bestD = deg * deg;
  for (const e of entries!) {
    if (!e.country || lng < e.b[0] - deg || lng > e.b[2] + deg || lat < e.b[1] - deg || lat > e.b[3] + deg) continue;
    for (const poly of e.p) {
      for (const ring of poly) {
        for (let i = 0; i < ring.length; i += 2) {
          const dx = ring[i] / Q - lng;
          const dy = ring[i + 1] / Q - lat;
          const d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            best = e.country;
          }
        }
      }
    }
  }
  return best;
}

/** Country containing the point (canonical name), or null while the polygons are not loaded / over open sea */
export function countryAt(lat: number, lng: number): string | null {
  if (!entries) return null;
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  if (cache.has(key)) return cache.get(key)!;
  const x = Math.round(lng * Q);
  const y = Math.round(lat * Q);
  let found: string | null = null;
  for (const e of entries) {
    if (lng < e.b[0] || lng > e.b[2] || lat < e.b[1] || lat > e.b[3]) continue;
    if (e.p.some((poly) => inPolygon(x, y, poly) || inPolygon(x + 360 * Q, y, poly))) {
      found = e.country;
      break;
    }
  }
  found ??= nearestWithin(lat, lng, NEAR_DEG);
  cache.set(key, found);
  return found;
}

/**
 * The country of a photo. A location name that explicitly ends in a country ("Kazbegi, Georgia") wins: a 1-2 km border error in the
 * polygons or the GPS must never light up the neighbour. Otherwise its coordinates (point-in-polygon), then a region named in the
 * location ("Dolomites" → Italy).
 */
export function resolveCountry(p: { latitude: number; longitude: number; location_name: string | null }): string | null {
  return countryFromLocation(p.location_name) ?? countryAt(p.latitude, p.longitude) ?? countryFromRegionHint(p.location_name);
}

/** Tags that mark a photo taken from a plane: such shots must not make a country count as visited on their own */
const FLIGHT_TAG = /^(airplane|aeroplane|flight|inflight|windowseat|aerialview|aerial|plane)$/;
export const isFlightPhoto = (tags: string[] | null | undefined) => Boolean(tags?.some((t) => FLIGHT_TAG.test(t.toLowerCase().replace(/[^a-z]/g, ""))));
