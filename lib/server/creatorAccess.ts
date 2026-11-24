import "server-only";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export interface CreatorAccess {
  userId: string;
  client: ReturnType<typeof createClient>;
}

/** A Supabase client acting as the caller (their JWT), so RLS applies: no service-role key needed for the checks */
export function userClient(req: Request) {
  const token = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization")?.trim() ?? "")?.[1];
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!token || !url || !anon) return null;
  return {
    token,
    client: createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    }),
  };
}

const deny = (status: number, error: string, code: string) => NextResponse.json({ error, code }, { status });

/**
 * Gate for the upload-only endpoints (Gemini tagging / translation, i.e. everything an upload triggers):
 * 401 when signed out, 403 unless the caller is an admin, or has can_upload and photos left in their quota
 * (photo_quota NULL or -1 = unlimited). Returns the user id, or the response to send back.
 */
export async function requireCreator(req: Request): Promise<{ userId: string } | NextResponse> {
  const u = userClient(req);
  if (!u) return deny(401, "Sign in required", "unauthenticated");
  const { data: auth, error: authErr } = await u.client.auth.getUser(u.token);
  if (authErr || !auth.user) return deny(401, "Sign in required", "unauthenticated");
  const userId = auth.user.id;

  const { data: profile } = await u.client
    .from("profiles")
    .select("is_admin, can_upload, photo_quota")
    .eq("id", userId)
    .maybeSingle<{ is_admin: boolean; can_upload: boolean; photo_quota: number | null }>();
  if (!profile) return deny(403, "Profile not found", "forbidden");
  if (profile.is_admin) return { userId };
  if (!profile.can_upload) return deny(403, "Uploading is invite-only during the beta", "not_creator");

  const unlimited = profile.photo_quota == null || profile.photo_quota < 0;
  if (!unlimited) {
    const { count, error } = await u.client.from("photos").select("id", { count: "exact", head: true }).eq("user_id", userId);
    if (error) return deny(500, "Could not check your quota", "error");
    if ((count ?? 0) >= profile.photo_quota!) return deny(403, `Photo quota reached (${profile.photo_quota})`, "quota_exceeded");
  }
  return { userId };
}
