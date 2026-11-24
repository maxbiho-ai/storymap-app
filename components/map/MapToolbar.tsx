"use client";

import { useEffect, useRef, useState } from "react";
import { useMapStore, type MapMode, type ViewMode } from "@/store/mapStore";

const MODES: { key: ViewMode; label: string; title: string }[] = [
  { key: "dots", label: "Pins", title: "Glowing dots scaled by photo count" },
  { key: "thumbs", label: "Thumbnails", title: "Stacked photo cards" },
  { key: "heat", label: "Heatmap", title: "Photo density hotspots" },
];

const VIEW_CYCLE: { key: ViewMode; label: string; icon: string }[] = [
  { key: "dots", label: "Pins", icon: "📍" },
  { key: "thumbs", label: "Photos", icon: "🖼" },
  { key: "heat", label: "Heat", icon: "🔥" },
];
const STYLE_CYCLE: { key: MapMode; label: string }[] = [
  { key: "dark", label: "Dark" },
  { key: "streets", label: "Streets" },
  { key: "satellite", label: "Satellite" },
];

const mobileBase = "flex h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-2xl px-3 text-xs font-semibold shadow-lg ring-1 backdrop-blur";
const mobileBtn = `${mobileBase} bg-neutral-950/90 text-neutral-100 ring-white/10 active:bg-neutral-800`;

/**
 * Mobile (< md): one compact thumb row at the bottom. Destinations pill, view cycle (Pins / Photos / Heat),
 * style cycle (Dark / Streets / Satellite), Fit All, and a ⋯ menu for the secondary toggles.
 */
