"use client";

import { memo } from "react";
import { Marker } from "react-map-gl";
import type { Photo } from "@/types/photo";
import { getTimeOfDay } from "@/lib/timeOfDay";
import TimeIcon from "./TimeIcon";

interface Props {
  photo: Photo;
  highlighted: boolean;
  selected: boolean;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
}

/** Story Pin: מסגרת תמונה ממוזערת + "זנב" + תג זמן צילום */
function PhotoPin({ photo, highlighted, selected, onHover, onSelect }: Props) {
  const tod = getTimeOfDay(photo.taken_at, photo.latitude, photo.longitude);
  const active = highlighted || selected;

  return (
    <Marker
      longitude={photo.longitude}
      latitude={photo.latitude}
      anchor="bottom"
      style={{ zIndex: active ? 20 : 1 }}
      onClick={(e) => {
        e.originalEvent.stopPropagation(); // לא להפעיל את ה-click של המפה
        onSelect(photo.id);
      }}
    >
      <button
        type="button"
        aria-label={photo.location_name ?? photo.title ?? "תמונה"}
        onMouseEnter={() => onHover(photo.id)}
        onMouseLeave={() => onHover(null)}
        className="group relative flex cursor-pointer flex-col items-center transition-transform duration-200 ease-out"
        style={{ transform: active ? "translateY(-6px) scale(1.25)" : undefined, transformOrigin: "bottom center" }}
      >
        <span
          className={`block h-12 w-12 overflow-hidden rounded-xl border-[3px] bg-neutral-800 shadow-[0_6px_16px_rgba(0,0,0,0.45)] transition-colors ${
            active ? "border-amber-300" : "border-white"
          }`}
          style={{ transform: "rotate(-3deg)" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo.thumb_url ?? photo.photo_url} alt="" draggable={false} loading="lazy" className="h-full w-full object-cover" />
        </span>
        {/* זנב */}
        <span className={`-mt-1 h-2.5 w-2.5 rotate-45 ${active ? "bg-amber-300" : "bg-white"} shadow`} />
        {tod && <TimeIcon t={tod} size={20} className="absolute -top-2 -end-2" />}
      </button>
    </Marker>
  );
}

export default memo(PhotoPin);
