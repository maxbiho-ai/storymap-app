-- StoryMap 012: keep the archive folder path out of the public place name, and record where a pin's GPS came from.
-- Run in Supabase Dashboard -> SQL Editor. Safe to re-run.
--
--   source_folder  the original local folder / subfolder path the archive importer read the photo from
--                  ("Trip 12 - טיול לאמסטרדם/day2 - Keukenhof - פארק הפרחים"). Admin debugging only: the app never
--                  selects it for public photo cards (see PUBLIC_PHOTO_COLUMNS in lib/pins.ts).
--   country        canonical English country name of the pin ("Netherlands"), when known.
--   gps_source     where latitude / longitude came from:
--                    exif               the photo's own EXIF GPS
--                    phone              a phone photo taken next to it (same folder, closest time)
--                    folder_exif_match  another camera photo of the same folder
--                    folder             Mapbox geocode of the folder name
--                    ai_geocoded        Gemini landmark geocode (EXIF GPS was missing or corrupted)
--                    manual             set by hand in the app
--                  NULL = imported before this migration (unknown).

ALTER TABLE photos
  ADD COLUMN IF NOT EXISTS source_folder TEXT,
  ADD COLUMN IF NOT EXISTS country       TEXT,
  ADD COLUMN IF NOT EXISTS gps_source    TEXT;

ALTER TABLE photos DROP CONSTRAINT IF EXISTS photos_gps_source_check;
ALTER TABLE photos ADD CONSTRAINT photos_gps_source_check
  CHECK (gps_source IS NULL OR gps_source IN ('exif', 'phone', 'folder_exif_match', 'folder', 'ai_geocoded', 'manual'));

ALTER TABLE photos DROP CONSTRAINT IF EXISTS photos_source_folder_len;
ALTER TABLE photos ADD CONSTRAINT photos_source_folder_len CHECK (source_folder IS NULL OR length(source_folder) <= 1000);

COMMENT ON COLUMN photos.source_folder IS 'Archive folder path the photo was imported from. Admin debugging only, never shown on public cards.';
COMMENT ON COLUMN photos.country IS 'Canonical English country name of the pin.';
COMMENT ON COLUMN photos.gps_source IS 'exif | phone | folder_exif_match | folder | ai_geocoded | manual (NULL = unknown, pre-012).';
