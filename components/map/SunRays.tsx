"use client";

import { useMemo } from "react";
import { Layer, Source } from "react-map-gl";
import { destination, lightDirectionAt, metersPerPixel } from "@/lib/sunMoon";

export interface RayPoint {
  latitude: number;
  longitude: number;
  taken_at: string | null;
}

const RAY_PX = 34;
const MAX_RAYS = 400;

/** Global "Show Sun Direction": a short ray from every visible pin towards the sun / moon at its capture time */
export default function SunRays({ points, zoom }: { points: RayPoint[]; zoom: number }) {
  const fc = useMemo(() => {
    const features = [];
    for (const p of points) {
      if (!p.taken_at || features.length >= MAX_RAYS) continue;
      const t = new Date(p.taken_at);
      if (Number.isNaN(t.getTime())) continue;
      const dir = lightDirectionAt(t, p.latitude, p.longitude);
      const tip = destination(p.latitude, p.longitude, dir.azimuth, Math.min(metersPerPixel(p.latitude, zoom) * RAY_PX, 4_000_000));
      features.push({
        type: "Feature" as const,
        properties: { sun: dir.body === "sun" ? 1 : 0 },
        geometry: { type: "LineString" as const, coordinates: [[p.longitude, p.latitude], tip] },
      });
    }
    return { type: "FeatureCollection" as const, features };
  }, [points, zoom]);

  return (
    <Source id="sun-rays-all" type="geojson" data={fc}>
      <Layer id="sun-rays-all-glow" type="line" layout={{ "line-cap": "round" }} paint={{ "line-color": "#fbbf24", "line-width": 6, "line-opacity": 0.2, "line-blur": 2 }} />
      <Layer
        id="sun-rays-all-line"
        type="line"
        layout={{ "line-cap": "round" }}
        paint={{ "line-color": ["case", ["==", ["get", "sun"], 1], "#fbbf24", "#cbd5e1"], "line-width": 2.2, "line-opacity": 0.95 }}
      />
    </Source>
  );
}
