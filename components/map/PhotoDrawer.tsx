"use client";

import { useRef, useState } from "react";
import type { Photo } from "@/types/photo";
import PhotoCard from "./PhotoCard";

type Snap = "half" | "full";
/** Sheet height as a share of the screen: half keeps the pin and the sun compass visible above it */
const HEIGHT: Record<Snap, number> = { half: 50, full: 92 };
const DRAG_THRESHOLD = 48;

/**
 * Mobile photo sheet: opens at ~50% of the screen, drag the handle up to expand to full height, down to go back
 * to half and once more to dismiss (or tap ×). The content scrolls inside; swiping the photo itself cycles the cluster.
 */
export default function PhotoDrawer({ photo, stack, onClose }: { photo: Photo; stack?: Photo[]; onClose: () => void }) {
  const [snap, setSnap] = useState<Snap>("half");
  const [dy, setDy] = useState(0);
  const start = useRef<{ y: number; id: number } | null>(null);

  const heightPct = Math.min(96, Math.max(8, HEIGHT[snap] - (dy / (typeof window === "undefined" ? 800 : window.innerHeight)) * 100));

  const end = () => {
    if (!start.current) return;
    const moved = dy;
    start.current = null;
    setDy(0);
    if (Math.abs(moved) < 6) setSnap((s) => (s === "half" ? "full" : "half")); // a tap on the handle toggles
    else if (moved <= -DRAG_THRESHOLD) setSnap("full");
    else if (moved >= DRAG_THRESHOLD) {
      if (snap === "full") setSnap("half");
      else onClose();
    }
  };

  return (
    <div data-photo-drawer className="absolute inset-x-0 bottom-0 z-40 md:hidden">
      <div
        className={`flex min-w-0 flex-col overflow-hidden rounded-t-3xl bg-neutral-950 shadow-[0_-8px_30px_rgba(0,0,0,0.5)] ${start.current ? "" : "transition-[height] duration-200"}`}
        style={{ height: `${heightPct}dvh`, paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div
          role="button"
          tabIndex={0}
          aria-label={snap === "half" ? "Expand photo details" : "Collapse photo details"}
          className="flex h-8 shrink-0 cursor-grab touch-none items-center justify-center"
          onPointerDown={(e) => {
            start.current = { y: e.clientY, id: e.pointerId };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => start.current && setDy(e.clientY - start.current.y)}
          onPointerUp={end}
          onPointerCancel={end}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setSnap((s) => (s === "half" ? "full" : "half"))}
        >
          <span className="h-1.5 w-12 rounded-full bg-white/30" />
        </div>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain">
          <PhotoCard photo={photo} stack={stack} onClose={onClose} />
        </div>
      </div>
    </div>
  );
}
