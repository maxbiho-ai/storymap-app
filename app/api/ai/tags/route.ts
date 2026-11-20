import { NextResponse } from "next/server";
import { getRequestUserId } from "@/lib/server/userAuth";
import { aiTags, timeBasedTags } from "@/lib/server/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_IMAGE_B64 = 600_000; // ~450KB jpeg; the client sends the 480px thumbnail

/**
 * POST /api/ai/tags  (Authorization: Bearer <supabase access token>)
 * Body: { image (base64 jpeg), takenAt, lat, lng, locationName?, title? }
 * → { tags: string[], timeOfDay, ai: boolean }
 * Without GEMINI_API_KEY (or if the model fails) it still returns the time-based tag.
 */
export async function POST(req: Request) {
  if (!(await getRequestUserId(req))) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  if (typeof body.image === "string" && body.image.length > MAX_IMAGE_B64) {
    return NextResponse.json({ error: "Image too large: send the thumbnail" }, { status: 413 });
  }

  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

  const input = {
    imageB64: str(body.image),
    takenAt: str(body.takenAt),
    lat: num(body.lat),
    lng: num(body.lng),
    locationName: str(body.locationName),
    title: str(body.title),
  };
  try {
    const { tags, phase, ai } = await aiTags(input);
    return NextResponse.json({ tags, timeOfDay: phase, ai });
  } catch (err) {
    console.error("[api/ai/tags] fallback:", err);
    const { tags, phase } = timeBasedTags(input);
    return NextResponse.json({ tags, timeOfDay: phase, ai: false });
  }
}
