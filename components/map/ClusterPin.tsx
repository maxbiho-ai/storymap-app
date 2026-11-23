"use client";

import { memo } from "react";
import { Marker } from "react-map-gl";
import type { Pin } from "@/lib/pins";

interface Props {
  longitude: number;
  latitude: number;
  count: number;
  preview: Pin[];
  onClick: () => void;
  /** Edit-GPS mode: context only, not clickable */
  dimmed?: boolean;
}

/** קבוצת תמונות: "ערימת" עד 3 תמונות מוטות + מונה */
function ClusterPin({ longitude, latitude, count, preview, onClick, dimmed }: Props) {
  const size = count < 10 ? 52 : count < 50 ? 60 : 68;
  const tilts = [-10, 6, -2];

  return (
    <Marker
      longitude={longitude}
      latitude={latitude}
      anchor="center"
      style={{ opacity: dimmed ? 0.35 : 1, pointerEvents: dimmed ? "none" : undefined }}
      onClick={(e) => {
        e.originalEvent.stopPropagation();
        onClick();
      }}
    >
      <button
        type="button"
        aria-label={`${count} photos, click to browse`}
        className="relative cursor-pointer transition-transform hover:scale-110"
        style={{ width: size, height: size }}
      >
        {preview.map((p, i) => (
          <span
            key={p.id}
            className="absolute inset-0 overflow-hidden rounded-xl border-[3px] border-white bg-neutral-800 shadow-[0_6px_16px_rgba(0,0,0,0.45)]"
            style={{ transform: `rotate(${tilts[i]}deg) translate(${(i - 1) * 3}px, ${-i * 2}px)`, zIndex: i }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.thumb_url ?? p.photo_url} alt="" draggable={false} loading="lazy" className="h-full w-full object-cover" />
          </span>
        ))}
        <span className="absolute -top-2 -end-2 z-10 min-w-[24px] rounded-full bg-amber-300 px-1.5 py-0.5 text-center text-xs font-bold text-neutral-900 shadow ring-2 ring-white">
          {count > 999 ? "999+" : count}
        </span>
      </button>
    </Marker>
  );
}

export default memo(ClusterPin);
