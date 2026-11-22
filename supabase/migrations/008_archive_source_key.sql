-- StoryMap v0.9: remember which archive photo a pin came from.
-- scripts/import-trip.ts stores the canonical key "<trip-folder>/<subfolder>/<dsc_2366>" (lowercase,
-- edit suffixes such as -2 / -3 / -Edit stripped) so re-importing a re-edited photo updates the same
-- pin's image files in place, keeping its likes, comments and any manual location edits.
ALTER TABLE photos
  ADD COLUMN IF NOT EXISTS source_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_photos_owner_source_key
  ON photos (user_id, source_key)
  WHERE source_key IS NOT NULL;
