import SunCalc from "suncalc";

export type TimeOfDay = "sunrise" | "day" | "sunset" | "night";

export const TIME_OF_DAY_LABEL: Record<TimeOfDay, string> = {
  sunrise: "זריחה",
  day: "יום",
  sunset: "שקיעה",
  night: "לילה",
};

/**
 * סיווג לפי מיקום השמש *במקום ובזמן הצילום* (לא לפי שעה עגולה):
 * - night:   לפני dawn / אחרי dusk (כולל ה-astro twilight — שם צולם שביל החלב)
 * - sunrise: מ-dawn (שעה כחולה) עד סוף שעת הזהב של הבוקר
 * - sunset:  מתחילת שעת הזהב של הערב עד dusk
 * - day:     כל השאר
 */
export function getTimeOfDay(takenAt: string | null, lat: number, lng: number): TimeOfDay | null {
  if (!takenAt) return null;
  const date = new Date(takenAt);
  if (Number.isNaN(date.getTime())) return null;

  const t = SunCalc.getTimes(date, lat, lng);
  const ms = date.getTime();
  const valid = (d: Date) => d instanceof Date && !Number.isNaN(d.getTime());

  // אזורים קוטביים (שמש חצות / לילה קוטבי) — לפי גובה השמש בלבד
  if (![t.dawn, t.goldenHourEnd, t.goldenHour, t.dusk].every(valid)) {
    const altitude = SunCalc.getPosition(date, lat, lng).altitude * (180 / Math.PI);
    if (altitude < -6) return "night";
    if (altitude < 6) return date.getUTCHours() + lng / 15 < 12 ? "sunrise" : "sunset";
    return "day";
  }

  if (ms < t.dawn.getTime() || ms > t.dusk.getTime()) return "night";
  if (ms <= t.goldenHourEnd.getTime()) return "sunrise";
  if (ms >= t.goldenHour.getTime()) return "sunset";
  return "day";
}
