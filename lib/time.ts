import tzlookup from "tz-lookup";

/** IANA timezone for coordinates; null if the lookup fails */
export function timezoneAt(lat: number, lng: number): string | null {
  try {
    return tzlookup(lat, lng);
  } catch {
    return null;
  }
}

/** Offset (ms) of `tz` at instant `date`: local wall time minus UTC */
function tzOffsetMs(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - date.getTime();
}

const WALL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** Wall-clock time in `tz` → UTC instant (handles DST) */
export function wallTimeToUtc(wall: string, tz: string): Date | null {
  const m = WALL_RE.exec(wall);
  if (!m) return null;
  const naive = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
  let utc = naive;
  for (let i = 0; i < 2; i++) utc = naive - tzOffsetMs(new Date(utc), tz);
  return new Date(utc);
}

/**
 * The real capture instant.
 * 1. Camera wrote OffsetTimeOriginal → exact.
 * 2. Otherwise the wall clock is interpreted in the timezone of the photo's location
 *    (a Frankfurt photo at 19:08 is 19:08 Frankfurt time, wherever it's uploaded from).
 * 3. No location timezone → the browser's timezone.
 */
export function resolveTakenAt(
  wall: string | null,
  offset: string | null,
  lat: number | null,
  lng: number | null,
): { taken_at: string | null; taken_tz: string | null } {
  const tz = lat != null && lng != null ? timezoneAt(lat, lng) : null;
  if (!wall) return { taken_at: null, taken_tz: tz };

  if (offset && /^[+-]\d{2}:\d{2}$/.test(offset)) {
    const d = new Date(`${wall.length === 16 ? `${wall}:00` : wall}${offset}`);
    if (!Number.isNaN(d.getTime())) return { taken_at: d.toISOString(), taken_tz: tz };
  }
  if (tz) {
    const d = wallTimeToUtc(wall, tz);
    if (d) return { taken_at: d.toISOString(), taken_tz: tz };
  }
  const local = new Date(wall);
  return { taken_at: Number.isNaN(local.getTime()) ? null : local.toISOString(), taken_tz: tz };
}

/** "March 22, 2024 at 19:08", in the capture location's local time when known */
export function formatTakenAt(iso: string | null, tz?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const opts = tz ? { timeZone: tz } : {};
  try {
    const date = d.toLocaleDateString("en-US", { ...opts, month: "long", day: "numeric", year: "numeric" });
    const time = d.toLocaleTimeString("en-GB", { ...opts, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    return `${date} at ${time}`;
  } catch {
    return formatTakenAt(iso, null); // unknown tz string
  }
}
