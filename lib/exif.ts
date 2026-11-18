import exifr from "exifr";
import type { ExtractedExif } from "@/types/photo";

const EMPTY: ExtractedExif = {
  latitude: null,
  longitude: null,
  taken_at: null,
  camera_make: null,
  camera_model: null,
  lens: null,
  focal_length: null,
  aperture: null,
  shutter_speed: null,
  iso: null,
};

/** 1/250 במקום 0.004 — הפורמט שצלמים מכירים */
function formatShutter(seconds: number | undefined): string | null {
  if (!seconds || seconds <= 0) return null;
  if (seconds >= 1) return `${Number(seconds.toFixed(1))}s`;
  return `1/${Math.round(1 / seconds)}`;
}

function toIso(d: unknown): string | null {
  if (d instanceof Date && !Number.isNaN(d.getTime())) return d.toISOString();
  return null;
}

/**
 * EXIF שומר שעון-קיר בלי אזור זמן, ו-exifr מפרש אותו לפי אזור הזמן של הדפדפן.
 * אם המצלמה כתבה OffsetTimeOriginal (+03:00) — בונים את הרגע המדויק,
 * כך שצילום באוגנדה שמועלה מישראל לא יזוז בשעה.
 */
function withOffset(d: unknown, offset: unknown): string | null {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  if (typeof offset !== "string" || !/^[+-]\d{2}:\d{2}$/.test(offset)) return d.toISOString();
  const p = (n: number) => String(n).padStart(2, "0");
  const wall = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  const fixed = new Date(wall + offset);
  return Number.isNaN(fixed.getTime()) ? d.toISOString() : fixed.toISOString();
}

function cleanStr(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\0/g, "").trim();
  return s || null;
}

/**
 * שלב (א): חילוץ EXIF מהקובץ המקורי.
 * חייב לרוץ *לפני* הכיווץ — browser-image-compression מוחק EXIF.
 * לעולם לא זורק: קובץ בלי EXIF מחזיר אובייקט ריק.
 */
export async function extractExif(file: File): Promise<ExtractedExif> {
  try {
    const data = await exifr.parse(file, {
      gps: true,     // מחזיר latitude/longitude עשרוניים מוכנים
      tiff: true,
      exif: true,
      ifd1: false,
      xmp: false,
      icc: false,
      iptc: false,
      pick: [
        "latitude", "longitude",
        "DateTimeOriginal", "CreateDate", "OffsetTimeOriginal",
        "Make", "Model", "LensModel", "LensMake",
        "FocalLength", "FNumber", "ExposureTime", "ISO",
      ],
    });
    if (!data) return EMPTY;

    const lat = typeof data.latitude === "number" ? data.latitude : null;
    const lng = typeof data.longitude === "number" ? data.longitude : null;
    // 0,0 הוא כמעט תמיד GPS ריק ולא תמונה ממפרץ גינאה
    const hasGps = lat !== null && lng !== null && !(lat === 0 && lng === 0);

    return {
      latitude: hasGps ? lat : null,
      longitude: hasGps ? lng : null,
      taken_at: withOffset(data.DateTimeOriginal, data.OffsetTimeOriginal) ?? toIso(data.CreateDate),
      camera_make: cleanStr(data.Make),
      camera_model: cleanStr(data.Model),
      lens: cleanStr(data.LensModel),
      focal_length: typeof data.FocalLength === "number" ? data.FocalLength : null,
      aperture: typeof data.FNumber === "number" ? data.FNumber : null,
      shutter_speed: formatShutter(data.ExposureTime),
      iso: typeof data.ISO === "number" ? Math.round(data.ISO) : null,
    };
  } catch (err) {
    console.warn("EXIF extraction failed", err);
    return EMPTY;
  }
}
