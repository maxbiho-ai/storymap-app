"use client";

import { memo } from "react";
import { Marker } from "react-map-gl";

interface Props {
  longitude: number;
  latitude: number;
  count: number;
  active?: boolean;
  /** Edit-GPS mode: context only, not clickable */
  dimmed?: boolean;
  onClick: () => void;
  onHover: (h: boolean) => void;
}

/** Pins / Dots mode: a glowing circular marker scaled by photo count, with the count inside */
function DotPin({ longitude, latitude, count, active, dimmed, onClick, onHover }: Props) {
  const size = count <= 1 ? 16 : Math.round(Math.min(58, 24 + Math.log2(count) * 6.5));
  return (
    <Marker
      longitude={longitude}
      latitude={latitude}
      anchor="center"
      style={{ zIndex: active ? 20 : 2, opacity: dimmed ? 0.35 : 1, pointerEvents: dimmed ? "none" : undefined }}
      onClick={(e) => {
        e.originalEvent.stopPropagation();
        onClick();
      }}
    >
      <button
        type="button"
        aria-label={`${count} photo${count === 1 ? "" : "s"}`}
        onMouseEnter={() => onHover(true)}
        onMouseLeave={() => onHover(false)}
        className="flex cursor-pointer items-center justify-center rounded-full border-2 text-[11px] font-bold leading-none tabular-nums transition-transform duration-150 hover:scale-110"
        style={{
          width: size,
          height: size,
          color: "#1c1917",
          background: active ? "radial-gradient(circle at 35% 30%, #fffbeb, #fcd34d)" : "radial-gradient(circle at 35% 30%, #fde68a, #f59e0b)",
          borderColor: active ? "#fff" : "rgba(255,255,255,0.85)",
          boxShadow: `0 0 ${Math.round(size * 0.45)}px ${Math.round(size * 0.12)}px rgba(251,191,36,${active ? 0.75 : 0.45}), 0 2px 6px rgba(0,0,0,0.5)`,
        }}
      >
        {count > 1 ? (count > 9999 ? "9k+" : count) : null}
      </button>
    </Marker>
  );
}

export default memo(DotPin);
