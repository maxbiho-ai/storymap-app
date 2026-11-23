import { dayLight, formatClock } from "@/lib/sunMoon";
import { timezoneAt } from "@/lib/time";
import { distKm, type Pin } from "@/lib/pins";

export interface Stop {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  /** Where the stop came from */
  source: "search" | "storymap" | "ai";
  thumb?: string | null;
  note?: string | null;
}

export interface TripDay {
  /** YYYY-MM-DD */
  date: string;
  stops: Stop[];
}

export interface Trip {
  id?: string;
  name: string;
  startDate: string;
  endDate: string;
  days: TripDay[];
}

export const MAX_TRIP_DAYS = 21;
export const DAY_COLORS = ["#fbbf24", "#38bdf8", "#f472b6", "#a3e635", "#c084fc", "#fb923c", "#2dd4bf"];

export const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `s${Date.now()}${Math.random().toString(36).slice(2)}`);

/** YYYY-MM-DD in the browser's local calendar */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return isoDate(new Date(y, m - 1, d + n));
}

/** Inclusive list of dates (capped at MAX_TRIP_DAYS; empty when the range is invalid) */
export function datesBetween(start: string, end: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) return [];
  const out: string[] = [];
  for (let d = start; d <= end && out.length < MAX_TRIP_DAYS; d = addDays(d, 1)) out.push(d);
  return out;
}

/** New date range: day k keeps the stops of day k, so moving the trip never loses the plan */
export function withDates(trip: Trip, startDate: string, endDate: string): Trip {
  const dates = datesBetween(startDate, endDate);
  if (!dates.length) return { ...trip, startDate, endDate };
  return { ...trip, startDate, endDate, days: dates.map((date, i) => ({ date, stops: trip.days[i]?.stops ?? [] })) };
}

export function newTrip(): Trip {
  const start = isoDate(new Date());
  return withDates({ name: "My photo trip", startDate: start, endDate: start, days: [] }, start, addDays(start, 2));
}

export function formatDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/* ------------------------------------------------------------------ */
/* Solar times                                                         */
/* ------------------------------------------------------------------ */

export interface StopSolar {
  tz: string | null;
  sunrise: string | null;
  sunset: string | null;
  /** [start, end] of the morning / evening golden hour */
  goldenMorning: [string, string] | null;
  goldenEvening: [string, string] | null;
  blueDawn: string | null;
  blueDusk: string | null;
  polar: boolean;
}

/** Exact times for one calendar date at one coordinate, in that place's own timezone */
export function solarFor(date: string, lat: number, lng: number): StopSolar {
  const L = dayLight(date, lat, lng);
  const tz = timezoneAt(lat, lng);
  const f = (d: Date | null) => (d ? formatClock(d, tz) : null);
  return {
    tz,
    sunrise: f(L.sunrise),
    sunset: f(L.sunset),
    goldenMorning: L.sunrise && L.goldenMorningEnd ? [f(L.sunrise)!, f(L.goldenMorningEnd)!] : null,
    goldenEvening: L.goldenEveningStart && L.sunset ? [f(L.goldenEveningStart)!, f(L.sunset)!] : null,
    blueDawn: f(L.blueDawn),
    blueDusk: f(L.blueDusk),
    polar: L.polar,
  };
}

/* ------------------------------------------------------------------ */
/* Route corridor + photo-spot recommendations from the database       */
/* ------------------------------------------------------------------ */

type LL = { latitude: number; longitude: number };

