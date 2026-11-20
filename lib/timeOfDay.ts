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

/**
 * Classification by the sun's position *at the capture place and time*, not by a fixed hour:
 * - night:   before dawn / after dusk (includes astro twilight, where Milky Way shots live)
 * - sunrise: from dawn (blue hour) to the end of morning golden hour
 * - sunset:  from evening golden hour to dusk
 * - day:     everything else
 */
export function getTimeOfDay(takenAt: string | null, lat: number, lng: number): TimeOfDay | null {
  if (!takenAt) return null;
  const date = new Date(takenAt);
  if (!valid(date)) return null;

  const t = SunCalc.getTimes(date, lat, lng);
  const ms = date.getTime();

  // Polar regions (midnight sun / polar night): sun altitude only
  if (![t.dawn, t.goldenHourEnd, t.goldenHour, t.dusk].every(valid)) {
    const altitude = SunCalc.getPosition(date, lat, lng).altitude * (180 / Math.PI);
    if (altitude < -6) return "night";
    if (altitude < 6) return isMorning(date, lat, lng) ? "sunrise" : "sunset";
    return "day";
  }

  if (ms < t.dawn.getTime() || ms > t.dusk.getTime()) return "night";
  if (ms <= t.goldenHourEnd.getTime()) return "sunrise";
  if (ms >= t.goldenHour.getTime()) return "sunset";
  return "day";
}

const MORNING_TAGS = new Set(["sunrise", "dawn", "morning", "morninglight", "sunriseglow", "earlymorning"]);
const EVENING_TAGS = new Set(["sunset", "dusk", "evening", "eveninglight", "sunsetglow", "afterglow"]);

/**
 * The sunrise/sunset rule: visual analysis can't tell a sunrise from a sunset,
 * the timestamp can. Any morning/evening tag is flipped to match the capture time,
 * and the solar phase tag (sunrise / sunset / night) is always present.
 */
export function reconcileTimeTags(tags: string[], takenAt: string | null, lat: number, lng: number): string[] {
  const phase = getTimeOfDay(takenAt, lat, lng);
  if (!phase || !takenAt) return dedupe(tags);
  const morning = isMorning(new Date(takenAt), lat, lng);

  const out = tags.map((t) => {
    if (morning && EVENING_TAGS.has(t)) return t === "sunset" ? "sunrise" : t === "dusk" ? "dawn" : "morning";
    if (!morning && MORNING_TAGS.has(t)) return t === "sunrise" ? "sunset" : t === "dawn" ? "dusk" : "evening";
    return t;
  });

  if (phase === "sunrise" || phase === "sunset" || phase === "night") out.unshift(phase);
  // A daytime or night photo isn't a sunrise/sunset photo, whatever the colours suggest
  const cleaned = phase === "day" || phase === "night" ? out.filter((t) => t !== "sunrise" && t !== "sunset") : out;
  return dedupe(cleaned);
}

function dedupe(tags: string[]): string[] {
  return [...new Set(tags.map((t) => t.trim().toLowerCase().replace(/^#+/, "").replace(/\s+/g, "")).filter(Boolean))];
}
