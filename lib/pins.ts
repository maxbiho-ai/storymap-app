import { getSupabase } from "@/lib/supabase/client";
import { applyPhotoFilters, type DbFilters } from "@/hooks/usePhotoSearch";
import { countryFromLocation } from "@/lib/countries";
import { lightKeyOf, type LightKey } from "@/lib/gear";
import type { Photo } from "@/types/photo";

/**
 * The lightweight global pin layer: one small row per photo, for EVERY matching photo on the map
 * (the sidebar's 500-photo limit never applies to it). Full rows load on demand, only for open cards.
 */
export const PIN_COLUMNS = "id, latitude, longitude, location_name, thumb_url, photo_url, taken_at, taken_tz, title, tags, lens, shutter_speed, image_urls, width, height";

export type RawPin = Pick<
  Photo,
  "id" | "latitude" | "longitude" | "location_name" | "thumb_url" | "photo_url" | "taken_at" | "taken_tz" | "title" | "tags" | "lens" | "shutter_speed"
> & { image_urls?: string[] | null; width?: number | null; height?: number | null };

/** Solar phase at capture: golden-hour sunrise / sunset, blue hour, night, or daytime */
export type PinPhase = LightKey | "day";

export interface Pin extends RawPin {
  /** Canonical country name parsed from location_name */
  country: string | null;
  solar_phase: PinPhase | null;
  /** Only for pins holding several images (Social Planner posts): lets every count match the card's carousel */
  image_urls?: string[];
  /** Pixel size (orientation badge) */
  width?: number | null;
  height?: number | null;
  /** taken_at as epoch ms (null when unknown) */
  ts: number | null;
}

export function toPin(raw: RawPin): Pin {
  const ts = raw.taken_at ? Date.parse(raw.taken_at) : NaN;
  return {
    id: raw.id,
    latitude: raw.latitude,
    longitude: raw.longitude,
    location_name: raw.location_name,
    thumb_url: raw.thumb_url,
    photo_url: raw.photo_url,
    taken_at: raw.taken_at,
    taken_tz: raw.taken_tz,
    title: raw.title,
    tags: raw.tags ?? [],
    lens: raw.lens,
    shutter_speed: raw.shutter_speed,
    country: countryFromLocation(raw.location_name),
    solar_phase: lightKeyOf(raw),
    ts: Number.isNaN(ts) ? null : ts,
    width: raw.width ?? null,
    height: raw.height ?? null,
    ...(raw.image_urls && raw.image_urls.length > 1 ? { image_urls: raw.image_urls } : {}),
  };
}

/** Distinct images behind a set of pins = the length of the card's carousel (a multi-image post counts every image) */
export function spotPhotoCount(members: Pin[]): number {
  const seen = new Set<string>();
  for (const p of members) for (const u of p.image_urls?.length ? p.image_urls : [p.photo_url || p.id]) seen.add(u);
  return seen.size;
}

const PAGE = 1000;
const MAX_PINS = 60_000;

/** All pins matching the DB filters, paginated (PostgREST caps a response at 1000 rows) */
export async function fetchPins(filters: DbFilters): Promise<Pin[]> {
  const out: Pin[] = [];
  for (let from = 0; from < MAX_PINS; from += PAGE) {
    const q = applyPhotoFilters(getSupabase().from("photos").select(PIN_COLUMNS).order("id"), filters).range(from, from + PAGE - 1);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as RawPin[];
    for (const r of rows) out.push(toPin(r));
    if (rows.length < PAGE) break;
  }
  return out;
}

const isEmptyFilter = (f: DbFilters) => !f.query.trim() && !f.tags.length && !f.photographer && !f.area;

let allCache: Promise<Pin[]> | null = null;

/** Every pin, cached (shared by the map and the trip planner); `invalidatePins` after an upload / login */
export function getAllPins(): Promise<Pin[]> {
  if (!allCache) {
    allCache = fetchPins({ query: "", tags: [], photographer: null, area: null }).catch((e) => {
      allCache = null;
      throw e;
    });
  }
  return allCache;
}
export const invalidatePins = () => {
  allCache = null;
};
export function loadPins(filters: DbFilters): Promise<Pin[]> {
  return isEmptyFilter(filters) ? getAllPins() : fetchPins(filters);
}

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

const RAD = Math.PI / 180;

export function distKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = (bLat - aLat) * RAD;
  const dLng = (bLng - aLng) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * RAD) * Math.cos(bLat * RAD) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

/** [[west, south], [east, north]] of the points (null when empty) */
export function boundsOf(points: { latitude: number; longitude: number }[]): [[number, number], [number, number]] | null {
  if (!points.length) return null;
  let w = 180, e = -180, s = 90, n = -90;
  for (const p of points) {
    if (p.longitude < w) w = p.longitude;
    if (p.longitude > e) e = p.longitude;
    if (p.latitude < s) s = p.latitude;
    if (p.latitude > n) n = p.latitude;
  }
  return [[w, s], [e, n]];
}

/* ------------------------------------------------------------------ */
/* Grouping                                                            */
/* ------------------------------------------------------------------ */

/** Photos at the same spot (≈1m) share one exact-GPS key */
export const exactKey = (p: Pick<Photo, "latitude" | "longitude">) => `${p.latitude.toFixed(5)},${p.longitude.toFixed(5)}`;

