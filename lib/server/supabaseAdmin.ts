import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "./env";

let admin: SupabaseClient | null = null;

/**
 * Client עם service role: עוקף RLS. רק בצד השרת, לעולם לא לייבא מקומפוננטת לקוח.
 * (ה-import של server-only יגרום לשגיאת build אם זה יקרה.)
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (admin) return admin;
  admin = createClient(serverEnv.supabaseUrl(), serverEnv.supabaseServiceKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}
