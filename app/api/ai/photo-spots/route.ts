import { NextResponse } from "next/server";
import { getRequestUserId } from "@/lib/server/userAuth";
import { aiPhotoSpots } from "@/lib/server/ai";
import { geminiConfigured } from "@/lib/server/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/ai/photo-spots  (Authorization: Bearer <supabase access token>)
 * Body: { date: "YYYY-MM-DD", stops: { name, latitude, longitude }[] }  (one day of a planned trip)
 * → { spots: { name, latitude, longitude, phase: "sunrise" | "sunset" | "midday", reason }[] }
 */
export async function POST(req: Request) {
  if (!(await getRequestUserId(req))) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  if (!geminiConfigured()) {
    return NextResponse.json({ error: "AI suggestions are not configured on this server" }, { status: 503 });
  }
  const body = (await req.json().catch(() => null)) as { date?: unknown; stops?: unknown } | null;
  const date = typeof body?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : null;
  if (!body || !date || !Array.isArray(body.stops) || body.stops.length < 1 || body.stops.length > 12) {
    return NextResponse.json({ error: "date and 1-12 stops are required" }, { status: 400 });
  }
  const stops = body.stops
    .map((s) => s as { name?: unknown; latitude?: unknown; longitude?: unknown })
    .map((s) => ({ name: typeof s.name === "string" ? s.name.slice(0, 120) : "", latitude: Number(s.latitude), longitude: Number(s.longitude) }))
    .filter((s) => s.name && Number.isFinite(s.latitude) && Number.isFinite(s.longitude) && Math.abs(s.latitude) <= 90 && Math.abs(s.longitude) <= 180);
  if (!stops.length) return NextResponse.json({ error: "No valid stops" }, { status: 400 });

  const spots = await aiPhotoSpots({ date, stops });
  return NextResponse.json({ spots });
}
