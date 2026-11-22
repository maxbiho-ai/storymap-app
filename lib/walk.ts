import type { Photo } from "@/types/photo";
import { getSolarPhase, isMorning } from "@/lib/timeOfDay";

const R_KM = 6371.0088;
const RAD = Math.PI / 180;

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = (lat2 - lat1) * RAD;
  const dLng = (lng2 - lng1) * RAD;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Bounding box that contains the whole circle (for the DB pre-filter) */
export function radiusBox(lat: number, lng: number, km: number) {
  const dLat = km / 111.32;
  const dLng = km / (111.32 * Math.max(0.01, Math.cos(lat * RAD)));
  return { south: Math.max(-90, lat - dLat), north: Math.min(90, lat + dLat), west: lng - dLng, east: lng + dLng };
}

/** The order a photographer would shoot in: blue hour / sunrise first, night last */
export const WALK_STAGES = [
  "Blue Hour · Sunrise",
  "Sunrise · Golden Hour",
  "Morning",
  "Daytime",
  "Sunset · Golden Hour",
  "Blue Hour · Dusk",
  "Night",
  "Any time",
] as const;

/** Index into WALK_STAGES: the light the photo was taken in is the light the spot is best in */
export function stageOf(p: Photo): number {
  const s = getSolarPhase(p.taken_at, p.latitude, p.longitude);
  if (!s) return 7;
  if (s.phase === "night") return 6;
  if (s.phase === "sunrise") return s.blueHour ? 0 : 1;
  if (s.phase === "sunset") return s.blueHour ? 5 : 4;
  return p.taken_at && isMorning(new Date(p.taken_at), p.latitude, p.longitude) ? 2 : 3;
}

export interface WalkStop {
  photo: Photo;
  km: number;
  /** Rough drive time: 1.3x road factor at ~45 km/h */
  minutes: number;
  stage: number;
}

export const driveMinutes = (km: number) => Math.max(1, Math.round(((km * 1.3) / 45) * 60));

/** Pins within radiusKm of the origin, ordered by lighting stage, then by distance */
export function buildWalk(origin: Photo, candidates: Photo[], radiusKm: number): WalkStop[] {
  const seenPlace = new Set<string>();
  const stops: WalkStop[] = [];
  for (const p of candidates) {
    if (p.id === origin.id) continue;
    const km = haversineKm(origin.latitude, origin.longitude, p.latitude, p.longitude);
    if (km > radiusKm) continue;
    // Photos stacked on the same spot in the same light are one stop
    const stage = stageOf(p);
    const key = `${p.latitude.toFixed(4)},${p.longitude.toFixed(4)}|${stage}`;
    if (seenPlace.has(key)) continue;
    seenPlace.add(key);
    stops.push({ photo: p, km, minutes: driveMinutes(km), stage });
  }
  return stops.sort((a, b) => a.stage - b.stage || a.km - b.km);
}

export const streetViewUrl = (lat: number, lng: number) =>
  `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
