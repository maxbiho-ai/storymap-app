import { NextResponse } from "next/server";
import { getRequestUserId } from "@/lib/server/userAuth";
import { geminiConfigured, geminiJson } from "@/lib/server/gemini";
import { canonicalCountry } from "@/lib/countries";
import { sanitizeTags } from "@/lib/server/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const LIGHT = ["sunrise", "sunset", "blue", "night"] as const;

/**
 * POST /api/ai/search-filter  (Authorization: Bearer <supabase access token>)
 * Body: { prompt: string (any language), knownTags?: string[] }
 * → { country: "Iceland" | null, tags: string[], lightPhase: "sunrise" | "sunset" | "blue" | "night" | null, keywords: string[] }
 */
export async function POST(req: Request) {
  if (!(await getRequestUserId(req))) return NextResponse.json({ error: "Sign in to use AI search" }, { status: 401 });
  if (!geminiConfigured()) return NextResponse.json({ error: "AI search is not configured on this server" }, { status: 503 });
  const body = (await req.json().catch(() => null)) as { prompt?: unknown; knownTags?: unknown } | null;
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim().slice(0, 400) : "";
  if (prompt.length < 2) return NextResponse.json({ error: "Type what you are looking for" }, { status: 400 });
  const known = Array.isArray(body?.knownTags) ? body!.knownTags.filter((t): t is string => typeof t === "string").slice(0, 80) : [];

  try {
    const out = await geminiJson<{ country?: unknown; tags?: unknown; lightPhase?: unknown; keywords?: unknown }>(
      [
        {
          text: [
            "You turn a photo-search request, written in ANY language, into structured filters for a travel photo map.",
            `Request: "${prompt}"`,
            known.length ? `Existing tags in the library (prefer these exact spellings when they fit): ${known.join(", ")}` : "",
            "",
            "Rules:",
            "- country: the English name of the country the request is scoped to (\"Iceland\", \"Italy\"), or an empty string if none. A region like the Dolomites maps to its country (Italy), and the region name goes to keywords.",
            "- tags: 0-4 English single-word lowercase tags for the subject (waterfall, mountains, glacier, beach, church, bridge...). No spaces, no #. Singular for things like waterfall.",
            "- lightPhase: one of sunrise, sunset, blue, night when the request asks for a time of day (golden hour = sunset unless it says morning/sunrise; blue hour = blue); else an empty string.",
            "- keywords: 0-3 English place-name words that are NOT a country and NOT already a tag (a town, a region, a landmark).",
            "- Never put the country, the light phase, or filler words like photos / pictures / all / find in tags or keywords.",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
      {
        type: "OBJECT",
        properties: {
          country: { type: "STRING" },
          tags: { type: "ARRAY", items: { type: "STRING" } },
          lightPhase: { type: "STRING" },
          keywords: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["country", "tags", "lightPhase", "keywords"],
      },
      15_000,
      20_000,
    );
    const country = typeof out.country === "string" ? canonicalCountry(out.country.trim()) : null;
    const tags = sanitizeTags(Array.isArray(out.tags) ? out.tags.filter((t): t is string => typeof t === "string") : [], 4);
    const phase = typeof out.lightPhase === "string" ? out.lightPhase.trim().toLowerCase() : "";
    const lightPhase = (LIGHT as readonly string[]).includes(phase) ? phase : null;
    const keywords = (Array.isArray(out.keywords) ? out.keywords : [])
      .filter((k): k is string => typeof k === "string")
      .map((k) => k.replace(/[^\p{L}\p{N}\s'-]/gu, " ").replace(/\s+/g, " ").trim())
      .filter((k) => k && !canonicalCountry(k))
      .slice(0, 3);
    return NextResponse.json({ country, tags, lightPhase, keywords });
  } catch (err) {
    console.error("[ai/search-filter]", err);
    return NextResponse.json({ error: "The AI did not answer in time. Try again." }, { status: 502 });
  }
}
