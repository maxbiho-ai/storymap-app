"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import type { PhotoFilters } from "@/types/photo";

/** Escapes ILIKE wildcards */
export function escapeLike(s: string): string {
  return s.replace(/[%_\\]/g, (c) => `\\${c}`);
}

/** Also strips characters that break PostgREST's or() syntax */
function escapeForOr(s: string): string {
  return escapeLike(s).replace(/[,()"]/g, " ").trim();
}

/** The filters that run in the database (the rest: country, spot, gear: apply to the loaded pins) */
export type DbFilters = Pick<PhotoFilters, "query" | "tags" | "photographer" | "area">;

/**
 * Applies the search filters to a `photos` query. RLS returns only public photos + my own.
 * - query:        location name / title (partial, case-insensitive) or an exact tag
 * - tags:         contains → the photo must have *all* selected tags
 * - photographer: exact name, case-insensitive
 * - area:         a geocoded place (country / region / city): pins inside its bbox
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyPhotoFilters<Q extends Record<string, any>>(q: Q, filters: DbFilters): Q {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let out: any = q;
  if (filters.tags.length) out = out.contains("tags", filters.tags);
  if (filters.photographer) out = out.ilike("photographer_name", escapeLike(filters.photographer.trim()));

  const text = escapeForOr(filters.query);
  if (text) {
    const tagGuess = text.toLowerCase().replace(/\s+/g, "");
    out = out.or(
      [`location_name.ilike.%${text}%`, `title.ilike.%${text}%`, tagGuess && `tags.cs.{${tagGuess}}`]
        .filter(Boolean)
        .join(","),
    );
  }

  if (filters.area) {
    const [west, south, east, north] = filters.area.bbox;
    out = out.gte("latitude", south).lte("latitude", north);
    // Area crossing the date line (west > east)
    out = west <= east ? out.gte("longitude", west).lte("longitude", east) : out.or(`longitude.gte.${west},longitude.lte.${east}`);
  }
  return out as Q;
}

/** Popular tags for autocomplete (view popular_tags) */
export function usePopularTags(limit = 30) {
  const [tags, setTags] = useState<{ tag: string; photo_count: number }[]>([]);
  useEffect(() => {
    getSupabase()
      .from("popular_tags")
      .select("tag, photo_count")
      .limit(limit)
      .then(({ data }) => setTags(data ?? []));
  }, [limit]);
  return tags;
}

/** Photographers for "@" autocomplete (view popular_photographers) */
export function usePopularPhotographers(limit = 30) {
  const [people, setPeople] = useState<{ name: string; photo_count: number }[]>([]);
  useEffect(() => {
    getSupabase()
      .from("popular_photographers")
      .select("name, photo_count")
      .limit(limit)
      .then(({ data }) => setPeople(data ?? []));
  }, [limit]);
  return people;
}
