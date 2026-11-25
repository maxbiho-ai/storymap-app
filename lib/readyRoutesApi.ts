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

const adminError = (msg: string, verb: string) => {
  if (missingTable(msg)) return new Error("Run supabase/migrations/011_curated_routes.sql in Supabase first.");
  if (/row-level security|permission/i.test(msg)) return new Error(`Only StoryMap admins can ${verb} Ready Routes.`);
  if (/duplicate key|unique/i.test(msg)) return new Error("Another route already uses this link (slug). Pick a different one.");
  if (/slug_check|check constraint/i.test(msg)) return new Error("Check the fields: the slug may use only a-z, 0-9 and dashes; the title is required.");
  return new Error(msg);
};

/** Admin gallery: drafts included (RLS only returns them to admins) */
export async function listAllReadyRoutes(): Promise<CuratedRoute[]> {
  const { data, error } = await getSupabase().from("curated_routes").select(COLS).order("sort_order").order("created_at", { ascending: false }).limit(500);
  if (error) throw adminError(error.message, "list");
  return (data ?? []).map((r) => normalizeRoute(r as CuratedRoute));
}

/** Admin only: insert a new route (fails on a taken slug) */
export async function createReadyRoute(row: CuratedRouteInsert): Promise<CuratedRoute> {
  const { data, error } = await getSupabase().from("curated_routes").insert(row).select(COLS).single();
  if (error) throw adminError(error.message, "create");
  return normalizeRoute(data as CuratedRoute);
}

/** Admin only: update a route by id (slug may change) */
export async function updateReadyRoute(id: string, row: CuratedRouteInsert): Promise<CuratedRoute> {
  const { data, error } = await getSupabase()
    .from("curated_routes")
    .update({ ...row, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select(COLS)
    .maybeSingle();
  if (error) throw adminError(error.message, "edit");
  if (!data) throw new Error("Route not found, or you're not allowed to edit it.");
  return normalizeRoute(data as CuratedRoute);
}

/** Admin only: delete a route by id */
export async function deleteReadyRoute(id: string): Promise<void> {
  const { data, error } = await getSupabase().from("curated_routes").delete().eq("id", id).select("id");
  if (error) throw adminError(error.message, "delete");
  if (!data?.length) throw new Error("Nothing was deleted: the route is gone already, or you're not allowed to delete it.");
}

/** Slug used by a different route? */
export async function slugTakenByOther(slug: string, id?: string): Promise<boolean> {
  const { data } = await getSupabase().from("curated_routes").select("id").eq("slug", slug).maybeSingle();
  return Boolean(data && data.id !== id);
}
