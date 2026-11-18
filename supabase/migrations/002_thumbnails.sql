-- StoryMap — שלב המפה: תמונה ממוזערת לפינים ולגלריה
-- (Supabase Image Transformations זמין רק בתוכנית Pro, לכן מייצרים thumbnail בדפדפן בזמן ההעלאה)
ALTER TABLE photos ADD COLUMN IF NOT EXISTS thumb_url TEXT;
