import type { Photo } from "@/types/photo";
import { getSolarPhase } from "@/lib/timeOfDay";

export type LightKey = "blue" | "sunrise" | "sunset" | "night";

export interface GearFilters {
  /** Any of these light conditions (OR) */
  light: LightKey[];
  /** Exposure of 1 second or longer */
  longExposure: boolean;
  /** Exact lens name from the photos' EXIF */
  lens: string | null;
}

export const EMPTY_GEAR: GearFilters = { light: [], longExposure: false, lens: null };

export const LIGHT_LABEL: Record<LightKey, string> = {
  blue: "Blue Hour",
  sunrise: "Sunrise",
  sunset: "Golden Hour / Sunset",
  night: "Night",
};

export const gearCount = (g: GearFilters) => g.light.length + (g.longExposure ? 1 : 0) + (g.lens ? 1 : 0);

/** "1/250" → 0.004, "2.5s" → 2.5, "30" / '30"' → 30; null when unreadable */
export function shutterSeconds(s: string | null): number | null {
  if (!s) return null;
  const t = s.trim().replace(/["”″s]|sec$/gi, "").trim();
  const frac = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(t);
  if (frac) return Number(frac[2]) > 0 ? Number(frac[1]) / Number(frac[2]) : null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export const isLongExposure = (p: Photo) => (shutterSeconds(p.shutter_speed) ?? 0) >= 1;

/**
 * Light condition at capture, from the timestamp + GPS (not from tags, so older photos work too).
 * Blue hour = twilight around sunrise / sunset; sunrise / sunset = their golden-hour windows.
 */
export function lightKeyOf(p: Photo): LightKey | "day" | null {
  const s = getSolarPhase(p.taken_at, p.latitude, p.longitude);
  if (!s) return null;
  if (s.blueHour) return "blue";
  return s.phase === "day" ? "day" : s.phase;
}

export function matchesGear(p: Photo, g: GearFilters): boolean {
  if (g.lens && p.lens !== g.lens) return false;
  if (g.longExposure && !isLongExposure(p)) return false;
  if (g.light.length) {
    const k = lightKeyOf(p);
    if (!k || k === "day" || !g.light.includes(k)) return false;
  }
  return true;
}

/** Distinct lenses with counts, most used first */
export function lensOptions(photos: Photo[]): { lens: string; count: number }[] {
  const m = new Map<string, number>();
  for (const p of photos) if (p.lens?.trim()) m.set(p.lens, (m.get(p.lens) ?? 0) + 1);
  return [...m].map(([lens, count]) => ({ lens, count })).sort((a, b) => b.count - a.count || a.lens.localeCompare(b.lens));
}
