"use client";

import { useEffect, useMemo, useState } from "react";
import { Layer, Marker, Source } from "react-map-gl";
import { useRoutesStore } from "@/store/routesStore";
import { fetchRoute } from "@/lib/directions";
import { DAY_COLORS } from "@/lib/trip";
import { LIGHT_ICON } from "@/lib/readyRoutes";

/** The open Ready Route on the map: each day's road route (straight line fallback) and numbered stops */
export default function ReadyRouteLayer() {
  const active = useRoutesStore((s) => s.active);
  const [roads, setRoads] = useState<Record<string, [number, number][] | null>>({});

  const days = useMemo(
    () =>
      (active?.plan.days ?? []).map((d, i) => ({
        i,
        stops: d.stops,
        key: d.stops.map((s) => `${s.longitude.toFixed(4)},${s.latitude.toFixed(4)}`).join(";"),
      })),
    [active],
  );

  useEffect(() => {
    let alive = true;
    for (const d of days) {
      if (d.stops.length < 2 || d.key in roads) continue;
      fetchRoute(d.stops.map((s) => [s.longitude, s.latitude])).then((r) => alive && setRoads((prev) => ({ ...prev, [d.key]: r })));
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  const fc = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: days
        .filter((d) => d.stops.length > 1)
        .map((d) => ({
          type: "Feature" as const,
          properties: { color: DAY_COLORS[d.i % DAY_COLORS.length] },
          geometry: { type: "LineString" as const, coordinates: roads[d.key] ?? d.stops.map((s) => [s.longitude, s.latitude]) },
        })),
    }),
    [days, roads],
  );

  if (!active) return null;
  return (
    <>
      <Source id="ready-route-lines" type="geojson" data={fc}>
        <Layer id="ready-route-glow" type="line" layout={{ "line-cap": "round", "line-join": "round" }} paint={{ "line-color": ["get", "color"], "line-width": 10, "line-opacity": 0.2, "line-blur": 3 }} />
        <Layer id="ready-route-line" type="line" layout={{ "line-cap": "round", "line-join": "round" }} paint={{ "line-color": ["get", "color"], "line-width": 4, "line-opacity": 0.95 }} />
      </Source>
      {days.flatMap((d) =>
        d.stops.map((s, n) => (
          <Marker key={`${d.i}-${n}-${s.latitude}`} longitude={s.longitude} latitude={s.latitude} anchor="center" style={{ zIndex: 37, pointerEvents: "none" }}>
            <span
              title={`Day ${d.i + 1} · ${n + 1}. ${s.name}${s.light ? ` · ${s.light}` : ""}`}
              className="relative flex h-7 w-7 items-center justify-center rounded-full text-xs font-extrabold text-neutral-950 shadow-lg ring-2 ring-white"
              style={{ background: DAY_COLORS[d.i % DAY_COLORS.length] }}
            >
              {n + 1}
              {s.light && <span className="absolute -right-2 -top-2 text-[11px] leading-none" aria-hidden>{LIGHT_ICON[s.light]}</span>}
            </span>
          </Marker>
        )),
      )}
    </>
  );
}
