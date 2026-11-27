"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";

/** photo id → original archive folder name (null = none / not allowed), per signed-in user */
const cache = new Map<string, string | null>();
let cacheUser: string | null = null;

/**
 * The photo's original folder name (photos.source_folder, or the folder part of source_key), for its owner or an admin
 * only. The photo_source_folders RPC (migration 013) enforces that server-side; `enabled` just skips the call for
 * everyone else. Returns null while loading, when there is none, or when the viewer may not see it.
 */
export function useSourceFolder(photoId: string, userId: string | null, enabled: boolean): string | null {
  if (cacheUser !== userId) {
    cache.clear();
    cacheUser = userId;
  }
  const [folder, setFolder] = useState<string | null>(() => (enabled ? cache.get(photoId) ?? null : null));

  useEffect(() => {
    if (!enabled || !userId) {
      setFolder(null);
      return;
    }
    if (cache.has(photoId)) {
      setFolder(cache.get(photoId)!);
      return;
    }
    let alive = true;
    setFolder(null);
    getSupabase()
      .rpc("photo_source_folders", { ids: [photoId] })
      .then(({ data, error }) => {
        if (error) {
          console.warn("[source folder]", error.message);
          return;
        }
        const row = ((data ?? []) as { id: string; folder: string | null }[]).find((r) => r.id === photoId);
        cache.set(photoId, row?.folder ?? null);
        if (alive) setFolder(row?.folder ?? null);
      });
    return () => {
      alive = false;
    };
  }, [photoId, userId, enabled]);

  return enabled ? folder : null;
}
