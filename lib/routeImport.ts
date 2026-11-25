"use client";

/**
 * Admin "+ Upload Route": turns a .gpx / .kml / .json file into Ready Route days and stops,
 * then matches StoryMap photos within 500 m of each stop for thumbnails and light phases.
 */

import { getSupabase } from "@/lib/supabase/client";
import { lightKeyOf } from "@/lib/gear";
import { haversineKm, normalizeRoute, slugify, type CuratedRoute, type LightPhase, type RouteDay, type RouteStop, type RouteTip } from "@/lib/readyRoutes";
import type { RouteDraft } from "@/store/routesStore";

export const STOPS_PER_DAY = 4;
/** A bare track (no named points) is sampled down to stops at least this far apart */
const TRACK_SPACING_KM = 3;
const MAX_STOPS = 60;
export const MATCH_RADIUS_KM = 0.5;

interface Pt {
  name: string | null;
  latitude: number;
  longitude: number;
  time: string | null;
  description: string | null;
}

export interface ParsedRoute {
  title: string | null;
  description: string | null;
  days: RouteDay[];
  tips: RouteTip[];
  country: string | null;
  /** Human summary of what was read, e.g. "12 waypoints in 3 days" */
  summary: string;
}

const num = (s: string | null | undefined) => (s == null ? NaN : Number(s));
const valid = (p: { latitude: number; longitude: number }) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180;
/** Direct child element text, ignoring XML namespaces */
const childText = (el: Element, tag: string): string | null => {
  for (const c of Array.from(el.children)) if (c.localName === tag) return c.textContent?.trim() || null;
  return null;
};
const byTag = (root: Element | Document, tag: string): Element[] => Array.from(root.getElementsByTagNameNS("*", tag));

function toStop(p: Pt, i: number): RouteStop {
  return {
    name: (p.name || `Stop ${i + 1}`).slice(0, 140),
    latitude: Number(p.latitude.toFixed(6)),
    longitude: Number(p.longitude.toFixed(6)),
    thumb: null,
    light: null,
    description: p.description?.slice(0, 1000) ?? null,
    logistics: null,
    durationMinutes: 60,
  };
}

/** Stops a track becomes per day (a long drive should not become 30 stops) */
const TRACK_STOPS_PER_DAY = 6;

/** Keeps the first and last point and every point at least `km` from the previous kept one (spaced to about `target` stops) */
function sampleTrack(pts: Pt[], km: number, target = TRACK_STOPS_PER_DAY): Pt[] {
  if (pts.length <= 2) return pts;
  const length = pts.slice(1).reduce((a, p, i) => a + haversineKm(pts[i], p), 0);
  let spacing = Math.max(km, length / Math.max(1, target - 1));
  let out: Pt[] = [];
  for (let tries = 0; tries < 6; tries++) {
    out = [pts[0]];
    for (const p of pts.slice(1, -1)) if (haversineKm(out[out.length - 1], p) >= spacing) out.push(p);
    const last = pts[pts.length - 1];
    if (haversineKm(out[out.length - 1], last) > 0.05) out.push(last);
    if (out.length <= MAX_STOPS) break;
    spacing *= 2;
  }
  return out;
}

/** Points with times on several dates → one day per date; otherwise chunks of STOPS_PER_DAY */
export function groupIntoDays(pts: Pt[]): RouteStop[][] {
  const dated = pts.every((p) => p.time && !Number.isNaN(Date.parse(p.time)));
  if (dated && pts.length) {
    const byDate = new Map<string, Pt[]>();
    for (const p of pts) {
      const d = new Date(p.time!).toISOString().slice(0, 10);
      byDate.set(d, [...(byDate.get(d) ?? []), p]);
    }
    if (byDate.size > 1) {
      let i = 0;
      return [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, ps]) => ps.map((p) => toStop(p, i++)));
    }
  }
  const stops = pts.map(toStop);
  const out: RouteStop[][] = [];
  for (let i = 0; i < stops.length; i += STOPS_PER_DAY) out.push(stops.slice(i, i + STOPS_PER_DAY));
  return out;
}

