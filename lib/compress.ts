import imageCompression from "browser-image-compression";

export interface CompressedImage {
  file: File;
  width: number;
  height: number;
  /** ממוזערת ~480px לפינים במפה ולגלריה (~30-60KB) */
  thumb: File;
}

const MAX_DIMENSION = 2048;
const QUALITY = 0.82;

async function readDimensions(file: Blob): Promise<{ width: number; height: number }> {
  const bmp = await createImageBitmap(file);
  const dims = { width: bmp.width, height: bmp.height };
  bmp.close();
  return dims;
}

/**
 * שלב (ב): כיווץ ל-2048px בצלע הארוכה, JPEG באיכות 82%.
 * - maxSizeMB הוא תקרת ביטחון בלבד (1MB). היעד בפועל (~400-600KB)
 *   נקבע ע"י הרזולוציה + האיכות; ב-82% רוב התמונות נוחתות בטווח הזה.
 * - רץ ב-Web Worker כדי לא לתקוע את ה-UI.
 * - פלט תמיד JPEG, גם אם הקלט HEIC/PNG/WebP (HEIC נתמך רק ב-Safari).
 */
export async function compressImage(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<CompressedImage> {
  const compressed = await imageCompression(file, {
    maxWidthOrHeight: MAX_DIMENSION,
    initialQuality: QUALITY,
    maxSizeMB: 1,
    fileType: "image/jpeg",
    useWebWorker: true,
    preserveExif: false, // אנחנו שומרים EXIF ב-DB; בקובץ הציבורי עדיף בלי GPS
    onProgress,
  });

  const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
  const out = new File([compressed], name, { type: "image/jpeg" });
  const { width, height } = await readDimensions(out);

  // נגזרת מהקובץ המכווץ (מהיר יותר מהמקור)
  const thumbBlob = await imageCompression(out, {
    maxWidthOrHeight: 480,
    initialQuality: 0.75,
    maxSizeMB: 0.15,
    fileType: "image/jpeg",
    useWebWorker: true,
  });
  const thumb = new File([thumbBlob], name.replace(/\.jpg$/, "_thumb.jpg"), { type: "image/jpeg" });

  return { file: out, width, height, thumb };
}
