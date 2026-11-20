"use client";

import { useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import type { Photo, PhotoFilters } from "@/types/photo";

const MAX_RESULTS = 500;

/** Escapes ILIKE wildcards */
export function escapeLike(s: string): string {
  return s.replace(/[%_\\]/g, (c) => `\\${c}`);
}

/** Also strips characters that break PostgREST's or() syntax */
function escapeForOr(s: string): string {
  return escapeLike(s).replace(/[,()"]/g, " ").trim();
}

/**
 * Loads photos for the current filters. RLS returns only public photos + my own.
 * - query:        location name / title (partial, case-insensitive) or an exact tag
 * - tags:         contains → the photo must have *all* selected tags
 * - photographer: exact name, case-insensitive
 * - bounds:       the visible map area
 * 300ms debounce, and stale responses are dropped.
 */
export function usePhotoSearch(filters: PhotoFilters) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const reqId = useRef(0);

  const key = JSON.stringify(filters) + nonce;

  useEffect(() => {
    const id = ++reqId.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);

      let q = getSupabase()
        .from("photos")
        .select("*")
        .order("taken_at", { ascending: false, nullsFirst: false })
        .limit(MAX_RESULTS);

      if (filters.tags.length) q = q.contains("tags", filters.tags);
      if (filters.photographer) q = q.ilike("photographer_name", escapeLike(filters.photographer.trim()));

      const text = escapeForOr(filters.query);
      if (text) {
        const tagGuess = text.toLowerCase().replace(/\s+/g, "");
        q = q.or(
          [`location_name.ilike.%${text}%`, `title.ilike.%${text}%`, tagGuess && `tags.cs.{${tagGuess}}`]
            .filter(Boolean)
            .join(","),
        );
      }

      if (filters.bounds) {
        const { north, south, east, west } = filters.bounds;
        q = q.gte("latitude", south).lte("latitude", north);
        // Map crossing the date line (west > east)
        q = west <= east
          ? q.gte("longitude", west).lte("longitude", east)
          : q.or(`longitude.gte.${west},longitude.lte.${east}`);
      }

      const { data, error } = await q;
      if (id !== reqId.current) return; // a newer request is on its way
      if (error) setError(error.message);
      else setPhotos((data ?? []) as Photo[]);
      setLoading(false);
    }, 300);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  /** Reload (e.g. after an upload) */
  const refresh = () => setNonce((n) => n + 1);

  return { photos, loading, error, refresh };
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
