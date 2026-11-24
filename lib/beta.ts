"use client";

import { getSupabase } from "@/lib/supabase/client";

/** What the signed-in user may do. quota null = unlimited (the DB stores NULL or -1) */
export interface CreatorAccess {
  isAdmin: boolean;
  canUpload: boolean;
  quota: number | null;
  used: number;
}

export const NO_ACCESS: CreatorAccess = { isAdmin: false, canUpload: false, quota: 15, used: 0 };
export const isUnlimited = (quota: number | null | undefined) => quota == null || quota < 0;
/** Photos still allowed (Infinity when unlimited, 0 without upload access) */
export const photosLeft = (a: CreatorAccess) =>
  a.isAdmin || (a.canUpload && isUnlimited(a.quota)) ? Infinity : a.canUpload ? Math.max(0, (a.quota ?? 0) - a.used) : 0;
export const mayUpload = (a: CreatorAccess) => photosLeft(a) > 0;
export const quotaLabel = (a: CreatorAccess) =>
  a.isAdmin || isUnlimited(a.quota) ? `${a.isAdmin ? "Admin" : "Beta Creator"}: Unlimited` : `Beta Creator: ${a.used} / ${a.quota} photos used`;

export async function fetchAccess(userId: string): Promise<CreatorAccess> {
  const db = getSupabase();
  const [{ data: p }, { count }] = await Promise.all([
    db.from("profiles").select("is_admin, can_upload, photo_quota").eq("id", userId).maybeSingle(),
    db.from("photos").select("id", { count: "exact", head: true }).eq("user_id", userId),
  ]);
  if (!p) return NO_ACCESS;
  return {
    isAdmin: Boolean(p.is_admin),
    canUpload: Boolean(p.can_upload),
    quota: isUnlimited(p.photo_quota as number | null) ? null : (p.photo_quota as number),
    used: count ?? 0,
  };
}

/** Validates the code on the server: grants upload access and quota, burns one use */
export async function redeemInviteCode(code: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await getSupabase().rpc("redeem_invite_code", { p_code: code });
  if (error) return { ok: false, error: error.message };
  const r = data as { ok: boolean; error?: string };
  return r.ok ? { ok: true } : { ok: false, error: r.error ?? "Invalid invite code" };
}

export async function hasPendingRequest(userId: string): Promise<boolean> {
  const { data } = await getSupabase().from("access_requests").select("id").eq("user_id", userId).eq("status", "pending").limit(1);
  return Boolean(data?.length);
}

/** Saves the request, then pings the admin. A failed notification never fails the request. */
export async function submitAccessRequest(input: { userId: string; email: string; fullName: string; message: string }): Promise<void> {
  const db = getSupabase();
  const { error } = await db.from("access_requests").insert({
    user_id: input.userId,
    email: input.email,
    full_name: input.fullName.trim() || null,
    message: input.message.trim().slice(0, 500) || null,
  });
  if (error) {
    if (error.code === "23505") throw new Error("You already have a pending request. We will get back to you soon.");
    throw new Error(error.message);
  }
  try {
    const { data } = await db.auth.getSession();
    const token = data.session?.access_token;
    if (token) await fetch("/api/request-access-notify", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  } catch {
    /* saved already; the admin sees it in the panel */
  }
}
