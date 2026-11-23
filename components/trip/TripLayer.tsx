"use client";

import { useEffect, useMemo, useState } from "react";
import { Layer, Marker, Source } from "react-map-gl";
import { useTripStore } from "@/store/tripStore";
import { fetchRoute } from "@/lib/directions";
import { DAY_COLORS, formatDay } from "@/lib/trip";

/** The itinerary on the map: numbered stop markers per day + each day's driving route (straight line as fallback) */
export default function TripLayer() {
  const open = useTripStore((s) => s.open);
  const days = useTripStore((s) => s.trip.days);
  const [routes, setRoutes] = useState<Record<string, [number, number][] | null>>({});

  const keyed = useMemo(
    () => days.map((d, i) => ({ i, date: d.date, stops: d.stops, key: d.stops.map((s) => `${s.longitude.toFixed(4)},${s.latitude.toFixed(4)}`).join(";") })),
    [days],
  );

  useEffect(() => {
    if (!open) return;
    let alive = true;
    for (const d of keyed) {
      if (d.stops.length < 2 || d.key in routes) continue;
      fetchRoute(d.stops.map((s) => [s.longitude, s.latitude])).then((r) => alive && setRoutes((prev) => ({ ...prev, [d.key]: r })));
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyed, open]);

  const fc = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: keyed
        .filter((d) => d.stops.length > 1)
        .map((d) => ({
          type: "Feature" as const,
          properties: { color: DAY_COLORS[d.i % DAY_COLORS.length] },
          geometry: { type: "LineString" as const, coordinates: routes[d.key] ?? d.stops.map((s) => [s.longitude, s.latitude]) },
        })),
    }),
    [keyed, routes],
  );

  if (!open) return null;
  return (
    <>
      <Source id="trip-plan-routes" type="geojson" data={fc}>
        <Layer id="trip-plan-glow" type="line" layout={{ "line-cap": "round", "line-join": "round" }} paint={{ "line-color": ["get", "color"], "line-width": 9, "line-opacity": 0.18, "line-blur": 3 }} />
        <Layer id="trip-plan-line" type="line" layout={{ "line-cap": "round", "line-join": "round" }} paint={{ "line-color": ["get", "color"], "line-width": 3.5, "line-opacity": 0.95 }} />
      </Source>
      {keyed.flatMap((d) =>
        d.stops.map((s, n) => (
          <Marker key={s.id} longitude={s.longitude} latitude={s.latitude} anchor="center" style={{ zIndex: 36, pointerEvents: "none" }}>
            <span
              title={`Day ${d.i + 1} · ${formatDay(d.date)} · ${s.name}`}
              className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-extrabold text-neutral-950 shadow-lg ring-2 ring-white"
              style={{ background: DAY_COLORS[d.i % DAY_COLORS.length] }}
            >
              {n + 1}
            </span>
          </Marker>
        )),
      )}
    </>
  );
}
