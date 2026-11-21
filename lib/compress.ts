import imageCompression from "browser-image-compression";

export interface CompressedImage {
  file: File;
  width: number;
  height: number;
  /** ~480px for map pins and the AI tag call (~40-80KB) */
  thumb: File;
}

/** Long edge of the stored main image (4K). Smaller photos are never upscaled. */
const MAX_DIMENSION = 3840;
/** High photographic quality; the browser's JPEG encoder has no chroma-subsampling option */
const QUALITY = 0.92;
/**
 * Safety cap only, well above what q92 at 3840px produces (~3-8MB), so the library never
 * lowers quality or resolution to hit a size target. Bucket limit: migration 005 (25MB).
 */
const MAX_SIZE_MB = 24;
/** Bucket limit before migration 005 (5MB) */
export const LEGACY_BUCKET_LIMIT_MB = 4.9;

async function readDimensions(file: Blob): Promise<{ width: number; height: number }> {
  const bmp = await createImageBitmap(file);
  const dims = { width: bmp.width, height: bmp.height };
  bmp.close();
  return dims;
}

/**
 * Step (b): up to 3840px on the long edge, JPEG at 92%.
 * - A JPEG that is already within 3840px and the size cap is kept byte-for-byte when it has no
 *   GPS, so it is never re-encoded (the public file must not carry GPS; that is checked by the caller
 *   through `keepOriginal`).
 * - Runs in a Web Worker so the UI stays responsive.
 * - Output is always JPEG, also for HEIC/PNG/WebP input (HEIC decodes in Safari only).
 */
export async function compressImage(
  file: File,
  opts: { keepOriginal?: boolean; onProgress?: (pct: number) => void } = {},
): Promise<CompressedImage> {
  const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
  const isJpeg = file.type === "image/jpeg" || /\.jpe?g$/i.test(file.name);

  let out: File | null = null;
  if (opts.keepOriginal && isJpeg && file.size <= MAX_SIZE_MB * 1024 * 1024) {
    // createImageBitmap applies EXIF orientation by default; compare against the raw size to know if
    // the file is upright as stored (rotated originals are re-encoded so every viewer shows them right)
    const upright = await createImageBitmap(file, { imageOrientation: "none" } as ImageBitmapOptions)
      .then(async (raw) => {
        const oriented = await createImageBitmap(file);
        const same = raw.width === oriented.width && raw.height === oriented.height;
        const fits = Math.max(raw.width, raw.height) <= MAX_DIMENSION;
        raw.close();
        oriented.close();
        return same && fits;
      })
      .catch(() => false);
    if (upright) out = new File([file], name, { type: "image/jpeg" });
  }

  if (!out) {
    const compressed = await imageCompression(file, {
      maxWidthOrHeight: MAX_DIMENSION,
      initialQuality: QUALITY,
      maxSizeMB: MAX_SIZE_MB,
      alwaysKeepResolution: true,
      fileType: "image/jpeg",
      useWebWorker: true,
      preserveExif: false, // EXIF is stored in the DB; the public file goes out without GPS
      onProgress: opts.onProgress,
    });
    out = new File([compressed], name, { type: "image/jpeg" });
  }
  const { width, height } = await readDimensions(out);

  const thumbBlob = await imageCompression(out, {
    maxWidthOrHeight: 480,
    initialQuality: 0.8,
    maxSizeMB: 0.2,
    fileType: "image/jpeg",
    useWebWorker: true,
  });
  const thumb = new File([thumbBlob], name.replace(/\.jpg$/, "_thumb.jpg"), { type: "image/jpeg" });

  return { file: out, width, height, thumb };
}

/**
 * Fallback while the bucket still has the old 5MB limit: same resolution, quality lowered
 * only as far as needed to fit.
 */
export async function fitLegacyLimit(file: File): Promise<File> {
  const blob = await imageCompression(file, {
    maxSizeMB: LEGACY_BUCKET_LIMIT_MB,
    initialQuality: 0.9,
    alwaysKeepResolution: true,
    fileType: "image/jpeg",
    useWebWorker: true,
  });
  return new File([blob], file.name, { type: "image/jpeg" });
}
