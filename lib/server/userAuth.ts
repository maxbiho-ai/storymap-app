import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Verifies the Supabase access token sent by the browser (Authorization: Bearer <jwt>).
 * Keeps the AI routes for signed-in users only, so the Gemini key can't be abused.
 */
export async function getRequestUserId(req: Request): Promise<string | null> {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization")?.trim() ?? "");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!m || !url || !anon) return null;
  const supabase = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.auth.getUser(m[1]);
  return error || !data.user ? null : data.user.id;
}
