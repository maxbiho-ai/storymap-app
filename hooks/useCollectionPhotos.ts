"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import type { Photo } from "@/types/photo";

/**
 * Photos of one of my saved lists, in list order (the order they were saved).
 * `version` reloads after a save / unsave anywhere in the app.
 */
export function useCollectionPhotos(collectionId: string | null, version: number) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!collectionId) {
      setPhotos([]);
      return;
    }
    let alive = true;
    setLoading(true);
    getSupabase()
      .from("collection_items")
      .select("sort_order, created_at, photo:photos(*)")
      .eq("collection_id", collectionId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true })
      .then(({ data, error }) => {
        if (!alive) return;
        setLoading(false);
        if (error) return setError(error.message);
        setError(null);
        // A photo that became private (or was deleted) comes back as null: skip it
        const rows = (data ?? []) as unknown as { photo: Photo | Photo[] | null }[];
        setPhotos(rows.map((r) => (Array.isArray(r.photo) ? r.photo[0] : r.photo)).filter((p): p is Photo => Boolean(p)));
      });
    return () => {
      alive = false;
    };
  }, [collectionId, version]);

  return { photos, loading, error };
}

/** Google Maps directions through the pins (URL API: origin + up to 9 waypoints + destination) */
export const GOOGLE_MAPS_MAX_STOPS = 11;
export function googleMapsRouteUrl(points: { latitude: number; longitude: number }[]): string | null {
  if (!points.length) return null;
  const ll = (p: { latitude: number; longitude: number }) => `${p.latitude.toFixed(6)},${p.longitude.toFixed(6)}`;
  const stops = points.slice(0, GOOGLE_MAPS_MAX_STOPS);
  if (stops.length === 1) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ll(stops[0]))}`;
  const params = new URLSearchParams({
    api: "1",
    origin: ll(stops[0]),
    destination: ll(stops[stops.length - 1]),
    travelmode: "driving",
  });
  const mid = stops.slice(1, -1);
  if (mid.length) params.set("waypoints", mid.map(ll).join("|"));
  return `https://www.google.com/maps/dir/?${params}`;
}
