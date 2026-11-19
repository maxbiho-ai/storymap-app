import "server-only";

/** משתני סביבה של צד השרת. זורק שגיאה ברורה אם משהו חסר */
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

export const serverEnv = {
  publishSecret: () => required("EXTERNAL_PUBLISH_SECRET"),
  /** id של הפרופיל ב-StoryMap שיהיה הבעלים של סיכות שמגיעות מה-Planner */
  publishUserId: () => required("EXTERNAL_PUBLISH_USER_ID"),

  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseServiceKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),

  r2AccountId: () => required("R2_ACCOUNT_ID"),
  r2AccessKeyId: () => required("R2_ACCESS_KEY_ID"),
  r2SecretAccessKey: () => required("R2_SECRET_ACCESS_KEY"),
  r2Bucket: () => process.env.R2_BUCKET || "storymap-photos",
  /** כתובת ציבורית של ה-bucket: דומיין מותאם או https://pub-xxxx.r2.dev */
  r2PublicUrl: () => required("R2_PUBLIC_URL").replace(/\/+$/, ""),

  /** אופציונלי: רשימת דומיינים מותרים להורדת תמונות, מופרדת בפסיקים */
  imageHostAllowlist: (): string[] =>
    (process.env.EXTERNAL_IMAGE_HOSTS ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
};
