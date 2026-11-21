import SunCalc from "suncalc";

export type TimeOfDay = "sunrise" | "day" | "sunset" | "night";

export const TIME_OF_DAY_LABEL: Record<TimeOfDay, string> = {
  sunrise: "Sunrise",
  day: "Daytime",
  sunset: "Sunset",
  night: "Night",
};

const valid = (d: Date) => d instanceof Date && !Number.isNaN(d.getTime());

/** Before local solar noon at the capture location? (morning vs evening, independent of timezones) */
export function isMorning(date: Date, lat: number, lng: number): boolean {
  const noon = SunCalc.getTimes(date, lat, lng).solarNoon;
  if (valid(noon)) {
    // getTimes() can return the solar noon of the neighbouring UTC day; compare within ±12h
    let diff = date.getTime() - noon.getTime();
    const day = 24 * 3600 * 1000;
    while (diff > day / 2) diff -= day;
    while (diff < -day / 2) diff += day;
    return diff < 0;
  }
  return (date.getUTCHours() + lng / 15 + 24) % 24 < 12;
}

/** Blue hour before sunrise / after sunset: at least this long, or civil twilight if that is longer */
const TWILIGHT_WINDOW_MS = 60 * 60 * 1000;

export interface SolarPhase {
  phase: TimeOfDay;
  /** Sun below the horizon but inside the pre-sunrise / post-sunset twilight window */
  blueHour: boolean;
}

/**
 * Classification by the sun's position *at the capture place and time*, not by a fixed hour:
 * - night:   more than ~1h before sunrise / after sunset (and outside civil twilight)
 * - sunrise: from the pre-sunrise blue hour (60 min before sunrise, or civil dawn if earlier)
 *            to the end of morning golden hour
 * - sunset:  from evening golden hour to the post-sunset blue hour (60 min, or civil dusk if later)
 * - day:     everything else
 */
export function getSolarPhase(takenAt: string | null, lat: number, lng: number): SolarPhase | null {
  if (!takenAt) return null;
  const date = new Date(takenAt);
  if (!valid(date)) return null;

  const t = SunCalc.getTimes(date, lat, lng);
  const ms = date.getTime();

  // Polar regions (midnight sun / polar night): sun altitude only
  if (![t.dawn, t.sunrise, t.goldenHourEnd, t.goldenHour, t.sunset, t.dusk].every(valid)) {
    const altitude = SunCalc.getPosition(date, lat, lng).altitude * (180 / Math.PI);
    if (altitude < -8) return { phase: "night", blueHour: false };
    if (altitude < 6) return { phase: isMorning(date, lat, lng) ? "sunrise" : "sunset", blueHour: altitude < 0 };
    return { phase: "day", blueHour: false };
  }

  const start = Math.min(t.dawn.getTime(), t.sunrise.getTime() - TWILIGHT_WINDOW_MS);
  const end = Math.max(t.dusk.getTime(), t.sunset.getTime() + TWILIGHT_WINDOW_MS);
  if (ms < start || ms > end) return { phase: "night", blueHour: false };
  if (ms <= t.goldenHourEnd.getTime()) return { phase: "sunrise", blueHour: ms < t.sunrise.getTime() };
  if (ms >= t.goldenHour.getTime()) return { phase: "sunset", blueHour: ms > t.sunset.getTime() };
  return { phase: "day", blueHour: false };
}

export function getTimeOfDay(takenAt: string | null, lat: number, lng: number): TimeOfDay | null {
  return getSolarPhase(takenAt, lat, lng)?.phase ?? null;
}

/** Display label: "Blue Hour · Sunrise" / "Sunset · Blue Hour" inside the twilight window */
export function solarPhaseLabel(p: SolarPhase): string {
  if (p.blueHour && p.phase === "sunrise") return "Blue Hour · Sunrise";
  if (p.blueHour && p.phase === "sunset") return "Sunset · Blue Hour";
  return TIME_OF_DAY_LABEL[p.phase];
}

const MORNING_TAGS = new Set(["sunrise", "dawn", "morning", "morninglight", "sunriseglow", "earlymorning"]);
const TWILIGHT_TAGS = new Set(["sunrise", "sunset", "dawn", "dusk", "bluehour", "twilight"]);
const EVENING_TAGS = new Set(["sunset", "dusk", "evening", "eveninglight", "sunsetglow", "afterglow"]);

/**
 * The sunrise/sunset rule: visual analysis can't tell a sunrise from a sunset,
 * the timestamp can. Any morning/evening tag is flipped to match the capture time,
 * and the solar phase tag (sunrise / sunset / night) is always present.
 */
export function reconcileTimeTags(tags: string[], takenAt: string | null, lat: number, lng: number): string[] {
  const solar = getSolarPhase(takenAt, lat, lng);
  if (!solar || !takenAt) return dedupe(tags);
  const { phase, blueHour } = solar;
  const morning = isMorning(new Date(takenAt), lat, lng);

  const out = tags.map((t) => {
    if (morning && EVENING_TAGS.has(t)) return t === "sunset" ? "sunrise" : t === "dusk" ? "dawn" : "morning";
    if (!morning && MORNING_TAGS.has(t)) return t === "sunrise" ? "sunset" : t === "dawn" ? "dusk" : "evening";
    return t;
  });

  if (phase === "sunrise" || phase === "sunset" || phase === "night") out.unshift(phase);
  // Pre-sunrise / post-sunset twilight: dawn/dusk + blue hour belong with it (#night from the AI may stay)
  if (blueHour) out.splice(1, 0, phase === "sunrise" ? "dawn" : "dusk", "bluehour");
  // A deep-night photo isn't a sunrise/sunset/blue-hour photo, and a daytime one isn't either
  const cleaned =
    phase === "night"
      ? out.filter((t) => !TWILIGHT_TAGS.has(t))
      : phase === "day"
        ? out.filter((t) => t !== "sunrise" && t !== "sunset" && t !== "night")
        : blueHour
          ? out
          : out.filter((t) => t !== "night"); // sun is up: golden hour, not night
  return dedupe(cleaned);
}

function dedupe(tags: string[]): string[] {
  return [...new Set(tags.map((t) => t.trim().toLowerCase().replace(/^#+/, "").replace(/\s+/g, "")).filter(Boolean))];
}
