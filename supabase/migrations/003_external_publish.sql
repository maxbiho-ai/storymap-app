-- StoryMap: קליטת פוסטים מ-MaxBi Social Planner
-- סיכה = שורה בטבלת photos. פוסט עם כמה תמונות נשמר כסיכה אחת עם מערך תמונות.

ALTER TABLE photos
  -- טקסט הפוסט / הסיפור
  ADD COLUMN IF NOT EXISTS story TEXT,
  -- כל תמונות הסיכה לפי הסדר (photo_url = הראשונה, לתאימות לאחור)
  ADD COLUMN IF NOT EXISTS image_urls TEXT[] NOT NULL DEFAULT '{}',
  -- איפה הקבצים יושבים: Supabase Storage (העלאה מהאפליקציה) או Cloudflare R2 (פוסט חיצוני)
  ADD COLUMN IF NOT EXISTS storage_provider TEXT NOT NULL DEFAULT 'supabase'
    CHECK (storage_provider IN ('supabase', 'r2')),
  -- כל מפתחות האובייקטים ב-R2 (כולל thumbnails) לצורך מחיקה
  ADD COLUMN IF NOT EXISTS storage_keys TEXT[] NOT NULL DEFAULT '{}',
  -- מקור הסיכה: 'app' או 'maxbi-planner'
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'app',
  -- מזהה הפוסט במערכת החיצונית (אופציונלי) למניעת כפילויות בניסיון חוזר
  ADD COLUMN IF NOT EXISTS external_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_photos_source_external
  ON photos (source, external_id)
  WHERE external_id IS NOT NULL;
