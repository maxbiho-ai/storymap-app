-- StoryMap 013: the archive folder name (photos.source_folder) is visible ONLY to the photo's owner and to admins.
-- Run in Supabase Dashboard -> SQL Editor after 012. Safe to re-run. Changes no data (no names, no coordinates).
--
-- 1. anon / authenticated may read every photos column EXCEPT source_folder (column-level grants), so neither the app
--    nor a hand-written REST call with the public key can read it. The service role (import / fix scripts) is unaffected.
--    NOTE: a column added to photos later must be added to this GRANT list, or clients can't read it.
-- 2. photo_source_folders(ids) returns the folder name for the photos the caller owns, or for any photo when the caller
--    is an admin (public.app_is_admin, migration 010). Fallback when source_folder is empty: the folder part of source_key.

REVOKE SELECT ON photos FROM anon, authenticated;
GRANT SELECT (
  id, user_id, title, description, storage_path, photo_url, thumb_url, latitude, longitude, is_manual_location,
  location_name, taken_at, taken_tz, camera_make, camera_model, lens, focal_length, aperture, shutter_speed, iso,
  width, height, tags, is_private, photographer_name, created_at, story, image_urls, storage_provider, storage_keys,
  source, external_id, access_info, source_key, permit_info, country, gps_source
) ON photos TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.photo_source_folders(ids UUID[])
RETURNS TABLE (id UUID, folder TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id,
         COALESCE(NULLIF(p.source_folder, ''), NULLIF(regexp_replace(p.source_key, '/[^/]*$', ''), p.source_key)) AS folder
    FROM photos p
   WHERE p.id = ANY (ids[1:200])
     AND auth.uid() IS NOT NULL
     AND (p.user_id = auth.uid() OR public.app_is_admin(auth.uid()))
$$;

REVOKE ALL ON FUNCTION public.photo_source_folders(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.photo_source_folders(UUID[]) TO authenticated;
