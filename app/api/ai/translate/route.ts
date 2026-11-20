import { NextResponse } from "next/server";
import { getRequestUserId } from "@/lib/server/userAuth";
import { aiTranslate } from "@/lib/server/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_TEXTS = 50;
const MAX_LEN = 4000;

/**
 * POST /api/ai/translate  (Authorization: Bearer <supabase access token>)
 * Body: { texts: string[] }  →  { texts: string[], translated } (same order, English)
 * Never blocks an upload: on any failure the original texts come back.
 */
export async function POST(req: Request) {
  if (!(await getRequestUserId(req))) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as { texts?: unknown } | null;
  if (!body || !Array.isArray(body.texts) || body.texts.length > MAX_TEXTS) {
    return NextResponse.json({ error: `texts must be an array (max ${MAX_TEXTS})` }, { status: 400 });
  }
  const texts = body.texts.map((t) => (typeof t === "string" ? t.slice(0, MAX_LEN) : ""));
  return NextResponse.json(await aiTranslate(texts));
}
