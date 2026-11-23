"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import type { Photo } from "@/types/photo";

const cache = new Map<string, Photo>();
const inflight = new Set<string>();
const CHUNK = 80;

/**
 * Full photo rows for the pins whose card is open (carousel). The map itself only holds lightweight
 * pins; this fetches `*` on demand and caches it. Returns the loaded photos in the order of `ids`.
 */
export function useFullPhotos(ids: string[]): Photo[] {
  const [tick, setTick] = useState(0);
  const key = ids.join(",");

  useEffect(() => {
    const missing = ids.filter((id) => !cache.has(id) && !inflight.has(id));
    if (!missing.length) return;
    let alive = true;
    for (let i = 0; i < missing.length; i += CHUNK) {
      const chunk = missing.slice(i, i + CHUNK);
      chunk.forEach((id) => inflight.add(id));
      getSupabase()
        .from("photos")
        .select("*")
        .in("id", chunk)
        .then(({ data }) => {
          chunk.forEach((id) => inflight.delete(id));
          for (const p of (data ?? []) as Photo[]) cache.set(p.id, p);
          if (alive) setTick((t) => t + 1);
        });
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => ids.map((id) => cache.get(id)).filter((p): p is Photo => Boolean(p)), [key, tick]);
}
