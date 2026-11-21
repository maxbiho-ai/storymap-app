"use client";

import { memo } from "react";
import { Marker } from "react-map-gl";
import type { Photo } from "@/types/photo";
import { getTimeOfDay } from "@/lib/timeOfDay";
import TimeIcon from "./TimeIcon";

interface Props {
  photo: Photo;
  /** Photos/images in this pin (1 = a plain pin) */
  count?: number;
  /** Shown in the badge: "+2" or "2/3" when a stack member is selected */
  position?: number;
  highlighted: boolean;
  selected: boolean;
  /** Edit-GPS mode: other pins are context only, not clickable */
  dimmed?: boolean;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
}

/** Story Pin: thumbnail frame + tail + time-of-day badge; a card pile behind it when the pin holds several photos */
function PhotoPin({ photo, count = 1, position, highlighted, selected, dimmed, onHover, onSelect }: Props) {
  const tod = getTimeOfDay(photo.taken_at, photo.latitude, photo.longitude);
  const active = highlighted || selected;
  const many = count > 1;
  const frame = active ? "border-amber-300" : "border-white";

  return (
    <Marker
      longitude={photo.longitude}
      latitude={photo.latitude}
      anchor="bottom"
      style={{ zIndex: active ? 20 : 1, opacity: dimmed ? 0.35 : 1, pointerEvents: dimmed ? "none" : undefined }}
      onClick={(e) => {
        e.originalEvent.stopPropagation(); // don't trigger the map click
        onSelect(photo.id);
      }}
    >
      <button
        type="button"
        aria-label={`${photo.location_name ?? photo.title ?? "Photo"}${many ? `, ${count} photos` : ""}`}
        onMouseEnter={() => onHover(photo.id)}
        onMouseLeave={() => onHover(null)}
        className="group relative flex cursor-pointer flex-col items-center transition-transform duration-200 ease-out"
        style={{ transform: active ? "translateY(-6px) scale(1.25)" : undefined, transformOrigin: "bottom center" }}
      >
        <span className="relative block h-12 w-12">
          {many && (
            <>
              {/* Stacked cards behind the thumbnail */}
              <span className={`absolute inset-0 rounded-xl border-[3px] ${frame} bg-neutral-700 shadow-md`} style={{ transform: "rotate(9deg) translate(6px, -3px)" }} />
              <span className={`absolute inset-0 rounded-xl border-[3px] ${frame} bg-neutral-600 shadow-md`} style={{ transform: "rotate(3deg) translate(3px, -2px)" }} />
            </>
          )}
          <span
            className={`absolute inset-0 overflow-hidden rounded-xl border-[3px] bg-neutral-800 shadow-[0_6px_16px_rgba(0,0,0,0.45)] transition-colors ${frame}`}
            style={{ transform: "rotate(-3deg)" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.thumb_url ?? photo.photo_url} alt="" draggable={false} loading="lazy" className="h-full w-full object-cover" />
          </span>
        </span>
        {/* Tail */}
        <span className={`-mt-1 h-2.5 w-2.5 rotate-45 ${active ? "bg-amber-300" : "bg-white"} shadow`} />
        {tod && <TimeIcon t={tod} size={20} className="absolute -top-2 -end-2" />}
        {many && (
          <span className="absolute -start-2.5 -top-2 z-10 flex h-5 min-w-[22px] items-center justify-center gap-0.5 rounded-full bg-neutral-950 px-1.5 text-[10px] font-bold leading-none text-white shadow ring-2 ring-white">
            <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <rect x="4" y="1" width="11" height="11" rx="2" opacity=".55" />
              <rect x="1" y="4" width="11" height="11" rx="2" />
            </svg>
            {position ? `${position}/${count}` : `+${count - 1}`}
          </span>
        )}
      </button>
    </Marker>
  );
}

export default memo(PhotoPin);
