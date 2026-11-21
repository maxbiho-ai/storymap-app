-- StoryMap v0.6.1: full-quality photos
-- Main images are now stored up to 3840px at JPEG quality 92 (or the original JPEG as is),
-- which can exceed the old 5MB bucket cap. Until this runs, the app falls back to fitting
-- uploads into 5MB at the same resolution.

UPDATE storage.buckets
SET file_size_limit = 26214400  -- 25MB
WHERE id = 'photos';