const pt = (el: Element, lat: string | null, lng: string | null): Pt => ({
  name: childText(el, "name"),
  latitude: num(lat),
  longitude: num(lng),
  time: childText(el, "time"),
  description: childText(el, "desc") ?? childText(el, "cmt") ?? childText(el, "description"),
});

/** Several named groups (GPX <rte>/<trk>, KML <Folder>) with points each → one day per group */
function daysFromGroups(groups: { title: string | null; pts: Pt[] }[]): RouteDay[] | null {
  const real = groups.filter((g) => g.pts.length);
  if (real.length < 2) return null;
  let i = 0;
  return real.map((g) => ({ title: g.title, stops: g.pts.map((p) => toStop(p, i++)) }));
}

function parseGpx(doc: Document): ParsedRoute {
  const meta = byTag(doc, "metadata")[0];
  const title = (meta && childText(meta, "name")) || null;
  const description = (meta && childText(meta, "desc")) || null;
  const wpts = byTag(doc, "wpt").map((e) => pt(e, e.getAttribute("lat"), e.getAttribute("lon"))).filter(valid);
  const routes = byTag(doc, "rte").map((r) => ({ title: childText(r, "name"), pts: byTag(r, "rtept").map((e) => pt(e, e.getAttribute("lat"), e.getAttribute("lon"))).filter(valid) }));
  const tracks = byTag(doc, "trk").map((t) => ({ title: childText(t, "name"), pts: byTag(t, "trkpt").map((e) => pt(e, e.getAttribute("lat"), e.getAttribute("lon"))).filter(valid) }));

  let days: RouteDay[] | null = null;
  let summary = "";
  if (wpts.length >= 2 || (wpts.length && !routes.length && !tracks.length)) {
    days = groupIntoDays(wpts.slice(0, MAX_STOPS)).map((stops) => ({ title: null, stops }));
    summary = `${Math.min(wpts.length, MAX_STOPS)} waypoints`;
  } else if (routes.some((r) => r.pts.length)) {
    days = daysFromGroups(routes) ?? groupIntoDays(routes.flatMap((r) => r.pts).slice(0, MAX_STOPS)).map((stops) => ({ title: null, stops }));
    summary = `${routes.reduce((n, r) => n + r.pts.length, 0)} route points`;
  } else if (tracks.some((t) => t.pts.length)) {
    const sampled = tracks.map((t) => ({ title: t.title, pts: sampleTrack(t.pts, TRACK_SPACING_KM) }));
    days = daysFromGroups(sampled) ?? groupIntoDays(sampleTrack(tracks.flatMap((t) => t.pts), TRACK_SPACING_KM, 12)).map((stops) => ({ title: null, stops }));
    summary = `a track of ${tracks.reduce((n, t) => n + t.pts.length, 0)} points, sampled into stops`;
  }
  if (!days?.length) throw new Error("No waypoints, route points or track points found in this GPX file.");
  return { title: title ?? tracks[0]?.title ?? routes[0]?.title ?? null, description, days, tips: [], country: null, summary };
}

/** KML "lng,lat[,alt] lng,lat …" */
const kmlCoords = (s: string | null | undefined): { latitude: number; longitude: number }[] =>
  (s ?? "")
    .trim()
    .split(/\s+/)
    .map((c) => c.split(","))
    .map(([lng, lat]) => ({ latitude: Number(lat), longitude: Number(lng) }))
    .filter(valid);

