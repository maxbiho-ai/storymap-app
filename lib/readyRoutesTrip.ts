"use client";

import { DEFAULT_DURATION, addDays, daySchedule, isoDate, parseClock, solarFor, uid, type Trip } from "@/lib/trip";
import { legBetween, slugify, type CuratedRoute, type CuratedRouteInsert, type LightPhase, type RouteTip } from "@/lib/readyRoutes";
import { countryFromLocation } from "@/lib/countries";

/** The light window closest to the stop's planned arrival on that date */
export function lightForArrival(date: string, lat: number, lng: number, arriveMin: number): LightPhase {
  const s = solarFor(date, lat, lng);
  if (s.polar) return "Golden Hour";
  const mid = (w: [string, string] | null) => {
    if (!w) return null;
    const a = parseClock(w[0]);
    const b = parseClock(w[1]);
    return a === null || b === null ? null : (a + b) / 2;
  };
  const marks: [LightPhase, number | null][] = [
    ["Blue Hour", parseClock(s.blueDawn)],
    ["Sunrise", parseClock(s.sunrise)],
    ["Golden Hour", mid(s.goldenMorning)],
    ["Golden Hour", mid(s.goldenEvening)],
    ["Sunset", parseClock(s.sunset)],
    ["Blue Hour", parseClock(s.blueDusk)],
  ];
  let best: LightPhase = "Golden Hour";
  let bd = Infinity;
  const t = arriveMin % 1440;
  for (const [phase, m] of marks) {
    if (m === null) continue;
    const d = Math.abs(m - t);
    if (d < bd) {
      bd = d;
      best = phase;
    }
  }
  return best;
}

/** Trip Planner trip → Ready Route row (empty days are dropped; tips from the stops' logistics plus the typed ones) */
export function tripToRoute(trip: Trip, input: { title: string; slug: string; description: string; tips: RouteTip[]; country?: string | null }): CuratedRouteInsert {
  const days = trip.days
    .filter((d) => d.stops.length)
    .map((d) => {
      const timed = daySchedule(d);
      return {
        title: null,
        stops: d.stops.map((s, i) => ({
          name: s.name,
          latitude: Number(s.latitude.toFixed(6)),
          longitude: Number(s.longitude.toFixed(6)),
          thumb: s.thumb ?? (s.refPhotos ?? []).find((u) => /^https?:/.test(u)) ?? null,
          light: lightForArrival(d.date, s.latitude, s.longitude, timed[i].arriveMin),
          description: s.description ?? s.note ?? null,
          logistics: s.logistics ?? null,
          durationMinutes: s.durationMinutes ?? DEFAULT_DURATION,
        })),
      };
    });
  const stops = days.flatMap((d) => d.stops);
  const counts = new Map<string, number>();
  for (const s of stops) {
    const c = countryFromLocation(s.name);
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const country = input.country?.trim() || [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const logisticsTips: RouteTip[] = stops.filter((s) => s.logistics).map((s) => ({ kind: /drone/i.test(s.logistics!) ? "drone" : /park/i.test(s.logistics!) ? "parking" : "photo", text: s.logistics!, stop: s.name }));
  return {
    slug: slugify(input.slug || input.title),
    title: input.title.trim(),
    country,
    description: input.description.trim() || null,
    days: Math.max(1, days.length),
    stops_count: stops.length,
    cover_url: stops.find((s) => s.thumb)?.thumb ?? null,
    plan: { days },
    tips: [...input.tips, ...logisticsTips].slice(0, 60),
    published: true,
    sort_order: 0,
  };
}

/** Ready Route → a Trip (starting today) for the Excel export */
export function routeToTrip(r: CuratedRoute): Trip {
  const start = isoDate(new Date());
  const days = r.plan.days.map((d, i) => ({
    date: addDays(start, i),
    startTime: "06:00",
    stops: d.stops.map((s, j) => ({
      id: uid(),
      name: s.name,
      latitude: s.latitude,
      longitude: s.longitude,
      source: "storymap" as const,
      thumb: s.thumb ?? null,
      description: [s.light && `Best light: ${s.light}`, s.description].filter(Boolean).join(" · ") || null,
      logistics: s.logistics ?? null,
      durationMinutes: s.durationMinutes ?? DEFAULT_DURATION,
      transitMinutes: j === 0 ? 0 : legBetween(d.stops[j - 1], s).minutes,
      refPhotos: s.thumb ? [s.thumb] : [],
    })),
  }));
  return { name: r.title, startDate: start, endDate: addDays(start, Math.max(0, days.length - 1)), days };
}
