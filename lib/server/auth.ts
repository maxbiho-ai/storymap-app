import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { serverEnv } from "./env";

/**
 * בודק Authorization: Bearer <EXTERNAL_PUBLISH_SECRET>.
 * השוואה ב-constant time (על hash, כדי שגם אורך שונה לא ידלוף).
 */
export function isAuthorized(req: Request): boolean {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return false;

  let secret: string;
  try {
    secret = serverEnv.publishSecret();
  } catch {
    return false; // סוד לא מוגדר בשרת: אף בקשה לא עוברת
  }
  const a = createHash("sha256").update(match[1]).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}
