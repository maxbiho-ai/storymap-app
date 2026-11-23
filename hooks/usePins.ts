"use client";

import { useEffect, useRef, useState } from "react";
import { invalidatePins, loadPins, type Pin } from "@/lib/pins";
import type { DbFilters } from "@/hooks/usePhotoSearch";

/**
 * The global pin layer: lightweight rows for ALL photos matching the search filters, regardless of
 * the viewport or the sidebar's 500-photo limit. 250ms debounce, stale responses are dropped.
 */
export function usePins(filters: DbFilters) {
  const [pins, setPins] = useState<Pin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const reqId = useRef(0);
  const key = JSON.stringify([filters.query, filters.tags, filters.photographer, filters.area?.id ?? null]) + nonce;

  useEffect(() => {
    const id = ++reqId.current;
    setLoading(true);
    const timer = setTimeout(() => {
      loadPins(filters)
        .then((rows) => {
          if (id !== reqId.current) return;
          setPins(rows);
          setError(null);
        })
        .catch((e: unknown) => {
          if (id === reqId.current) setError(e instanceof Error ? e.message : "Could not load pins");
        })
        .finally(() => {
          if (id === reqId.current) setLoading(false);
        });
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  /** Reload (after an upload, login or logout) */
  const refresh = () => {
    invalidatePins();
    setNonce((n) => n + 1);
  };
  return { pins, loading, error, refresh };
}
