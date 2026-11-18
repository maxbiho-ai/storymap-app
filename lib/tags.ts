/** אותו נרמול כמו ה-trigger ב-DB, כדי שה-UI יציג בדיוק מה שיישמר */
export function normalizeTag(raw: string): string {
  return raw.trim().replace(/^#+/, "").trim().toLowerCase();
}

export function parseTags(input: string): string[] {
  return Array.from(
    new Set(input.split(/[,\s]+/).map(normalizeTag).filter(Boolean)),
  );
}