function MobileControls({ onFitAll, destinationsLabel }: { onFitAll: () => void; destinationsLabel: string }) {
  const viewMode = useMapStore((s) => s.viewMode);
  const setViewMode = useMapStore((s) => s.setViewMode);
  const mapMode = useMapStore((s) => s.mapMode);
  const setMapMode = useMapStore((s) => s.setMapMode);
  const exactGps = useMapStore((s) => s.exactGps);
  const setExactGps = useMapStore((s) => s.setExactGps);
  const countriesOn = useMapStore((s) => s.countriesOn);
  const setCountriesOn = useMapStore((s) => s.setCountriesOn);
  const destinationsOpen = useMapStore((s) => s.destinationsOpen);
  const setDestinationsOpen = useMapStore((s) => s.setDestinationsOpen);
  const [more, setMore] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!more) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setMore(false);
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [more]);

  const view = VIEW_CYCLE.find((v) => v.key === viewMode) ?? VIEW_CYCLE[0];
  const styleIdx = STYLE_CYCLE.findIndex((m) => m.key === mapMode);
  const style = STYLE_CYCLE[styleIdx] ?? { key: "terrain" as MapMode, label: "3D" };
  const terrain = mapMode === "terrain";
  const row = (on: boolean) => `flex min-h-11 w-full items-center justify-between gap-3 px-4 text-sm ${on ? "text-amber-300" : "text-neutral-100"}`;

  return (
    <div
      role="toolbar"
      aria-label="Map tools"
      className={`pointer-events-auto absolute inset-x-2 bottom-[calc(0.5rem+env(safe-area-inset-bottom))] z-20 flex items-center gap-1.5 md:hidden ${destinationsOpen ? "hidden" : ""}`}
    >
      <button type="button" onClick={() => setDestinationsOpen(true)} className={`${mobileBase} min-w-0 flex-1 justify-start bg-amber-300 text-neutral-900 ring-amber-200 active:bg-amber-200`}>
        <span aria-hidden>☰</span>
        <span className="truncate">{destinationsLabel}</span>
      </button>
      <button type="button" onClick={() => setViewMode(VIEW_CYCLE[(VIEW_CYCLE.indexOf(view) + 1) % VIEW_CYCLE.length].key)} aria-label={`Map view: ${view.label}. Tap to change`} className={mobileBtn}>
        <span aria-hidden>{view.icon}</span>
        {view.label}
      </button>
      <button type="button" onClick={() => setMapMode(terrain ? "dark" : STYLE_CYCLE[(styleIdx + 1) % STYLE_CYCLE.length].key)} aria-label={`Map style: ${style.label}. Tap to change`} className={mobileBtn}>
        {style.label}
      </button>
      <button type="button" onClick={onFitAll} aria-label="Fit all pins" className={mobileBtn}>⤢</button>
      <div ref={ref} className="relative">
        <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} aria-label="More map options" className={mobileBtn}>⋯</button>
        {more && (
          <div className="absolute bottom-full right-0 mb-2 w-60 overflow-hidden rounded-2xl border border-white/10 bg-neutral-950/95 py-1 shadow-2xl backdrop-blur">
            <button type="button" onClick={() => setExactGps(!exactGps)} aria-pressed={exactGps} className={row(exactGps)}>◎ Spread Exact GPS <span>{exactGps ? "On" : "Off"}</span></button>
            <button type="button" onClick={() => setCountriesOn(!countriesOn)} aria-pressed={countriesOn} className={row(countriesOn)}>🌍 Countries <span>{countriesOn ? "On" : "Off"}</span></button>
            <button type="button" onClick={() => setMapMode(terrain ? "satellite" : "terrain")} aria-pressed={terrain} className={row(terrain)}>⛰ 3D terrain <span>{terrain ? "On" : "Off"}</span></button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Desktop: segmented view switcher + Fit All Pins + Spread Exact GPS Spots. Mobile: MobileControls */
export default function MapToolbar({ onFitAll, disabled, destinationsLabel = "Destinations" }: { onFitAll: () => void; disabled?: boolean; destinationsLabel?: string }) {
  const viewMode = useMapStore((s) => s.viewMode);
  const setViewMode = useMapStore((s) => s.setViewMode);
  const exactGps = useMapStore((s) => s.exactGps);
  const setExactGps = useMapStore((s) => s.setExactGps);

  const countriesOn = useMapStore((s) => s.countriesOn);
  const setCountriesOn = useMapStore((s) => s.setCountriesOn);

  if (disabled) return null;
  return (
    <>
    <MobileControls onFitAll={onFitAll} destinationsLabel={destinationsLabel} />
    <div
      role="toolbar"
      aria-label="Map tools"
      className="pointer-events-auto absolute right-3 top-[8.25rem] z-20 hidden flex-wrap items-center justify-end gap-1.5 md:bottom-5 md:flex md:left-[calc(50%+170px)] md:right-auto md:top-auto md:-translate-x-1/2"
    >
      <div role="radiogroup" aria-label="Map view" className="flex rounded-2xl bg-neutral-950/85 p-1 shadow-lg ring-1 ring-white/10 backdrop-blur">
        {MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            role="radio"
            aria-checked={viewMode === m.key}
            title={m.title}
            onClick={() => setViewMode(m.key)}
            className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${viewMode === m.key ? "bg-amber-300 text-neutral-900" : "text-neutral-300 hover:bg-white/10 hover:text-white"}`}
          >
            {m.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setCountriesOn(!countriesOn)}
        aria-pressed={countriesOn}
        title="Visited-country highlight and country pills (they fade out as you zoom in)"
        className={`rounded-2xl px-3 py-2 text-xs font-semibold shadow-lg ring-1 ring-white/10 backdrop-blur transition ${countriesOn ? "bg-amber-300 text-neutral-900" : "bg-neutral-950/85 text-neutral-100 hover:bg-neutral-800"}`}
      >
        🌍 Countries
      </button>
      <button
        type="button"
        onClick={onFitAll}
        title="Zoom to all visible pins"
        className="rounded-2xl bg-neutral-950/85 px-3 py-2 text-xs font-semibold text-neutral-100 shadow-lg ring-1 ring-white/10 backdrop-blur hover:bg-neutral-800"
      >
        ⤢ Fit All Pins
      </button>
      <button
        type="button"
        onClick={() => setExactGps(!exactGps)}
        aria-pressed={exactGps}
        title="Off: photos of one spot stay grouped. On: zoom in and spread a pin per exact GPS coordinate"
        className={`rounded-2xl px-3 py-2 text-xs font-semibold shadow-lg ring-1 ring-white/10 backdrop-blur transition ${exactGps ? "bg-amber-300 text-neutral-900" : "bg-neutral-950/85 text-neutral-100 hover:bg-neutral-800"}`}
      >
        ◎ Spread Exact GPS Spots{exactGps ? " · on" : ""}
      </button>
    </div>
    </>
  );
}
