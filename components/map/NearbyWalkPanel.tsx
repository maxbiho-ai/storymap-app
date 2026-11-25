"use client";

import { useEffect, useMemo, useState } from "react";
import { useMap } from "react-map-gl";
import { getSupabase } from "@/lib/supabase/client";
import { useMapStore } from "@/store/mapStore";
import { destination, formatClock } from "@/lib/sunMoon";
import { WALK_STAGES, buildWalk, radiusBox, type WalkStop } from "@/lib/walk";
import { googleMapsRouteUrl } from "@/hooks/useCollectionPhotos";
import type { Photo } from "@/types/photo";
import { MAP_ID } from "./constants";

const RADII = [1, 2, 5, 10, 15, 20, 30, 50];

/** "What else to shoot nearby?": pins around the open one, in shooting-light order, as a loop to plan */
export default function NearbyWalkPanel() {
  const { [MAP_ID]: map } = useMap();
  const walk = useMapStore((s) => s.walk);
  const setRadius = useMapStore((s) => s.setWalkRadius);
  const setStops = useMapStore((s) => s.setWalkStops);
  const endWalk = useMapStore((s) => s.endWalk);
  const select = useMapStore((s) => s.select);
  const selectedId = useMapStore((s) => s.selectedId);
  const deleted = useMapStore((s) => s.deleted);
  const [candidates, setCandidates] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const origin = walk?.origin;
  const radiusKm = walk?.radiusKm ?? 0;
  const originId = origin?.id;

  // Load pins inside the circle's bounding box (RLS: public + mine); Haversine does the exact cut
  useEffect(() => {
    if (!origin) return;
    let alive = true;
    setLoading(true);
    setError(null);
    const { south, north, west, east } = radiusBox(origin.latitude, origin.longitude, radiusKm);
    let q = getSupabase().from("photos").select("*").gte("latitude", south).lte("latitude", north).limit(500);
    q = west >= -180 && east <= 180 ? q.gte("longitude", west).lte("longitude", east) : q;
    q.then(({ data, error }) => {
      if (!alive) return;
      setLoading(false);
      if (error) return setError(error.message);
      setCandidates((data ?? []) as Photo[]);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originId, radiusKm]);

  const stops = useMemo<WalkStop[]>(
    () => (origin ? buildWalk(origin, candidates.filter((p) => !deleted[p.id]), radiusKm) : []),
    [origin, candidates, radiusKm, deleted],
  );
  useEffect(() => {
    setStops(stops.map((s) => s.photo));
  }, [stops, setStops]);

  // Fit the whole circle
  useEffect(() => {
    if (!map || !origin) return;
    const pts = [0, 90, 180, 270].map((b) => destination(origin.latitude, origin.longitude, b, radiusKm * 1000));
    const lngs = pts.map((p) => p[0]);
    const lats = pts.map((p) => p[1]);
    map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], {
      padding: { top: 120, bottom: 60, left: 60, right: 60 },
      duration: 1400,
      maxZoom: 13,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, originId, radiusKm]);

  if (!walk || !origin) return null;

  const routeUrl = googleMapsRouteUrl([origin, ...stops.map((s) => s.photo)]);
  const numbered = stops.map((s, i) => ({ ...s, n: i + 1 }));
  const grouped = WALK_STAGES.map((label, i) => ({ label, items: numbered.filter((s) => s.stage === i) })).filter((g) => g.items.length);
  const hour = (p: Photo) => (p.taken_at ? formatClock(new Date(p.taken_at), p.taken_tz) : null);

  return (
    <aside className="absolute inset-x-2 top-[7.5rem] z-30 max-h-[45dvh] overflow-hidden rounded-2xl border border-white/10 bg-neutral-950/95 text-neutral-100 shadow-2xl backdrop-blur md:inset-x-auto md:right-4 md:top-24 md:max-h-[calc(100dvh-8rem)] md:w-[360px]">
      <div className="flex items-start justify-between gap-2 border-b border-white/10 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">🥾 Nearby Photo Walk</h2>
          <p className="truncate text-[11px] text-neutral-400" dir="auto">From {origin.location_name ?? origin.title ?? "this pin"}</p>
        </div>
        <button type="button" onClick={endWalk} aria-label="Close walk" className="text-xl leading-none text-neutral-400 hover:text-white">×</button>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-4 py-2 text-xs">
        <label className="flex items-center gap-1.5 text-neutral-300">
          Within
          <select value={radiusKm} onChange={(e) => setRadius(Number(e.target.value))} className="rounded-md border border-white/10 bg-neutral-900 px-1.5 py-0.5 text-xs text-white outline-none">
            {RADII.map((r) => <option key={r} value={r}>{r} km</option>)}
          </select>
        </label>
        <span className="text-neutral-500">{radiusKm <= 3 ? `≈ ${Math.round((radiusKm / 4.5) * 60)} min walk` : `≈ ${Math.round(((radiusKm * 1.3) / 45) * 60)} min drive`}</span>
        {loading && <span className="h-3 w-3 animate-spin rounded-full border-2 border-neutral-600 border-t-neutral-200" aria-label="Loading" />}
        {routeUrl && stops.length > 0 && (
          <a href={routeUrl} target="_blank" rel="noopener noreferrer" className="ml-auto rounded-full bg-amber-300 px-2.5 py-1 font-semibold text-neutral-900 hover:bg-amber-200">
            Open loop in Google Maps
          </a>
        )}
      </div>

      <div className="max-h-[calc(45dvh-7rem)] overflow-y-auto px-2 py-2 md:max-h-[calc(100dvh-16rem)]">
        {error && <p className="rounded-lg bg-red-950/60 px-3 py-2 text-xs text-red-200">{error}</p>}
        <div className="mb-1 flex items-center gap-2 rounded-lg bg-sky-400/10 px-3 py-2 text-xs">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-sky-400 text-[10px] font-bold text-neutral-950">★</span>
          <span className="font-medium">Start here</span>
          <span className="truncate text-neutral-400" dir="auto">{origin.location_name ?? origin.title}</span>
        </div>

        {!loading && !stops.length && !error && (
          <p className="px-3 py-4 text-center text-xs text-neutral-500">No other pins within {radiusKm} km. Try a bigger radius.</p>
        )}

        {grouped.map((g) => (
          <section key={g.label} className="mt-2">
            <h3 className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">{g.label}</h3>
            <ul>
              {g.items.map((s) => (
                <li key={s.photo.id}>
                  <button
                    type="button"
                    onClick={() => {
                      select(s.photo.id);
                      map?.flyTo({ center: [s.photo.longitude, s.photo.latitude], zoom: Math.max(map.getZoom(), 13), duration: 1200, essential: true });
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-start hover:bg-white/5 ${selectedId === s.photo.id ? "bg-white/10" : ""}`}
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-400 text-xs font-bold text-neutral-950">{s.n}</span>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.photo.thumb_url ?? s.photo.photo_url} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium" dir="auto">{s.photo.location_name ?? s.photo.title ?? "Untitled"}</span>
                      <span className="block text-[11px] text-neutral-500">
                        {s.km < 10 ? s.km.toFixed(1) : Math.round(s.km)} km · ~{s.minutes} min
                        {hour(s.photo) && <> · shot at {hour(s.photo)}</>}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </aside>
  );
}
