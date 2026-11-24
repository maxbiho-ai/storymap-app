import { NextResponse } from "next/server";
import { getRequestUserId } from "@/lib/server/userAuth";
import { aiTripRoute } from "@/lib/server/ai";
import { geminiConfigured } from "@/lib/server/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 50;

/**
 * POST /api/ai/trip-route  (Authorization: Bearer <supabase access token>)
 * Body: { prompt: string, date: "YYYY-MM-DD", near?: { latitude, longitude } }
 * → { title, startTime: "HH:MM", stops: { name, latitude, longitude, description, durationMinutes, logistics, transitMinutes, transitNote }[] }
 */
export async function POST(req: Request) {
  if (!(await getRequestUserId(req))) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (!geminiConfigured()) return NextResponse.json({ error: "The AI assistant is not configured on this server" }, { status: 503 });
  const body = (await req.json().catch(() => null)) as { prompt?: unknown; date?: unknown; near?: { latitude?: unknown; longitude?: unknown } } | null;
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  const date = typeof body?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : null;
  if (prompt.length < 3 || !date) return NextResponse.json({ error: "Describe the day you want and pick a date" }, { status: 400 });
  const lat = Number(body?.near?.latitude);
  const lng = Number(body?.near?.longitude);
  const near = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { latitude: lat, longitude: lng } : null;
  try {
    const route = await aiTripRoute({ prompt, date, near });
    if (!route.stops.length) return NextResponse.json({ error: "The assistant found no places for that request. Try naming the city." }, { status: 422 });
    return NextResponse.json(route);
  } catch (err) {
    console.error("[ai/trip-route]", err);
    return NextResponse.json({ error: "The AI assistant did not answer in time. Try again." }, { status: 502 });
  }
}
