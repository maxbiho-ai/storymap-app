"use client";

import { useEffect, useMemo, useState } from "react";
import { useRoutesStore } from "@/store/routesStore";
import { listReadyRoutes } from "@/lib/readyRoutesApi";
import { LIGHT_ICON, LIGHT_PHASES, allStops, fmtKm, routeDistanceKm, type CuratedRoute } from "@/lib/readyRoutes";
import RouteLine from "./RouteLine";

/** 🗺️ Ready Routes: the gallery of curated multi-day photo itineraries */
export default function ReadyRoutesGallery() {
  const open = useRoutesStore((s) => s.galleryOpen);
  const setOpen = useRoutesStore((s) => s.setGalleryOpen);
  const openRoute = useRoutesStore((s) => s.openRoute);
  const [routes, setRoutes] = useState<CuratedRoute[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [country, setCountry] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setError(null);
    listReadyRoutes()
      .then((r) => alive && setRoutes(r))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Could not load routes"));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      alive = false;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen]);

  const countries = useMemo(() => [...new Set((routes ?? []).map((r) => r.country).filter(Boolean) as string[])].sort(), [routes]);
  const shown = (routes ?? []).filter((r) => !country || r.country === country);

  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="ready-routes-title" className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 backdrop-blur-sm md:items-center md:p-6" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="flex max-h-[92dvh] w-full max-w-5xl flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-neutral-950 text-neutral-100 shadow-2xl md:rounded-3xl">
        <div className="flex items-start gap-3 border-b border-white/10 px-5 py-4">
          <div>
            <h2 id="ready-routes-title" className="text-lg font-semibold">🗺️ Ready Routes</h2>
            <p className="text-xs text-neutral-400">Curated multi-day photography itineraries, built from real geotagged shots. Open one to see it on the map.</p>
          </div>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close Ready Routes" className="ml-auto text-2xl leading-none text-neutral-400 hover:text-white">×</button>
        </div>

        {countries.length > 1 && (
          <div className="flex flex-wrap gap-1.5 px-5 pt-3">
            {[null, ...countries].map((c) => (
              <button key={c ?? "all"} type="button" onClick={() => setCountry(c)} aria-pressed={country === c} className={`rounded-full px-3 py-1 text-xs font-semibold ${country === c ? "bg-amber-300 text-neutral-900" : "bg-white/10 text-neutral-200 hover:bg-white/20"}`}>
                {c ?? "All"}
              </button>
            ))}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {error ? (
            <p className="rounded-xl bg-red-950/60 px-4 py-3 text-sm text-red-200">{error}</p>
          ) : !routes ? (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => <li key={i} className="h-72 animate-pulse rounded-2xl bg-white/5" />)}
            </ul>
          ) : !shown.length ? (
            <p className="py-12 text-center text-sm text-neutral-400">No Ready Routes yet. Check back soon.</p>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((r) => (
                <li key={r.id}>
                  <RouteCard route={r} onOpen={() => openRoute(r)} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function RouteCard({ route: r, onOpen }: { route: CuratedRoute; onOpen: () => void }) {
  const stops = allStops(r);
  const phases = LIGHT_PHASES.map((p) => ({ p, n: stops.filter((s) => s.light === p).length })).filter((x) => x.n);
  const km = routeDistanceKm(r);
  return (
    <button type="button" onClick={onOpen} className="group flex h-full w-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] text-start transition hover:border-amber-300/50 hover:bg-white/[0.06]">
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-neutral-800">
        {r.cover_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={r.cover_url} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
        <RouteLine days={r.plan.days} className="absolute bottom-2 right-2 h-14 w-24 rounded-lg bg-black/55 p-1 backdrop-blur-sm" />
        <div className="absolute bottom-2 left-3 right-28">
          {r.country && <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-300">{r.country}</p>}
          <h3 className="line-clamp-2 text-sm font-semibold leading-tight text-white">{r.title}</h3>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <p className="text-xs text-neutral-300">
          <strong className="text-white">{r.days}</strong> day{r.days === 1 ? "" : "s"} · <strong className="text-white">{r.stops_count}</strong> stops{km > 0 ? ` · ≈ ${fmtKm(km)}` : ""}
        </p>
        {r.description && <p className="line-clamp-2 text-xs text-neutral-400">{r.description}</p>}
        {phases.length > 0 && (
          <div className="mt-auto flex flex-wrap gap-1">
            {phases.map(({ p, n }) => (
              <span key={p} className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-neutral-200">
                {LIGHT_ICON[p]} {p} · {n}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  );
}
