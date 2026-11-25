"use client";

import { getSupabase } from "@/lib/supabase/client";
import { normalizeRoute, type CuratedRoute, type CuratedRouteInsert } from "@/lib/readyRoutes";

const COLS = "id, slug, title, country, description, days, stops_count, cover_url, plan, tips, published, sort_order, created_at";

const missingTable = (msg: string) => /curated_routes|relation .* does not exist|schema cache/i.test(msg);

export async function listReadyRoutes(): Promise<CuratedRoute[]> {
  const { data, error } = await getSupabase().from("curated_routes").select(COLS).eq("published", true).order("sort_order").order("created_at", { ascending: false }).limit(200);
  if (error) {
    if (missingTable(error.message)) throw new Error("Ready Routes isn't set up yet (run supabase/migrations/011_curated_routes.sql).");
    throw new Error(error.message);
  }
  return (data ?? []).map((r) => normalizeRoute(r as CuratedRoute));
}

export async function getReadyRoute(slug: string): Promise<CuratedRoute | null> {
  const { data, error } = await getSupabase().from("curated_routes").select(COLS).eq("slug", slug).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? normalizeRoute(data as CuratedRoute) : null;
}

/** Admin only (RLS): insert, or overwrite the route with the same slug */
export async function publishReadyRoute(row: CuratedRouteInsert): Promise<CuratedRoute> {
  const { data, error } = await getSupabase()
    .from("curated_routes")
    .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "slug" })
    .select(COLS)
    .single();
  if (error) {
    if (missingTable(error.message)) throw new Error("Run supabase/migrations/011_curated_routes.sql in Supabase first.");
    if (/row-level security|permission/i.test(error.message)) throw new Error("Only StoryMap admins can publish Ready Routes.");
    throw new Error(error.message);
  }
  return normalizeRoute(data as CuratedRoute);
}

export async function slugTaken(slug: string): Promise<boolean> {
  const { data } = await getSupabase().from("curated_routes").select("id").eq("slug", slug).maybeSingle();
  return Boolean(data);
}
