/**
 * Every photos column a browser client may read. Use this instead of select("*") / .select(): source_folder (the
 * archive importer's local folder name) is readable only by the owner / admins through the photo_source_folders RPC
 * (migration 013), so a select("*") with the public key fails with "permission denied".
 * Keep in sync with the GRANT list in supabase/migrations/013_source_folder_owner_only.sql.
 */
export const PUBLIC_PHOTO_COLUMNS =
  "id, user_id, title, description, storage_path, photo_url, thumb_url, latitude, longitude, is_manual_location, location_name, " +
  "taken_at, taken_tz, camera_make, camera_model, lens, focal_length, aperture, shutter_speed, iso, width, height, tags, is_private, " +
  "photographer_name, created_at, story, image_urls, storage_provider, storage_keys, source, external_id, access_info, source_key, permit_info, " +
  "country, gps_source";
