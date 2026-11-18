-- =====================================================================
-- StoryMap MVP — Supabase schema
-- הרצה: Supabase Dashboard → SQL Editor → להדביק הכל → Run
-- =====================================================================

-- הרחבה לחיפוש טקסט חלקי ומהיר (ILIKE '%sun%') על שמות מיקומים וכותרות
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------
-- 1. פרופילי משתמשים
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profiles (
  id          UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  username    TEXT UNIQUE NOT NULL,
  full_name   TEXT,
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profiles are viewable by everyone"
  ON profiles FOR SELECT USING (TRUE);

CREATE POLICY "Users can update their own profile"
  ON profiles FOR UPDATE USING (auth.uid() = id);

-- יצירת פרופיל אוטומטית בהרשמה.
-- בלי זה, INSERT ל-photos ייכשל (user_id מצביע על profiles).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, username, full_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'username',
      split_part(NEW.email, '@', 1) || '_' || substr(NEW.id::text, 1, 6)
    ),
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ---------------------------------------------------------------------
-- 2. תמונות ומיקומים
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS photos (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  title         TEXT,
  description   TEXT,
  storage_path  TEXT NOT NULL,
  photo_url     TEXT NOT NULL,

  -- קואורדינטות גיאוגרפיות
  latitude            DOUBLE PRECISION NOT NULL CHECK (latitude  BETWEEN -90  AND 90),
  longitude           DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  is_manual_location  BOOLEAN DEFAULT FALSE,
  -- חדש: שם מיקום טקסטואלי — נדרש לחיפוש "לפי שמות מיקומים"
  location_name       TEXT,

  -- נתוני EXIF
  taken_at       TIMESTAMPTZ,
  camera_make    TEXT,
  camera_model   TEXT,
  lens           TEXT,
  focal_length   NUMERIC,
  aperture       NUMERIC,
  shutter_speed  TEXT,
  iso            INT,

  -- חדש: מידות הקובץ אחרי כיווץ (שימושי לתצוגה/placeholder)
  width          INT,
  height         INT,

  -- תגיות ופרטיות
  tags        TEXT[] DEFAULT '{}',
  is_private  BOOLEAN DEFAULT FALSE,

  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- אינדקסים
CREATE INDEX IF NOT EXISTS idx_photos_location      ON photos (latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_photos_tags          ON photos USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_photos_user          ON photos (user_id);
CREATE INDEX IF NOT EXISTS idx_photos_taken_at      ON photos (taken_at DESC);
CREATE INDEX IF NOT EXISTS idx_photos_location_trgm ON photos USING GIN (location_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_photos_title_trgm    ON photos USING GIN (title gin_trgm_ops);

-- נרמול תגיות: lowercase, בלי '#', בלי רווחים מיותרים, בלי כפילויות.
-- כך "Sunrise", "#sunrise" ו-" sunrise " הן אותה תגית בחיפוש.
CREATE OR REPLACE FUNCTION public.normalize_photo_tags()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.tags := COALESCE(
    (SELECT array_agg(DISTINCT t ORDER BY t)
       FROM (SELECT lower(trim(both ' #' FROM x)) AS t FROM unnest(NEW.tags) AS x) s
      WHERE t <> ''),
    '{}'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_photo_tags ON photos;
CREATE TRIGGER trg_normalize_photo_tags
  BEFORE INSERT OR UPDATE OF tags ON photos
  FOR EACH ROW EXECUTE FUNCTION public.normalize_photo_tags();

-- ---------------------------------------------------------------------
-- 3. RLS לטבלת photos
-- ---------------------------------------------------------------------
ALTER TABLE photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public photos are viewable by everyone"
  ON photos FOR SELECT
  USING (is_private = FALSE OR auth.uid() = user_id);

CREATE POLICY "Users can insert their own photos"
  ON photos FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own photos"
  ON photos FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);   -- מונע העברת תמונה למשתמש אחר

CREATE POLICY "Users can delete their own photos"
  ON photos FOR DELETE
  USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- 4. Storage bucket + policies
-- נתיב הקבצים: photos/{user_id}/{uuid}.jpg
-- ---------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('photos', 'photos', TRUE, 5242880, ARRAY['image/jpeg'])  -- 5MB תקרה
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Anyone can read photo files"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'photos');

CREATE POLICY "Users upload into their own folder"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'photos' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users delete their own files"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'photos' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------
-- 5. View לרשימת תגיות פופולריות (להשלמה אוטומטית בסרגל החיפוש)
-- security_invoker = RLS של photos חל גם כאן — תגיות של תמונות פרטיות לא דולפות
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW popular_tags
WITH (security_invoker = TRUE) AS
SELECT tag, COUNT(*)::INT AS photo_count
FROM photos, unnest(tags) AS tag
GROUP BY tag
ORDER BY photo_count DESC;
