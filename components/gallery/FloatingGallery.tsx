"use client";

import { useMemo, useState } from "react";
import { useMap } from "react-map-gl";
import type { Photo } from "@/types/photo";
import { useMapStore, inBounds } from "@/store/mapStore";
import { getTimeOfDay } from "@/lib/timeOfDay";
import TimeIcon from "@/components/map/TimeIcon";
import { MAP_ID } from "@/components/map/constants";

interface Props {
  photos: Photo[];
  loading?: boolean;
}

/**
 * Floating Canvas: הגלריה של מה שנראה כרגע במפה.
 * דסקטופ — פאנל צף בצד; מובייל — bottom sheet מתקפל.
 */
export default function FloatingGallery({ photos, loading }: Props) {
  const { [MAP_ID]: map } = useMap();
  const bounds = useMapStore((s) => s.bounds);
  const hoveredId = useMapStore((s) => s.hoveredId);
  const setHovered = useMapStore((s) => s.setHovered);
  const selectedId = useMapStore((s) => s.selectedId);
  const select = useMapStore((s) => s.select);
  const pickMode = useMapStore((s) => s.pickMode);
  const [open, setOpen] = useState(true);

  // השאילתה טוענת עם ריפוד של 25%; הגלריה מציגה רק את מה שבאמת על המסך
  const visible = useMemo(
    () => (bounds ? photos.filter((p) => inBounds(bounds, p.latitude, p.longitude)) : photos),
    [photos, bounds],
  );

  const flyTo = (p: Photo) => {
    select(p.id);
    const zoom = Math.max(map?.getZoom() ?? 0, 13);
    map?.flyTo({ center: [p.longitude, p.latitude], zoom, speed: 1.4, curve: 1.5, essential: true });
    // במובייל — מקפלים כדי לראות את המפה
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) setOpen(false);
  };

  if (pickMode) return null;

  return (
    <aside
      dir="rtl"
      aria-label="תמונות באזור"
      className={`pointer-events-auto absolute z-10 flex flex-col overflow-hidden border border-white/10 bg-neutral-950/80 text-neutral-100 shadow-2xl backdrop-blur-xl transition-[height] duration-300
        inset-x-0 bottom-0 rounded-t-3xl ${open ? "h-[45dvh]" : "h-16"}
        md:inset-x-auto md:bottom-4 md:start-4 md:top-36 md:h-auto md:w-[340px] md:rounded-3xl ${open ? "" : "md:bottom-auto md:h-14"}`}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex shrink-0 items-center justify-between gap-2 px-5 py-4 text-start"
        aria-expanded={open}
      >
        <span className="absolute inset-x-0 top-1.5 mx-auto h-1 w-10 rounded-full bg-white/20 md:hidden" />
        <span className="text-sm font-semibold">
          באזור הזה
          <span className="ms-2 font-normal text-neutral-400">{visible.length} תמונות</span>
        </span>
        <span className="flex items-center gap-2">
          {loading && <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />}
          <svg viewBox="0 0 20 20" className={`h-4 w-4 fill-neutral-400 transition-transform ${open ? "" : "rotate-180"}`} aria-hidden>
            <path d="M5.3 7.3a1 1 0 011.4 0L10 10.6l3.3-3.3a1 1 0 111.4 1.4l-4 4a1 1 0 01-1.4 0l-4-4a1 1 0 010-1.4z" />
          </svg>
        </span>
      </button>

      {open && (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4">
          {visible.length === 0 ? (
            <p className="px-2 py-10 text-center text-sm text-neutral-400">
              {loading ? "טוען…" : "אין תמונות באזור הזה. הזז את המפה או התרחק."}
            </p>
          ) : (
            <ul className="grid grid-cols-3 gap-2 md:grid-cols-2">
              {visible.map((p) => {
                const tod = getTimeOfDay(p.taken_at, p.latitude, p.longitude);
                const active = hoveredId === p.id || selectedId === p.id;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onMouseEnter={() => setHovered(p.id)}
                      onMouseLeave={() => setHovered(null)}
                      onFocus={() => setHovered(p.id)}
                      onBlur={() => setHovered(null)}
                      onClick={() => flyTo(p)}
                      className={`group relative block aspect-square w-full overflow-hidden rounded-xl bg-neutral-800 outline-none transition ${
                        active ? "ring-2 ring-amber-300 ring-offset-2 ring-offset-neutral-950" : "ring-0"
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={p.thumb_url ?? p.photo_url}
                        alt={p.title ?? p.location_name ?? ""}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 pb-1.5 pt-6 text-start text-[11px] leading-tight text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus:opacity-100">
                        {p.location_name ?? p.title ?? ""}
                      </span>
                      {tod && <TimeIcon t={tod} size={18} className="absolute end-1.5 top-1.5" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </aside>
  );
}
