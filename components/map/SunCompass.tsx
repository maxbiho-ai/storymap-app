"use client";

import { useMemo } from "react";
import { Layer, Marker, Source } from "react-map-gl";
import type { Photo } from "@/types/photo";
import { compassPoint, destination, lightDirectionAt, metersPerPixel } from "@/lib/sunMoon";

const RING_PX = 92;

/**
 * Around the open pin: a compass ring, the sun / moon azimuth at capture time as a ray with a bright arc,
 * and a badge at its end. Sized in screen pixels (recomputed when the zoom settles).
 */
export default function SunCompass({ photo, zoom }: { photo: Photo; zoom: number }) {
  const { latitude: lat, longitude: lng, taken_at } = photo;

  const data = useMemo(() => {
    if (!taken_at) return null;
    const dir = lightDirectionAt(new Date(taken_at), lat, lng);
    const R = Math.min(metersPerPixel(lat, zoom) * RING_PX, 4_000_000);
    const at = (bearing: number, r = R) => destination(lat, lng, bearing, r);

    const ring = Array.from({ length: 73 }, (_, i) => at(i * 5));
    // The bright arc: ±16° of the ring around the light's bearing
    const arc = Array.from({ length: 17 }, (_, i) => at(dir.azimuth - 16 + i * 2));
    const tip = at(dir.azimuth);
    const fc = {
      type: "FeatureCollection" as const,
      features: [
        { type: "Feature" as const, properties: { k: "ring" }, geometry: { type: "LineString" as const, coordinates: ring } },
        { type: "Feature" as const, properties: { k: "ray" }, geometry: { type: "LineString" as const, coordinates: [[lng, lat], tip] } },
        { type: "Feature" as const, properties: { k: "arc" }, geometry: { type: "LineString" as const, coordinates: arc } },
      ],
    };
    return { dir, fc, tip, north: at(0) };
  }, [taken_at, lat, lng, zoom]);

  if (!data) return null;
  const { dir, fc, tip, north } = data;
  const isSun = dir.body === "sun";
  const color = isSun ? "#fbbf24" : "#bfdbfe";

  return (
    <>
      <Source id="sun-compass" type="geojson" data={fc}>
        <Layer id="sun-compass-ring" type="line" filter={["==", ["get", "k"], "ring"]}
          layout={{ "line-cap": "round" }}
          paint={{ "line-color": "#ffffff", "line-width": 1.2, "line-opacity": 0.35, "line-dasharray": [1, 3] }} />
        <Layer id="sun-compass-ray" type="line" filter={["==", ["get", "k"], "ray"]}
          layout={{ "line-cap": "round" }}
          paint={{ "line-color": color, "line-width": 2, "line-opacity": 0.85, "line-dasharray": [3, 2] }} />
        <Layer id="sun-compass-arc-glow" type="line" filter={["==", ["get", "k"], "arc"]}
          layout={{ "line-cap": "round", "line-join": "round" }}
          paint={{ "line-color": color, "line-width": 12, "line-opacity": 0.22, "line-blur": 4 }} />
        <Layer id="sun-compass-arc" type="line" filter={["==", ["get", "k"], "arc"]}
          layout={{ "line-cap": "round", "line-join": "round" }}
          paint={{ "line-color": color, "line-width": 4, "line-opacity": 0.95 }} />
      </Source>

      <Marker longitude={north[0]} latitude={north[1]} anchor="center" style={{ pointerEvents: "none", zIndex: 5 }}>
        <span className="rounded-full bg-black/55 px-1.5 text-[10px] font-bold text-white/80">N</span>
      </Marker>
      <Marker longitude={tip[0]} latitude={tip[1]} anchor="center" style={{ pointerEvents: "none", zIndex: 6 }}>
        <span className="flex flex-col items-center">
          <span className="flex h-8 w-8 items-center justify-center rounded-full text-lg shadow-lg ring-2" style={{ background: isSun ? "#fef3c7" : "#1e293b", boxShadow: `0 0 18px ${color}`, borderColor: color }}>
            {isSun ? "☀️" : "🌙"}
          </span>
          <span className="mt-0.5 whitespace-nowrap rounded-full bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white">
            {Math.round(dir.azimuth)}° {compassPoint(dir.azimuth)}
          </span>
        </span>
      </Marker>
    </>
  );
}