function placemarkPts(root: Element | Document): { points: Pt[]; lines: Pt[] } {
  const points: Pt[] = [];
  const lines: Pt[] = [];
  for (const pm of byTag(root, "Placemark")) {
    const name = childText(pm, "name");
    const description = childText(pm, "description")?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || null;
    const time = byTag(pm, "when")[0]?.textContent?.trim() || byTag(pm, "begin")[0]?.textContent?.trim() || null;
    const point = byTag(pm, "Point")[0];
    if (point) {
      const c = kmlCoords(byTag(point, "coordinates")[0]?.textContent)[0];
      if (c) points.push({ name, description, time, ...c });
      continue;
    }
    for (const ls of [...byTag(pm, "LineString"), ...byTag(pm, "LinearRing")]) {
      for (const c of kmlCoords(byTag(ls, "coordinates")[0]?.textContent)) lines.push({ name: null, description: null, time: null, ...c });
    }
    for (const track of byTag(pm, "Track")) {
      for (const c of byTag(track, "coord")) {
        const [lng, lat] = (c.textContent ?? "").trim().split(/\s+/).map(Number);
        const p = { latitude: lat, longitude: lng };
        if (valid(p)) lines.push({ name: null, description: null, time: null, ...p });
      }
    }
  }
  return { points, lines };
}

function parseKml(doc: Document): ParsedRoute {
  const docEl = byTag(doc, "Document")[0];
  const title = (docEl && childText(docEl, "name")) || null;
  const description = (docEl && childText(docEl, "description"))?.replace(/<[^>]+>/g, " ").trim() || null;
  // Folders that directly hold point placemarks → one day each
  const folders = byTag(doc, "Folder")
    .filter((f) => !byTag(f, "Folder").length)
    .map((f) => ({ title: childText(f, "name"), pts: placemarkPts(f).points }));
  const { points, lines } = placemarkPts(doc);
  let days = daysFromGroups(folders);
  let summary = "";
  if (days) summary = `${points.length} placemarks in ${days.length} folders`;
  else if (points.length) {
    days = groupIntoDays(points.slice(0, MAX_STOPS)).map((stops) => ({ title: null, stops }));
    summary = `${Math.min(points.length, MAX_STOPS)} placemarks`;
  } else if (lines.length) {
    days = groupIntoDays(sampleTrack(lines, TRACK_SPACING_KM, 12)).map((stops) => ({ title: null, stops }));
    summary = `a line of ${lines.length} points, sampled into stops`;
  }
  if (!days?.length) throw new Error("No placemarks or lines found in this KML file.");
  return { title, description, days, tips: [], country: null, summary };
}

/** A Ready Route export ({ title, plan: { days } } or { days: [...] }) or a plain array of stops */
function parseJson(text: string): ParsedRoute {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("This JSON file can't be read.");
  }
  const obj = (Array.isArray(raw) ? { stops: raw } : raw) as Record<string, unknown>;
  let days: RouteDay[] = [];
  const plan = obj.plan as { days?: unknown } | undefined;
  const dayList = Array.isArray(plan?.days) ? plan!.days : Array.isArray(obj.days) ? obj.days : null;
  if (dayList) {
    const norm = normalizeRoute({ id: "x", slug: "x", title: "x", plan: { days: dayList as RouteDay[] } } as CuratedRoute);
    days = norm.plan.days;
  } else if (Array.isArray(obj.stops)) {
    const pts = (obj.stops as Record<string, unknown>[])
      .map((s) => ({ name: (s.name as string) ?? null, latitude: Number(s.latitude ?? s.lat), longitude: Number(s.longitude ?? s.lng ?? s.lon), time: null, description: (s.description as string) ?? null }))
      .filter(valid);
    days = groupIntoDays(pts).map((stops) => ({ title: null, stops }));
  }
  days = days.filter((d) => d.stops.length);
  if (!days.length) throw new Error("No stops found. Expected a Ready Route export, { days: [...] } or an array of { name, latitude, longitude }.");
  const tips = Array.isArray(obj.tips) ? (obj.tips as RouteTip[]).filter((t) => t && typeof t.text === "string") : [];
  return {
    title: typeof obj.title === "string" ? obj.title : null,
    description: typeof obj.description === "string" ? obj.description : null,
    country: typeof obj.country === "string" ? obj.country : null,
    days,
    tips,
    summary: `${days.reduce((n, d) => n + d.stops.length, 0)} stops`,
  };
}

