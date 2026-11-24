"use client";

import { useEffect, useRef, useState } from "react";
import { useMapStore } from "@/store/mapStore";
import { EMPTY_GEAR, LIGHT_LABEL, gearCount, type LightKey } from "@/lib/gear";

const LIGHTS: LightKey[] = ["blue", "sunrise", "sunset", "night"];
const ICON: Record<LightKey, string> = { blue: "🌌", sunrise: "🌅", sunset: "🌇", night: "🌙" };

/** Collapsible "Photo & Light Filters": lighting, long exposure, lens (from the lenses on the map) */
export default function GearFilters({ lenses, inline }: { lenses: { lens: string; count: number }[]; /** Mobile popover: the panel is always shown, without its toggle button */ inline?: boolean }) {
  const gear = useMapStore((s) => s.gear);
  const setGear = useMapStore((s) => s.setGear);
  const [openState, setOpen] = useState(false);
  const open = inline || openState;
  const ref = useRef<HTMLDivElement>(null);
  const active = gearCount(gear);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const toggleLight = (k: LightKey) =>
    setGear({ ...gear, light: gear.light.includes(k) ? gear.light.filter((x) => x !== k) : [...gear.light, k] });
  const chip = (on: boolean) =>
    `rounded-full border px-2.5 py-1 text-xs transition ${on ? "border-amber-300 bg-amber-300 font-semibold text-neutral-900" : "border-white/15 text-neutral-300 hover:bg-white/10"}`;

  return (
    <div ref={ref} className={inline ? "block" : "relative inline-block"}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        hidden={inline}
        className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium shadow-lg backdrop-blur ${active ? "bg-amber-300 text-neutral-900" : "bg-neutral-950/80 text-neutral-200 hover:bg-neutral-900"}`}
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M4 6h16M7 12h10M10 18h4" /></svg>
        Photo &amp; Light Filters{active ? ` · ${active}` : ""}
        <span aria-hidden className={`transition ${open ? "rotate-180" : ""}`}>▾</span>
      </button>

      {open && (
        <div className={inline ? "space-y-3 text-neutral-100" : "absolute left-0 top-full z-30 mt-1.5 w-[min(21rem,calc(100vw-1.5rem))] space-y-3 rounded-2xl border border-white/10 bg-neutral-950/95 p-3 text-neutral-100 shadow-2xl backdrop-blur"}>
          <section>
            <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Lighting (any of)</h3>
            <div className="flex flex-wrap gap-1.5">
              {LIGHTS.map((k) => (
                <button key={k} type="button" aria-pressed={gear.light.includes(k)} onClick={() => toggleLight(k)} className={chip(gear.light.includes(k))}>
                  {ICON[k]} {LIGHT_LABEL[k]}
                </button>
              ))}
            </div>
          </section>

          <section>
            <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Technique</h3>
            <button type="button" aria-pressed={gear.longExposure} onClick={() => setGear({ ...gear, longExposure: !gear.longExposure })} className={chip(gear.longExposure)}>
              ⏱ Long Exposure (1s or longer)
            </button>
          </section>

          <section>
            <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Lens</h3>
            {lenses.length ? (
              <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
                {lenses.map((l) => (
                  <button key={l.lens} type="button" aria-pressed={gear.lens === l.lens} onClick={() => setGear({ ...gear, lens: gear.lens === l.lens ? null : l.lens })} className={chip(gear.lens === l.lens)} title={l.lens}>
                    <span className="inline-block max-w-[12rem] truncate align-bottom">{l.lens}</span> <span className="opacity-60">{l.count}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-neutral-500">No lens data on the pins in view.</p>
            )}
            {gear.lens && !lenses.some((l) => l.lens === gear.lens) && (
              <p className="mt-1 text-[11px] text-neutral-500">Selected: {gear.lens} (not in the current view)</p>
            )}
          </section>

          <div className="flex items-center justify-between border-t border-white/10 pt-2 text-[11px] text-neutral-500">
            <span>Uses each photo&apos;s capture time and EXIF.</span>
            {active > 0 && <button type="button" onClick={() => setGear(EMPTY_GEAR)} className="text-neutral-300 hover:text-white">Reset</button>}
          </div>
        </div>
      )}
    </div>
  );
}
