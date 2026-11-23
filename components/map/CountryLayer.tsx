"use client";

import { useEffect, useMemo, useState } from "react";
import { Layer, Source, useMap } from "react-map-gl";
import { boundaryNames, canonicalCountry } from "@/lib/countries";
import { MAP_ID } from "./constants";

const FILL = "country-fill";
const SOURCE_LAYER = "country_boundaries";
const WORLDVIEW = ["any", ["==", "all", ["get", "worldview"]], ["in", "US", ["get", "worldview"]]];

interface Props {
  /** canonical country → photo count (only countries that have photos light up) */
  counts: Map<string, number>;
  /** Active country filter (stays outlined) */
  active: string | null;
  disabled?: boolean;
}

/**
 * Countries containing photos, from Mapbox's country-boundaries tileset: a subtle fill + border while hovered,
 * with a "Romania · 122 photos" tooltip. The click itself is handled by MapView (it knows about open cards / pick modes).
 */
export default function CountryLayer({ counts, active, disabled }: Props) {
  const { [MAP_ID]: map } = useMap();
  const [hover, setHover] = useState<{ name: string; x: number; y: number } | null>(null);

  const names = useMemo(() => [...counts.keys()].flatMap((c) => boundaryNames(c)), [counts]);
  const hasPhotos = useMemo(() => ["in", ["get", "name_en"], ["literal", names.length ? names : ["∅"]]], [names]);
  const hoverNames = useMemo(() => (hover ? boundaryNames(hover.name) : ["∅"]), [hover]);
  const activeNames = useMemo(() => (active ? boundaryNames(active) : ["∅"]), [active]);

  useEffect(() => {
    const m = map?.getMap();
    if (!m || disabled) {
      setHover(null);
      return;
    }
    const onMove = (e: mapboxgl.MapMouseEvent) => {
      if (!m.getLayer(FILL)) return;
      const f = m.queryRenderedFeatures(e.point, { layers: [FILL] })[0];
      const canon = canonicalCountry(f?.properties?.name_en as string | undefined);
      if (canon && counts.has(canon)) {
        m.getCanvas().style.cursor = "pointer";
        setHover((h) => (h && h.name === canon ? { ...h, x: e.point.x, y: e.point.y } : { name: canon, x: e.point.x, y: e.point.y }));
      } else {
        m.getCanvas().style.cursor = "";
        setHover(null);
      }
    };
    const onLeave = () => {
      m.getCanvas().style.cursor = "";
      setHover(null);
    };
    m.on("mousemove", onMove);
    m.getCanvas().addEventListener("mouseleave", onLeave);
    return () => {
      m.off("mousemove", onMove);
      m.getCanvas().removeEventListener("mouseleave", onLeave);
      m.getCanvas().style.cursor = "";
    };
  }, [map, counts, disabled]);

  const n = hover ? counts.get(hover.name) ?? 0 : 0;

  return (
    <>
      <Source id="country-boundaries" type="vector" url="mapbox://mapbox.country-boundaries-v1">
        {/* Invisible-ish hit layer for countries that have photos */}
        <Layer
          id={FILL}
          type="fill"
          source-layer={SOURCE_LAYER}
          filter={["all", WORLDVIEW, hasPhotos] as never}
          paint={{ "fill-color": "#fbbf24", "fill-opacity": 0.015 }}
        />
        <Layer
          id="country-hover-fill"
          type="fill"
          source-layer={SOURCE_LAYER}
          filter={["all", WORLDVIEW, ["in", ["get", "name_en"], ["literal", hoverNames]]] as never}
          paint={{ "fill-color": "#fbbf24", "fill-opacity": 0.2 }}
        />
        <Layer
          id="country-hover-line"
          type="line"
          source-layer={SOURCE_LAYER}
          filter={["all", WORLDVIEW, ["in", ["get", "name_en"], ["literal", [...hoverNames, ...activeNames]]]] as never}
          paint={{ "line-color": "#fcd34d", "line-width": 1.6, "line-opacity": 0.9 }}
        />
      </Source>
      {hover && n > 0 && (
        <div
          className="pointer-events-none absolute z-20 whitespace-nowrap rounded-lg bg-neutral-950/90 px-2.5 py-1 text-xs font-semibold text-white shadow-lg ring-1 ring-white/15"
          style={{ left: hover.x + 14, top: hover.y + 14 }}
        >
          {hover.name} <span className="text-amber-300">· {n.toLocaleString()} photo{n === 1 ? "" : "s"}</span>
        </div>
      )}
    </>
  );
}
