import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://my-storymap.netlify.app").replace(/\/+$/, "");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/**
 * GET /api/routes: the published 🗺️ Ready Routes, for Content Lab's route picker (Comment-to-DM automation).
 * [{ id, slug, title, country, days, stops_count, cover_url, url }]. Public data only: read with the anon key under RLS.
 * Optional: ?country=Iceland
 */
export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return NextResponse.json({ error: "Not configured" }, { status: 500, headers: CORS });
  const country = new URL(req.url).searchParams.get("country")?.trim();

  const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  let q = sb.from("curated_routes").select("id, slug, title, country, days, stops_count, cover_url").eq("published", true).order("sort_order").order("created_at", { ascending: false }).limit(500);
  if (country) q = q.ilike("country", country.replace(/[%_\\]/g, (c) => `\\${c}`));
  const { data, error } = await q;
  if (error) {
    console.error("[api/routes]", error.message);
    return NextResponse.json({ error: "Could not load routes" }, { status: 500, headers: CORS });
  }
  const routes = (data ?? []).map((r) => ({
    id: r.id as string,
    slug: r.slug as string,
    title: r.title as string,
    country: (r.country as string | null) ?? null,
    days: r.days as number,
    stops_count: r.stops_count as number,
    cover_url: (r.cover_url as string | null) ?? null,
    url: `${SITE}/?route=${encodeURIComponent(r.slug as string)}`,
  }));
  return NextResponse.json(routes, { headers: { ...CORS, "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" } });
}