/** Distance in km from a point to the segment a-b (local equirectangular approximation) */
function distToSegmentKm(p: LL, a: LL, b: LL): number {
  const k = Math.cos((p.latitude * Math.PI) / 180);
  const x = (l: LL) => l.longitude * k * 111.32;
  const y = (l: LL) => l.latitude * 110.57;
  const px = x(p), py = y(p), ax = x(a), ay = y(a), bx = x(b), by = y(b);
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Distance to the polyline through the stops (a single stop: distance to it) */
export function distToRouteKm(p: LL, stops: LL[]): number {
  if (!stops.length) return Infinity;
  if (stops.length === 1) return distKm(p.latitude, p.longitude, stops[0].latitude, stops[0].longitude);
  let best = Infinity;
  for (let i = 0; i < stops.length - 1; i++) best = Math.min(best, distToSegmentKm(p, stops[i], stops[i + 1]));
  return best;
}

export type SpotBucket = "sunrise" | "sunset" | "blue" | "day";
export const BUCKETS: { key: SpotBucket; label: string; icon: string }[] = [
  { key: "sunrise", label: "Sunrise", icon: "🌅" },
  { key: "sunset", label: "Sunset / Golden Hour", icon: "🌇" },
  { key: "blue", label: "Blue Hour / Night", icon: "🌃" },
  { key: "day", label: "Midday / Daytime", icon: "☀️" },
];

export interface SpotSuggestion {
  key: string;
  name: string;
  latitude: number;
  longitude: number;
  thumb: string | null;
  /** StoryMap photos at this spot in this lighting */
  photoCount: number;
  /** km from the day's route */
  km: number;
  bucket: SpotBucket;
  note?: string | null;
}

const bucketOf = (p: Pin): SpotBucket | null =>
  p.solar_phase === "sunrise" ? "sunrise" : p.solar_phase === "sunset" ? "sunset" : p.solar_phase === "blue" || p.solar_phase === "night" ? "blue" : p.solar_phase === "day" ? "day" : null;

/** StoryMap photos inside a corridor around the day's stops / route segments, by lighting phase */
export function dbSuggestions(pins: Pin[], stops: LL[], corridorKm = 12, perBucket = 6): Record<SpotBucket, SpotSuggestion[]> {
  const out: Record<SpotBucket, SpotSuggestion[]> = { sunrise: [], sunset: [], blue: [], day: [] };
  if (!stops.length) return out;
  const pad = corridorKm / 100 + 0.05; // degrees, generous bbox pre-filter
  const south = Math.min(...stops.map((s) => s.latitude)) - pad;
  const north = Math.max(...stops.map((s) => s.latitude)) + pad;
  const west = Math.min(...stops.map((s) => s.longitude)) - pad * 1.6;
  const east = Math.max(...stops.map((s) => s.longitude)) + pad * 1.6;

  const spots = new Map<string, SpotSuggestion & { latSum: number; lngSum: number; best: number }>();
  for (const p of pins) {
    if (p.latitude < south || p.latitude > north || p.longitude < west || p.longitude > east) continue;
    const bucket = bucketOf(p);
    if (!bucket) continue;
    const km = distToRouteKm(p, stops);
    if (km > corridorKm) continue;
    const place = p.location_name?.trim().toLowerCase() ?? `${p.latitude.toFixed(3)},${p.longitude.toFixed(3)}`;
    const key = `${bucket}|${place}`;
    let s = spots.get(key);
    if (!s) {
      s = {
        key,
        name: p.location_name?.trim() || `Spot at ${p.latitude.toFixed(3)}, ${p.longitude.toFixed(3)}`,
        latitude: p.latitude,
        longitude: p.longitude,
        thumb: p.thumb_url ?? p.photo_url,
        photoCount: 0,
        km,
        bucket,
        latSum: 0,
        lngSum: 0,
        best: p.ts ?? 0,
      };
      spots.set(key, s);
    }
    s.photoCount++;
    s.latSum += p.latitude;
    s.lngSum += p.longitude;
    s.km = Math.min(s.km, km);
    if (p.thumb_url && (p.ts ?? 0) >= s.best) {
      s.thumb = p.thumb_url;
      s.best = p.ts ?? 0;
    }
  }
  for (const s of spots.values()) {
    s.latitude = s.latSum / s.photoCount;
    s.longitude = s.lngSum / s.photoCount;
    out[s.bucket].push(s);
  }
  for (const b of Object.keys(out) as SpotBucket[]) {
    out[b].sort((a, c) => c.photoCount - a.photoCount || a.km - c.km);
    out[b] = out[b].slice(0, perBucket);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

/** Day-by-day schedule as plain text: stops with coordinates + exact solar times */
export function scheduleText(trip: Trip): string {
  const lines: string[] = [trip.name, `${formatDay(trip.startDate)} to ${formatDay(trip.endDate)}`, ""];
  trip.days.forEach((day, i) => {
    lines.push(`Day ${i + 1} - ${formatDay(day.date)}`);
    if (!day.stops.length) lines.push("  (no stops yet)");
    day.stops.forEach((s, j) => {
      const sol = solarFor(day.date, s.latitude, s.longitude);
      lines.push(`  ${j + 1}. ${s.name}  (${s.latitude.toFixed(5)}, ${s.longitude.toFixed(5)})${s.note ? `  - ${s.note}` : ""}`);
      if (sol.polar) lines.push("     Polar day / night: no regular sunrise or sunset");
      else {
        lines.push(
          `     Sunrise ${sol.sunrise ?? "-"}  |  Golden hour ${sol.goldenMorning?.join("-") ?? "-"} and ${sol.goldenEvening?.join("-") ?? "-"}  |  Sunset ${sol.sunset ?? "-"}  |  Blue hour ${sol.blueDawn ?? "-"} / ${sol.blueDusk ?? "-"}${sol.tz ? `  (${sol.tz})` : ""}`,
        );
      }
    });
    lines.push("");
  });
  return lines.join("\n").trim();
}
