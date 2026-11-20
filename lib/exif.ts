import exifr from "exifr";
import type { ExtractedExif } from "@/types/photo";

const EMPTY: ExtractedExif = {
  latitude: null,
  longitude: null,
  taken_wall: null,
  taken_offset: null,
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

/**
 * exifr parses DateTimeOriginal as browser-local time; reading the local components
 * back gives the camera's wall clock exactly as written ("2024-03-22T19:08:00").
 */
function wallClock(d: unknown): string | null {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
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
    // 0,0 is almost always an empty GPS block, not the Gulf of Guinea
    const hasGps = lat !== null && lng !== null && !(lat === 0 && lng === 0);

    return {
      latitude: hasGps ? lat : null,
      longitude: hasGps ? lng : null,
      taken_wall: wallClock(data.DateTimeOriginal) ?? wallClock(data.CreateDate),
      taken_offset: typeof data.OffsetTimeOriginal === "string" ? data.OffsetTimeOriginal.trim() : null,
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
