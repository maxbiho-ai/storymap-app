import { NextResponse } from "next/server";
import { requireCreator } from "@/lib/server/creatorAccess";
import { aiFieldNotes } from "@/lib/server/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/ai/field-notes  (Authorization: Bearer <supabase access token>)
 * Body: { texts: string[] }  (the descriptions of an upload batch)
 * → { notes: { accessInfo, permitInfo }[] }  same order; empty when nothing is mentioned or the model is down.
 */
export async function POST(req: Request) {
  const access = await requireCreator(req);
  if (access instanceof NextResponse) return access;
  const body = (await req.json().catch(() => null)) as { texts?: unknown } | null;
  if (!body || !Array.isArray(body.texts) || body.texts.length > 50) {
    return NextResponse.json({ error: "texts must be an array (max 50)" }, { status: 400 });
  }
  const texts = body.texts.map((t) => (typeof t === "string" ? t.slice(0, 4000) : ""));
  const notes = await Promise.all(texts.map((t) => aiFieldNotes(t)));
  return NextResponse.json({ notes });
}
