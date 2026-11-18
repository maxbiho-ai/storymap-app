"use client";

import { useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import type { Photo, PhotoFilters } from "@/types/photo";

const MAX_RESULTS = 500;

/** מנקה תווים שבירים לפילטר or() של PostgREST ו-wildcards של ILIKE */
function escapeForOr(s: string): string {
  return s.replace(/[%_\\]/g, (c) => `\\${c}`).replace(/[,()"]/g, " ").trim();
}

/**
 * מביא תמונות לפי הסינון. RLS דואג שרק תמונות ציבוריות + שלי יחזרו.
 * - tags: contains → התמונה חייבת להכיל את *כל* התגיות שנבחרו
 * - query: ILIKE על location_name / title / tags (התאמה מדויקת לתגית)
 * - bounds: מגביל לאזור הנראה במפה
 * debounce של 300ms + ביטול תוצאות ישנות (race condition).
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

      const text = escapeForOr(filters.query);
      if (text) {
        const tagGuess = text.replace(/^#/, "").toLowerCase().replace(/\s+/g, "");
        q = q.or(
          [
            `location_name.ilike.%${text}%`,
            `title.ilike.%${text}%`,
            tagGuess && `tags.cs.{${tagGuess}}`,
          ].filter(Boolean).join(","),
        );
      }

      if (filters.bounds) {
        const { north, south, east, west } = filters.bounds;
        q = q.gte("latitude", south).lte("latitude", north);
        // מפה שחוצה את קו התאריך (west > east)
        q = west <= east
          ? q.gte("longitude", west).lte("longitude", east)
          : q.or(`longitude.gte.${west},longitude.lte.${east}`);
      }

      const { data, error } = await q;
      if (id !== reqId.current) return; // הגיעה בקשה חדשה יותר
      if (error) setError(error.message);
      else setPhotos((data ?? []) as Photo[]);
      setLoading(false);
    }, 300);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  /** טעינה מחדש (למשל אחרי העלאה) */
  const refresh = () => setNonce((n) => n + 1);

  return { photos, loading, error, refresh };
}

/** תגיות פופולריות להשלמה אוטומטית (מה-view popular_tags) */
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
