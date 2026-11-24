"use client";

import { useMapStore, type ViewMode } from "@/store/mapStore";

const MODES: { key: ViewMode; label: string; title: string }[] = [
  { key: "dots", label: "Pins", title: "Glowing dots scaled by photo count" },
  { key: "thumbs", label: "Thumbnails", title: "Stacked photo cards" },
  { key: "heat", label: "Heatmap", title: "Photo density hotspots" },
];

/** Segmented view switcher + Fit All Pins + Spread Exact GPS Spots */
export default function MapToolbar({ onFitAll, disabled }: { onFitAll: () => void; disabled?: boolean }) {
  const viewMode = useMapStore((s) => s.viewMode);
  const setViewMode = useMapStore((s) => s.setViewMode);
  const exactGps = useMapStore((s) => s.exactGps);
  const setExactGps = useMapStore((s) => s.setExactGps);

  const countriesOn = useMapStore((s) => s.countriesOn);
  const setCountriesOn = useMapStore((s) => s.setCountriesOn);

  if (disabled) return null;
  return (
    <div
      role="toolbar"
      aria-label="Map tools"
      className="pointer-events-auto absolute right-3 top-[8.25rem] z-20 flex flex-wrap items-center justify-end gap-1.5 md:bottom-5 md:left-[calc(50%+170px)] md:right-auto md:top-auto md:-translate-x-1/2"
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
  );
}