export async function parseRouteFile(file: File): Promise<ParsedRoute> {
  if (file.size > 15 * 1024 * 1024) throw new Error("That file is over 15 MB.");
  const text = await file.text();
  const ext = file.name.toLowerCase().split(".").pop();
  if (ext === "json" || /^\s*[[{]/.test(text)) return parseJson(text);
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("This file isn't valid XML. Upload a .gpx, .kml or .json route.");
  const root = doc.documentElement.localName.toLowerCase();
  if (root === "gpx") return parseGpx(doc);
  if (root === "kml") return parseKml(doc);
  throw new Error("Unsupported file. Upload a .gpx, .kml or .json route.");
}

interface NearPhoto {
  id: string;
  latitude: number;
  longitude: number;
  taken_at: string | null;
  thumb_url: string | null;
  photo_url: string | null;
}

const PHASE_OF: Record<string, LightPhase> = { sunrise: "Sunrise", sunset: "Sunset", blue: "Blue Hour", night: "Blue Hour" };

/**
 * For every stop without a thumbnail: public StoryMap photos within 500 m → the thumbnail (best-light shot)
 * and, when the stop has no light yet, the light most of them were taken in.
 * Returns the updated days and how many stops matched.
 */
export async function matchNearbyPhotos(days: RouteDay[]): Promise<{ days: RouteDay[]; matched: number }> {
  const db = getSupabase();
  let matched = 0;
  const one = async (s: RouteStop): Promise<RouteStop> => {
    if (s.thumb && s.light) return s;
    const dLat = MATCH_RADIUS_KM / 111;
    const dLng = MATCH_RADIUS_KM / (111 * Math.max(0.05, Math.cos((s.latitude * Math.PI) / 180)));
    const { data } = await db
      .from("photos")
      .select("id, latitude, longitude, taken_at, thumb_url, photo_url")
      .eq("is_private", false)
      .gte("latitude", s.latitude - dLat)
      .lte("latitude", s.latitude + dLat)
      .gte("longitude", s.longitude - dLng)
      .lte("longitude", s.longitude + dLng)
      .limit(60);
    const near = ((data ?? []) as NearPhoto[]).filter((p) => haversineKm(p, s) <= MATCH_RADIUS_KM);
    if (!near.length) return s;
    matched++;
    const counts: Record<string, number> = {};
    let best: NearPhoto | null = null;
    let bestScore = -1;
    for (const p of near) {
      const k = lightKeyOf(p) ?? "unknown";
      counts[k] = (counts[k] ?? 0) + 1;
      const score = (PHASE_OF[k] ? 2 : 0) + (p.thumb_url ? 1 : 0) - haversineKm(p, s);
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    const top = Object.entries(counts)
      .filter(([k]) => PHASE_OF[k])
      .sort((a, b) => b[1] - a[1])[0];
    const light: LightPhase = top ? PHASE_OF[top[0]] : "Golden Hour";
    return {
      ...s,
      thumb: s.thumb || best?.thumb_url || best?.photo_url || null,
      light: s.light ?? light,
      photo_id: s.photo_id ?? best?.id ?? null,
      description: s.description || `${near.length} StoryMap photo${near.length === 1 ? "" : "s"} within 500 m.`,
    };
  };
  const out: RouteDay[] = [];
  for (const d of days) {
    // a few requests at a time per day
    const stops = await Promise.all(d.stops.map(one));
    out.push({ ...d, stops });
  }
  return { days: out, matched };
}

/** A blank draft for "+ Upload Route" */
export function emptyDraft(): RouteDraft {
  return { slug: "", title: "", country: null, description: null, days: 1, stops_count: 0, cover_url: null, plan: { days: [{ title: null, stops: [] }] }, tips: [], published: true, sort_order: 0 };
}

export function draftFromParsed(p: ParsedRoute, fileName: string): RouteDraft {
  const title = p.title?.trim() || fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  const stops = p.days.flatMap((d) => d.stops);
  return {
    slug: slugify(title),
    title: title.slice(0, 140),
    country: p.country,
    description: p.description?.slice(0, 2000) ?? null,
    days: p.days.length,
    stops_count: stops.length,
    cover_url: stops.find((s) => s.thumb)?.thumb ?? null,
    plan: { days: p.days },
    tips: p.tips,
    published: true,
    sort_order: 0,
  };
}
