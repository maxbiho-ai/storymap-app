-- StoryMap 004: photographer name, capture timezone, photographer search
-- Run in Supabase Dashboard -> SQL Editor.

ALTER TABLE photos
  -- Photographer's display name (defaults to the uploader's profile full_name, editable on upload)
  ADD COLUMN IF NOT EXISTS photographer_name TEXT,
  -- IANA timezone of the capture location (e.g. Europe/Berlin), used to show local capture time
  ADD COLUMN IF NOT EXISTS taken_tz TEXT;

-- Backfill existing photos from the owner's profile
UPDATE photos p
SET photographer_name = pr.full_name
FROM profiles pr
WHERE p.photographer_name IS NULL
  AND pr.id = p.user_id
  AND pr.full_name IS NOT NULL
  AND pr.full_name <> '';

-- Fast case-insensitive exact match (@Max Bihovskiy) and partial match (autocomplete)
CREATE INDEX IF NOT EXISTS idx_photos_photographer_lower ON photos (lower(photographer_name));
CREATE INDEX IF NOT EXISTS idx_photos_photographer_trgm ON photos USING GIN (photographer_name gin_trgm_ops);

-- Photographer suggestions for "@" in the search bar.
-- security_invoker = photos RLS applies (private photos don't leak names)
CREATE OR REPLACE VIEW popular_photographers
WITH (security_invoker = TRUE) AS
SELECT photographer_name AS name, COUNT(*)::INT AS photo_count
FROM photos
WHERE photographer_name IS NOT NULL AND photographer_name <> ''
GROUP BY photographer_name
ORDER BY photo_count DESC;
