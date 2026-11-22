import SunCalc from "suncalc";

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

export type LightBody = "sun" | "moon";

export interface LightDirection {
  body: LightBody;
  /** Compass bearing of the light source, degrees clockwise from north (0 = N, 90 = E) */
  azimuth: number;
  /** Degrees above the horizon (negative = below) */
  altitude: number;
}

/** SunCalc measures azimuth from south, westwards: convert to a compass bearing */
const toBearing = (azSouthWest: number) => (azSouthWest * DEG + 180 + 360) % 360;

export function sunDirection(date: Date, lat: number, lng: number): LightDirection {
  const p = SunCalc.getPosition(date, lat, lng);
  return { body: "sun", azimuth: toBearing(p.azimuth), altitude: p.altitude * DEG };
}

export function moonDirection(date: Date, lat: number, lng: number): LightDirection {
  const p = SunCalc.getMoonPosition(date, lat, lng);
  return { body: "moon", azimuth: toBearing(p.azimuth), altitude: p.altitude * DEG };
}

/** Sun in daylight / twilight glow (above -6°), otherwise the moon when it is up, otherwise the sun */
export function lightDirectionAt(date: Date, lat: number, lng: number): LightDirection {
  const sun = sunDirection(date, lat, lng);
  if (sun.altitude > -6) return sun;
  const moon = moonDirection(date, lat, lng);
  return moon.altitude > 0 ? moon : sun;
}

const POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
export const compassPoint = (bearing: number) => POINTS[Math.round((((bearing % 360) + 360) % 360) / 22.5) % 16];

/** Point at `meters` from (lat, lng) along a compass bearing: [lng, lat] */
export function destination(lat: number, lng: number, bearing: number, meters: number): [number, number] {
  const R = 6371008.8;
  const d = meters / R;
  const b = bearing * RAD;
  const φ1 = lat * RAD;
  const λ1 = lng * RAD;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(b));
  const λ2 = λ1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * Math.sin(φ2));
  return [((λ2 * DEG + 540) % 360) - 180, φ2 * DEG];
}

/** Ground meters covered by one screen pixel at this latitude and zoom (Web Mercator, 512px tiles) */
export const metersPerPixel = (lat: number, zoom: number) => (40075016.686 * Math.cos(lat * RAD)) / (512 * 2 ** zoom);

/* ---------------------------------------------------------------------- */
/* Light planner: when does the sun / moon reach this azimuth on a date?   */
/* ---------------------------------------------------------------------- */

const angleDiff = (a: number, b: number) => ((a - b + 540) % 360) - 180;

export interface AzimuthHit {
  time: Date;
  altitude: number;
}

/**
 * Times (UTC instants) on the local solar day of `dateStr` ("YYYY-MM-DD") when the body's azimuth
 * equals `target`, while it is usable for photos (sun above -6°, moon above the horizon).
 * The search window is the 24h solar day (local solar midnight to midnight), scanned every minute
 * with each crossing refined linearly.
 */
export function findAzimuthTimes(dateStr: string, lat: number, lng: number, target: number, body: LightBody): AzimuthHit[] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return [];
  // Local solar midnight (approximate, by longitude); the window covers exactly one civil-ish day
  const start = Date.UTC(+m[1], +m[2] - 1, +m[3]) - (lng / 15) * 3600_000;
  const dir = (t: number) => (body === "sun" ? sunDirection(new Date(t), lat, lng) : moonDirection(new Date(t), lat, lng));
  const usable = (alt: number) => (body === "sun" ? alt > -6 : alt > 0);

  const hits: AzimuthHit[] = [];
  const step = 60_000;
  let prevT = start;
  let prev = angleDiff(dir(prevT).azimuth, target);
  for (let t = start + step; t <= start + 24 * 3600_000; t += step) {
    const cur = angleDiff(dir(t).azimuth, target);
    // A sign change small enough to be a real crossing (not the ±180° wrap on the far side)
    if (Math.sign(prev) !== Math.sign(cur) && Math.abs(prev) < 90 && Math.abs(cur) < 90) {
      // Linear refinement inside the minute
      const frac = Math.abs(prev) / (Math.abs(prev) + Math.abs(cur) || 1);
      const when = prevT + frac * step;
      const d = dir(when);
      if (usable(d.altitude)) hits.push({ time: new Date(Math.round(when / 1000) * 1000), altitude: d.altitude });
    }
    prevT = t;
    prev = cur;
  }
  return hits;
}

export interface DayLight {
  blueDawn: Date | null;
  sunrise: Date | null;
  goldenMorningEnd: Date | null;
  goldenEveningStart: Date | null;
  sunset: Date | null;
  blueDusk: Date | null;
  /** Polar day / night: no sunrise or sunset */
  polar: boolean;
}

const ok = (d: Date | undefined): Date | null => (d && !Number.isNaN(d.getTime()) ? d : null);

/** Sun times for the local day of `dateStr`, evaluated at local solar noon */
export function dayLight(dateStr: string, lat: number, lng: number): DayLight {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  const noon = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12) - (lng / 15) * 3600_000) : new Date();
  const t = SunCalc.getTimes(noon, lat, lng);
  const sunrise = ok(t.sunrise);
  const sunset = ok(t.sunset);
  return {
    blueDawn: ok(t.dawn),
    sunrise,
    goldenMorningEnd: ok(t.goldenHourEnd),
    goldenEveningStart: ok(t.goldenHour),
    sunset,
    blueDusk: ok(t.dusk),
    polar: !sunrise || !sunset,
  };
}

/** "07:42" in the given IANA timezone (the photo's location), falling back to UTC */
export function formatClock(d: Date, tz?: string | null): string {
  const base = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } as const;
  try {
    return d.toLocaleTimeString("en-GB", tz ? { ...base, timeZone: tz } : { ...base, timeZone: "UTC" });
  } catch {
    return d.toLocaleTimeString("en-GB", { ...base, timeZone: "UTC" });
  }
}
