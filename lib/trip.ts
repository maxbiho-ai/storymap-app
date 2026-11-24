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
  /** Short photography / lighting description */
  description?: string | null;
  /** How long to stay (minutes); DEFAULT_DURATION when missing */
  durationMinutes?: number;
  /** Minutes to get here from the previous stop (0 for the first stop of a day) */
  transitMinutes?: number;
  transitNote?: string | null;
  /** Entry / ticket / parking / permit note */
  logistics?: string | null;
  /** Reference ("shot list") photos: data URLs of compressed images, or StoryMap image URLs. At most MAX_REF_PHOTOS */
  refPhotos?: string[];
}

export const DEFAULT_DURATION = 60;
export const DEFAULT_START = "07:00";
export const MAX_REF_PHOTOS = 4;

export interface TripDay {
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM the first stop begins (DEFAULT_START when missing) */
  startTime?: string;
  stops: Stop[];
}

export interface Trip {
  id?: string;
  name: string;
  startDate: string;
  endDate: string;
  days: TripDay[];
}

/** Only a guard against a typo like year 20000: no real trip is this long. There is no cap on stops per day. */
export const MAX_TRIP_DAYS = 1000;
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

/** Inclusive list of dates (empty when the range is invalid) */
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
  return { ...trip, startDate, endDate, days: dates.map((date, i) => ({ ...trip.days[i], date, stops: trip.days[i]?.stops ?? [] })) };
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
/* Rolling schedule                                                    */
/* ------------------------------------------------------------------ */

/** "07:30" → 450 (null when it is not a time) */
export function parseClock(v: string | null | undefined): number | null {
  const m = /^\s*(\d{1,2})[:.h]?(\d{2})\s*$/.exec(v ?? "");
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return +m[1] * 60 + +m[2];
}
/** 450 → "07:30" (wraps past midnight) */
export function fmtClock(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
/** "1:30", "90", "1h30", "45m" → minutes (null when unreadable) */
export function parseDuration(v: string): number | null {
  const t = v.trim().toLowerCase();
  let m = /^(\d{1,2}):(\d{1,2})$/.exec(t) ?? /^(\d{1,2})h\s*(\d{1,2})?m?$/.exec(t);
  if (m) return +m[1] * 60 + +(m[2] ?? 0);
  m = /^(\d{1,4})\s*(m|min)?$/.exec(t);
  return m ? +m[1] : null;
}
/** 90 → "1:30" */
export const fmtDuration = (min: number) => `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, "0")}`;

export interface TimedStop {
  stop: Stop;
  /** minutes from midnight (can pass 1440 on a long day) */
  arriveMin: number;
  departMin: number;
  arrive: string;
  depart: string;
  duration: number;
}

/**
 * The day's timetable: the first stop starts at the day's start time; every next stop is reached after the previous stop's
 * duration plus its own transit time. Change any duration, transit, or the order and every later time follows.
 */
export function daySchedule(day: TripDay): TimedStop[] {
  let t = parseClock(day.startTime) ?? parseClock(DEFAULT_START)!;
  return day.stops.map((stop, i) => {
    if (i > 0) t += Math.max(0, stop.transitMinutes ?? 0);
    const duration = Math.max(0, stop.durationMinutes ?? DEFAULT_DURATION);
    const row = { stop, arriveMin: t, departMin: t + duration, arrive: fmtClock(t), depart: fmtClock(t + duration), duration };
    t += duration;
    return row;
  });
}

export const mapsLink = (s: { latitude: number; longitude: number }) => `https://maps.google.com/?q=${s.latitude.toFixed(6)},${s.longitude.toFixed(6)}`;

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
    lines.push(`Day ${i + 1} - ${formatDay(day.date)} - starts ${day.startTime ?? DEFAULT_START}`);
    if (!day.stops.length) lines.push("  (no stops yet)");
    const timed = daySchedule(day);
    day.stops.forEach((s, j) => {
      const sol = solarFor(day.date, s.latitude, s.longitude);
      lines.push(`  ${j + 1}. ${timed[j].arrive}  ${s.name}  (${s.latitude.toFixed(5)}, ${s.longitude.toFixed(5)})  [${fmtDuration(timed[j].duration)}]${s.note ? `  - ${s.note}` : ""}`);
      if (s.description) lines.push(`     ${s.description}`);
      if (s.transitNote || (j > 0 && s.transitMinutes)) lines.push(`     Transit: ${[j > 0 && s.transitMinutes ? `${s.transitMinutes} min` : null, s.transitNote].filter(Boolean).join(" · ")}`);
      if (s.logistics) lines.push(`     Logistics: ${s.logistics}`);
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

/* ------------------------------------------------------------------ */
/* WhatsApp share                                                      */
/* ------------------------------------------------------------------ */

export const SITE_URL = "https://my-storymap.netlify.app";
/** Longer than this and the per-stop descriptions are trimmed (stop names and navigation links always stay) */
export const WHATSAPP_SOFT_LIMIT = 2500;

/**
 * The itinerary as WhatsApp text (*bold* headers, numbered timed stops, a Google Maps link per stop).
 * Detail levels, used in order until it fits `limit`: 0 = everything, 1 = no logistics / transit notes,
 * 2 = no descriptions, 3 = compact (one line per stop, no blank lines). Times, names and links are never cut.
 */
export function whatsappItinerary(trip: Trip, limit = WHATSAPP_SOFT_LIMIT): string {
  const build = (level: number): string => {
    const lines: string[] = [`*🗺️ StoryMap Photo Trip: ${trip.name.trim() || "My trip"}*`];
    if (trip.startDate) lines.push(trip.startDate === trip.endDate ? formatDay(trip.startDate) : `${formatDay(trip.startDate)} → ${formatDay(trip.endDate)}`);
    const gap = level >= 3 ? [] : [""];
    trip.days.forEach((day, i) => {
      if (!day.stops.length) return;
      lines.push(...gap, `*Day ${i + 1} · ${formatDay(day.date)}*`);
      const timed = daySchedule(day);
      day.stops.forEach((s, j) => {
        const link = mapsLink(s);
        const t = timed[j];
        if (level >= 3) {
          lines.push(`${t.arrive} ${j + 1}. ${s.name} ${link}`);
          return;
        }
        lines.push(`🕖 *${t.arrive}* · ${j + 1}. *${s.name}* (${fmtDuration(t.duration)})`);
        if (level < 2) {
          const d = s.description ?? s.note;
          if (d) lines.push(`   ${d}`);
        }
        if (level < 1) {
          if (j > 0 && (s.transitMinutes || s.transitNote)) lines.push(`   🚶 ${[s.transitMinutes ? `${s.transitMinutes} min` : null, s.transitNote].filter(Boolean).join(" · ")}`);
          if (s.logistics) lines.push(`   🎟️ ${s.logistics}`);
        }
        lines.push(`   📍 ${link}`);
      });
    });
    lines.push(...gap, `Plan yours on StoryMap: ${SITE_URL}`);
    return lines.join("\n");
  };
  let text = build(0);
  for (let level = 1; level <= 3 && text.length > limit; level++) text = build(level);
  return text;
}

export const whatsappUrl = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;
