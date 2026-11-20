import { getSupabase, PHOTOS_BUCKET } from "@/lib/supabase/client";
import type { ExtractedExif, Photo, PhotoInsert } from "@/types/photo";
import type { CompressedImage } from "@/lib/compress";

/** Final, resolved values for one photo (location, time, translated text...) */
export interface UploadFields {
  latitude: number;
  longitude: number;
  is_manual_location: boolean;
  taken_at: string | null;
  taken_tz: string | null;
  title: string | null;
  description: string | null;
  location_name: string | null;
  photographer_name: string | null;
  tags: string[];
  is_private: boolean;
}

/**
 * Steps (c)+(d): upload to Storage, then insert the DB row.
 * If the insert fails, the files are removed so nothing is left orphaned.
 */
export async function uploadPhoto(
  userId: string,
  compressed: CompressedImage,
  exif: ExtractedExif,
  fields: UploadFields,
): Promise<Photo> {
  const supabase = getSupabase();
  const bucket = supabase.storage.from(PHOTOS_BUCKET);

  // First folder = user_id (enforced by the storage policy)
  const id = crypto.randomUUID();
  const storagePath = `${userId}/${id}.jpg`;
  const thumbPath = `${userId}/${id}_thumb.jpg`;
  const opts = { contentType: "image/jpeg", cacheControl: "31536000", upsert: false };

  const [main, thumb] = await Promise.all([
    bucket.upload(storagePath, compressed.file, opts),
    bucket.upload(thumbPath, compressed.thumb, opts),
  ]);
  if (main.error || thumb.error) {
    await bucket.remove([storagePath, thumbPath]);
    throw new Error(`Storage upload failed: ${(main.error ?? thumb.error)!.message}`);
  }

  const row: PhotoInsert = {
    user_id: userId,
    storage_path: storagePath,
    photo_url: bucket.getPublicUrl(storagePath).data.publicUrl,
    thumb_url: bucket.getPublicUrl(thumbPath).data.publicUrl,
    width: compressed.width,
    height: compressed.height,
    camera_make: exif.camera_make,
    camera_model: exif.camera_model,
    lens: exif.lens,
    focal_length: exif.focal_length,
    aperture: exif.aperture,
    shutter_speed: exif.shutter_speed,
    iso: exif.iso,
    ...fields,
  };

  const { data, error } = await supabase.from("photos").insert(row).select().single();
  if (error) {
    await bucket.remove([storagePath, thumbPath]);
    throw new Error(`Saving to the database failed: ${error.message}`);
  }
  return data as Photo;
}