/** Photos with the same location name within this distance form one spot */
const SPOT_RADIUS_KM = 3;

export interface PinGroup {
  key: string;
  /** In shooting order */
  members: Pin[];
  /** Pin position: the members' centre (or the exact point in exact mode) */
  longitude: number;
  latitude: number;
}

const nameKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Smart grouping: by default photos of the same place (same location_name within walking / local range,
 * or the same ~100 m cell when unnamed) form ONE pin, so the whole spot is browsed together.
 * `exact` splits them by exact GPS coordinates instead (the "Spread Exact GPS Spots" mode).
 */
export function groupPins(pins: Pin[], exact: boolean): PinGroup[] {
  const buckets = new Map<string, Pin[]>();
  if (exact) {
    for (const p of pins) {
      const k = exactKey(p);
      const b = buckets.get(k);
      if (b) b.push(p);
      else buckets.set(k, [p]);
    }
  } else {
    const anchors = new Map<string, { key: string; lat: number; lng: number }[]>();
    for (const p of pins) {
      let key: string;
      if (p.location_name?.trim()) {
        const nk = nameKey(p.location_name);
        const list = anchors.get(nk) ?? [];
        let a = list.find((x) => distKm(x.lat, x.lng, p.latitude, p.longitude) <= SPOT_RADIUS_KM);
        if (!a) {
          a = { key: `n:${nk}#${list.length}`, lat: p.latitude, lng: p.longitude };
          list.push(a);
          anchors.set(nk, list);
        }
        key = a.key;
      } else {
        key = `g:${p.latitude.toFixed(3)},${p.longitude.toFixed(3)}`;
      }
      const b = buckets.get(key);
      if (b) b.push(p);
      else buckets.set(key, [p]);
    }
  }

  const groups: PinGroup[] = [];
  for (const [key, members] of buckets) {
    members.sort((a, b) => (a.ts ?? Infinity) - (b.ts ?? Infinity) || (a.id < b.id ? -1 : 1));
    let lat = 0, lng = 0;
    for (const m of members) {
      lat += m.latitude;
      lng += m.longitude;
    }
    groups.push({ key, members, latitude: lat / members.length, longitude: lng / members.length });
  }
  return groups;
}

/** Coordinates in EXIF timestamp order (the "trip line"), thinned to `max` points */
export function timelineCoords(pins: Pin[], max = 1500): [number, number][] {
  const dated = pins.filter((p) => p.ts != null).sort((a, b) => a.ts! - b.ts!);
  const step = Math.max(1, Math.ceil(dated.length / max));
  const pts: [number, number][] = [];
  for (let i = 0; i < dated.length; i += step) pts.push([dated[i].longitude, dated[i].latitude]);
  return pts;
}

/* ------------------------------------------------------------------ */
/* Places / countries (sidebar + country layer)                        */
/* ------------------------------------------------------------------ */

export interface LightCounts { golden: number; blue: number; night: number; day: number }

export interface Place {
  name: string;
  count: number;
  cover: Pin;
  light: LightCounts;
  latitude: number;
  longitude: number;
}

export interface CountrySummary {
  name: string;
  count: number;
  light: LightCounts;
  places: Place[];
}

const emptyLight = (): LightCounts => ({ golden: 0, blue: 0, night: 0, day: 0 });
function bump(l: LightCounts, p: PinPhase | null) {
  if (p === "sunrise" || p === "sunset") l.golden++;
  else if (p === "blue") l.blue++;
  else if (p === "night") l.night++;
  else if (p === "day") l.day++;
}

/** Destinations grouped by country, then by location name: the sidebar's default (no filter) view */
export function summarizePlaces(pins: Pin[]): CountrySummary[] {
  const countries = new Map<string, CountrySummary>();
  const placeMap = new Map<string, { place: Place; lat: number; lng: number }>();
  for (const p of pins) {
    const cname = p.country ?? "Other places";
    let c = countries.get(cname);
    if (!c) countries.set(cname, (c = { name: cname, count: 0, light: emptyLight(), places: [] }));
    c.count++;
    bump(c.light, p.solar_phase);

    const pname = p.location_name?.trim();
    if (!pname) continue;
    const pk = `${cname}|${nameKey(pname)}`;
    let entry = placeMap.get(pk);
    if (!entry) {
      entry = { place: { name: pname, count: 0, cover: p, light: emptyLight(), latitude: p.latitude, longitude: p.longitude }, lat: 0, lng: 0 };
      placeMap.set(pk, entry);
      c.places.push(entry.place);
    }
    entry.place.count++;
    entry.lat += p.latitude;
    entry.lng += p.longitude;
    bump(entry.place.light, p.solar_phase);
    // Prefer the newest photo that has a thumbnail as the cover
    if (!entry.place.cover.thumb_url || ((p.ts ?? 0) > (entry.place.cover.ts ?? 0) && p.thumb_url)) entry.place.cover = p;
  }
  for (const { place, lat, lng } of placeMap.values()) {
    place.latitude = lat / place.count;
    place.longitude = lng / place.count;
  }
  const list = [...countries.values()];
  for (const c of list) c.places.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  list.sort((a, b) => (a.name === "Other places" ? 1 : b.name === "Other places" ? -1 : b.count - a.count || a.name.localeCompare(b.name)));
  return list;
}
