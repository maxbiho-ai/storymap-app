import { getSupabase, PHOTOS_BUCKET } from "@/lib/supabase/client";
import type { ExtractedExif, Photo, PhotoInsert } from "@/types/photo";
import type { CompressedImage } from "@/lib/compress";

export interface PhotoMeta {
  title?: string;
  description?: string;
  location_name?: string;
  tags: string[];
  is_private: boolean;
  /** מיקום ידני — גובר על ה-EXIF (או מחליף אותו כשאין GPS) */
  manualLocation?: { latitude: number; longitude: number } | null;
}

/**
 * שלבים (ג)+(ד): העלאה ל-Storage ושמירת רשומה ב-DB.
 * אם ה-INSERT נכשל — הקובץ נמחק מה-Storage כדי לא להשאיר "יתומים".
 */
export async function uploadPhoto(
  compressed: CompressedImage,
  exif: ExtractedExif,
  meta: PhotoMeta,
  onStage?: (stage: "uploading" | "saving") => void,
): Promise<Photo> {
  const supabase = getSupabase();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth.user) throw new Error("צריך להתחבר כדי להעלות תמונות");
  const userId = auth.user.id;

  const lat = meta.manualLocation?.latitude ?? exif.latitude;
  const lng = meta.manualLocation?.longitude ?? exif.longitude;
  if (lat == null || lng == null) {
    throw new Error("לתמונה אין GPS — צריך לבחור מיקום ידנית");
  }

  onStage?.("uploading");
  // (ג) Storage — התיקייה הראשונה = user_id (נאכף ב-storage policy)
  const id = crypto.randomUUID();
  const storagePath = `${userId}/${id}.jpg`;
  const thumbPath = `${userId}/${id}_thumb.jpg`;
  const opts = {
    contentType: "image/jpeg",
    cacheControl: "31536000", // שם קובץ ייחודי → אפשר cache לשנה
    upsert: false,
  };
  const bucket = supabase.storage.from(PHOTOS_BUCKET);
  const [main, thumb] = await Promise.all([
    bucket.upload(storagePath, compressed.file, opts),
    bucket.upload(thumbPath, compressed.thumb, opts),
  ]);
  if (main.error || thumb.error) {
    await bucket.remove([storagePath, thumbPath]);
    throw new Error(`העלאה ל-Storage נכשלה: ${(main.error ?? thumb.error)!.message}`);
  }

  const { data: pub } = bucket.getPublicUrl(storagePath);
  const { data: thumbPub } = bucket.getPublicUrl(thumbPath);

  // (ד) DB
  onStage?.("saving");
  // lat/lng של ה-EXIF מוצאים החוצה — המיקום הסופי כבר חושב למעלה
  const { latitude: _exifLat, longitude: _exifLng, ...exifFields } = exif;

  const row: PhotoInsert = {
    ...exifFields,
    user_id: userId,
    title: meta.title?.trim() || null,
    description: meta.description?.trim() || null,
    storage_path: storagePath,
    photo_url: pub.publicUrl,
    thumb_url: thumbPub.publicUrl,
    latitude: lat,
    longitude: lng,
    is_manual_location: Boolean(meta.manualLocation),
    location_name: meta.location_name?.trim() || null,
    width: compressed.width,
    height: compressed.height,
    tags: meta.tags,
    is_private: meta.is_private,
  };

  const { data, error: dbErr } = await supabase.from("photos").insert(row).select().single();
  if (dbErr) {
    await bucket.remove([storagePath, thumbPath]);
    throw new Error(`שמירה ב-DB נכשלה: ${dbErr.message}`);
  }
  return data as Photo;
}
