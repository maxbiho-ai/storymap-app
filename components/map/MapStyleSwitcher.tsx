"use client";

import { useMapStore, type MapMode } from "@/store/mapStore";

const MODES: { key: MapMode; label: string; hint: string }[] = [
  { key: "dark", label: "Dark", hint: "Dark map" },
  { key: "streets", label: "Streets", hint: "Road map with route numbers and place names" },
  { key: "satellite", label: "Satellite", hint: "Satellite with labels" },
  { key: "terrain", label: "3D", hint: "Satellite with 3D terrain" },
];

/** Map HUD: Dark / Streets / Satellite hybrid / 3D terrain */
export default function MapStyleSwitcher() {
  const mode = useMapStore((s) => s.mapMode);
  const setMode = useMapStore((s) => s.setMapMode);
  return (
    <div
      role="radiogroup"
      aria-label="Map style"
      className="absolute bottom-[11.5rem] right-[10px] z-10 flex flex-col overflow-hidden rounded-lg bg-neutral-950/85 text-[11px] font-semibold shadow-lg backdrop-blur md:bottom-[9.5rem]"
    >
      {MODES.map((m) => (
        <button
          key={m.key}
          type="button"
          role="radio"
          aria-checked={mode === m.key}
          title={m.hint}
          onClick={() => setMode(m.key)}
          className={`px-2.5 py-1.5 transition ${mode === m.key ? "bg-amber-300 text-neutral-900" : "text-neutral-300 hover:bg-white/10"}`}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
