"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchAccess, NO_ACCESS, type CreatorAccess } from "@/lib/beta";

/** Upload access + quota of the signed-in user (refresh() after an upload / redeeming a code) */
export function useCreatorAccess(userId: string | null) {
  const [access, setAccess] = useState<CreatorAccess>(NO_ACCESS);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!userId) return NO_ACCESS;
    const a = await fetchAccess(userId).catch(() => NO_ACCESS);
    setAccess(a);
    return a;
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setAccess(NO_ACCESS);
      return;
    }
    let alive = true;
    refresh().finally(() => alive && setLoadedFor(userId));
    return () => {
      alive = false;
    };
  }, [userId, refresh]);

  /** Signed in, but the profile has not been read yet */
  const loading = userId != null && loadedFor !== userId;
  return { access, loading, refresh };
}
