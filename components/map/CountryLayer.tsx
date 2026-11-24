"use client";

import { useEffect, useMemo, useState } from "react";
import { Layer, Marker, Source, useMap } from "react-map-gl";
import { boundaryNames, canonicalCountry } from "@/lib/countries";
import { MAP_ID } from "./constants";

const FILL = "country-fill";
const SOURCE_LAYER = "country_boundaries";
const WORLDVIEW = ["any", ["==", "all", ["get", "worldview"]], ["in", "US", ["get", "worldview"]]];

/** Smart zoom fade: full strength up to FADE_FROM, gone by FADE_TO; the country pills disappear at PILL_HIDE */
const FADE_FROM = 4.5;
const FADE_TO = 6.0;
const PILL_HIDE = 5.8;

export interface CountryPill {
  name: string;
  count: number;
  latitude: number;
  longitude: number;
}

interface Props {
  /** canonical country → photo count (only countries that have photos light up) */
  counts: Map<string, number>;
  /** One floating "Iceland · 397 photos" pill per country, at the middle of its photos */
  pills: CountryPill[];
  /** Active country filter (stays outlined) */
  active: string | null;
  /** The "Countries" toggle: visited-country fill, outline and pills */
  enabled: boolean;
  disabled?: boolean;
  /** Light base map (Streets): a stronger, darker amber so the highlight stays visible */
  light?: boolean;
  onPick: (country: string) => void;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const fade = (peak: number) => ["interpolate", ["linear"], ["zoom"], FADE_FROM, peak, FADE_TO, 0];

/**
 * Countries containing photos, from Mapbox's country-boundaries tileset: a persistent yellow fill + outline that fades
 * out between zoom 4.5 and 6, a hover highlight with a "Romania · 122 photos" tooltip, and floating country pills.
 * The click itself is handled by MapView (it knows about open cards / pick modes).
 */
export default function CountryLayer({ counts, pills, active, enabled, disabled, light, onPick }: Props) {
  const { [MAP_ID]: map } = useMap();
  const [hover, setHover] = useState<{ name: string; x: number; y: number } | null>(null);
  const [zoom, setZoom] = useState(2);
  const interactive = enabled && !disabled;

  const names = useMemo(() => [...counts.keys()].flatMap((c) => boundaryNames(c)), [counts]);
  const hasPhotos = useMemo(() => ["in", ["get", "name_en"], ["literal", names.length ? names : ["∅"]]], [names]);
  const hoverNames = useMemo(() => (hover ? boundaryNames(hover.name) : ["∅"]), [hover]);
  const activeNames = useMemo(() => (active ? boundaryNames(active) : ["∅"]), [active]);

  // Live zoom (in 0.05 steps) so the pills fade while zooming, not only when it ends
  useEffect(() => {
    const m = map?.getMap();
    if (!m) return;
    const update = () => setZoom(Math.round(m.getZoom() * 20) / 20);
    update();
    m.on("zoom", update);
    return () => {
      m.off("zoom", update);
    };
  }, [map]);

  useEffect(() => {
    const m = map?.getMap();
    if (!m || !interactive) {
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
  }, [map, counts, interactive]);

  const n = hover ? counts.get(hover.name) ?? 0 : 0;
  const pillOpacity = zoom >= PILL_HIDE ? 0 : clamp01((PILL_HIDE - zoom) / (PILL_HIDE - FADE_FROM));
  const visibility = enabled ? "visible" : "none";

  return (
    <>
      <Source id="country-boundaries" type="vector" url="mapbox://mapbox.country-boundaries-v1">
        {/* Visited countries: yellow fill + outline, fading out as you zoom in */}
        <Layer
          id="country-visited-fill"
          type="fill"
          source-layer={SOURCE_LAYER}
          layout={{ visibility }}
          filter={["all", WORLDVIEW, hasPhotos] as never}
          paint={{ "fill-color": light ? "#f59e0b" : "#fbbf24", "fill-opacity": fade(light ? 0.32 : 0.2) as never }}
        />
        <Layer
          id="country-visited-line"
          type="line"
          source-layer={SOURCE_LAYER}
          layout={{ visibility }}
          filter={["all", WORLDVIEW, hasPhotos] as never}
          paint={{ "line-color": light ? "#d97706" : "#fcd34d", "line-width": light ? 1.8 : 1.2, "line-opacity": fade(light ? 0.95 : 0.75) as never }}
        />
        {/* Invisible-ish hit layer for countries that have photos (hover / click) */}
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

      {interactive && pillOpacity > 0 &&
        pills.map((p) => (
          <Marker
            key={p.name}
            longitude={p.longitude}
            latitude={p.latitude}
            anchor="center"
            className="max-md:!hidden"
            style={{ zIndex: 3, opacity: pillOpacity, pointerEvents: pillOpacity < 0.3 ? "none" : undefined }}
            onClick={(e) => {
              e.originalEvent.stopPropagation();
              onPick(p.name);
            }}
          >
            <button
              type="button"
              title={`Show ${p.name}`}
              className="cursor-pointer whitespace-nowrap rounded-full bg-neutral-950/80 px-2.5 py-1 text-[11px] font-semibold text-white shadow-lg ring-1 ring-amber-300/50 backdrop-blur transition hover:bg-neutral-900"
            >
              {p.name} <span className="text-amber-300">• {p.count.toLocaleString()} photo{p.count === 1 ? "" : "s"}</span>
            </button>
          </Marker>
        ))}

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
