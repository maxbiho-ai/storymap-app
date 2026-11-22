-- StoryMap 007 (v0.8.0): photographer field notes
-- Run in Supabase Dashboard -> SQL Editor. Safe to re-run.
-- Owners edit them with the existing "Users can update their own photos" RLS policy.

ALTER TABLE photos
  -- Parking & access: where to park, walking distance, trail / road notes
  ADD COLUMN IF NOT EXISTS access_info TEXT,
  -- Permit / drone / ticket: entry fees, permits, drone rules
  ADD COLUMN IF NOT EXISTS permit_info TEXT;

ALTER TABLE photos DROP CONSTRAINT IF EXISTS photos_access_info_len;
ALTER TABLE photos ADD CONSTRAINT photos_access_info_len CHECK (access_info IS NULL OR length(access_info) <= 600);
ALTER TABLE photos DROP CONSTRAINT IF EXISTS photos_permit_info_len;
ALTER TABLE photos ADD CONSTRAINT photos_permit_info_len CHECK (permit_info IS NULL OR length(permit_info) <= 600);
