import { NextResponse } from "next/server";
import { userClient } from "@/lib/server/creatorAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

interface RequestRow {
  id: string;
  email: string;
  full_name: string | null;
  message: string | null;
}

async function withTimeout(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
}

/**
 * POST /api/request-access-notify  (Authorization: Bearer <supabase access token>)
 * Tells the admin about the caller's pending access request: email through Resend (RESEND_API_KEY + ADMIN_EMAIL)
 * and/or Telegram (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID). The text comes from the caller's own request row in the
 * database, never from the request body, and each request notifies once, so this endpoint cannot be used to spam.
 * Notification failures never fail the call: the request itself is already saved.
 */
export async function POST(req: Request) {
  const u = userClient(req);
  if (!u) return NextResponse.json({ ok: false, error: "Sign in required" }, { status: 401 });
  const { data: auth, error: authErr } = await u.client.auth.getUser(u.token);
  if (authErr || !auth.user) return NextResponse.json({ ok: false, error: "Sign in required" }, { status: 401 });

  const { data: row } = await u.client
    .from("access_requests")
    .select("id, email, full_name, message")
    .eq("user_id", auth.user.id)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<RequestRow>();
  if (!row) return NextResponse.json({ ok: true, notified: [] });

  // First call per request only
  const { data: first } = await u.client.rpc("mark_request_notified", { p_id: row.id });
  if (first !== true) return NextResponse.json({ ok: true, notified: [] });

  const site = (process.env.NEXT_PUBLIC_SITE_URL || "https://my-storymap.netlify.app").replace(/\/+$/, "");
  const name = row.full_name?.trim() || "(no name)";
  const msg = row.message?.trim() || "(no message)";
  const tasks: Promise<string>[] = [];

  const resendKey = process.env.RESEND_API_KEY;
  const adminEmail = process.env.ADMIN_EMAIL;
  if (resendKey && adminEmail) {
    tasks.push(
      withTimeout("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: process.env.RESEND_FROM || "StoryMap <onboarding@resend.dev>",
          to: [adminEmail],
          subject: `StoryMap: creator access request from ${name}`,
          html: `<p><b>${esc(name)}</b> (${esc(row.email)}) asked for creator access.</p><p>${esc(msg).replace(/\n/g, "<br>")}</p><p><a href="${esc(site)}">Open StoryMap → Admin Panel</a></p>`,
          text: `${name} (${row.email}) asked for creator access.\n\n${msg}\n\n${site}`,
        }),
      }).then((r) => (r.ok ? "email" : Promise.reject(new Error(`Resend ${r.status}`)))),
    );
  }

  const tgToken = process.env.TELEGRAM_BOT_TOKEN;
  const tgChat = process.env.TELEGRAM_CHAT_ID;
  if (tgToken && tgChat) {
    tasks.push(
      withTimeout(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: tgChat, text: `StoryMap access request\n${name} <${row.email}>\n${msg}\n${site}`, disable_web_page_preview: true }),
      }).then((r) => (r.ok ? "telegram" : Promise.reject(new Error(`Telegram ${r.status}`)))),
    );
  }

  const results = await Promise.allSettled(tasks);
  const notified: string[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") notified.push(r.value);
    else console.error("[request-access-notify]", r.reason instanceof Error ? r.reason.message : r.reason);
  }
  return NextResponse.json({ ok: true, notified });
}
