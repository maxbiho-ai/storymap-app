"use client";

import { useEffect, useRef } from "react";
import { Popup } from "react-map-gl";
import type { Photo } from "@/types/photo";
import PhotoCard from "./PhotoCard";

interface Props {
  photo: Photo;
  stack?: Photo[];
  onClose: () => void;
  /** Tallest the card may be: it scrolls inside, so the top bar (photographer + X) never leaves the screen */
  maxHeight?: number;
  /** Reports the rendered card height, so the map can pan the whole card into view */
  onHeight?: (h: number) => void;
}

/** דסקטופ: הכרטיסייה צפה מעל ה-Pin */
export default function PhotoPopup({ photo, stack, onClose, maxHeight, onHeight }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !onHeight) return;
    onHeight(el.offsetHeight);
    const ro = new ResizeObserver(() => onHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [onHeight]);

  return (
    <Popup
      longitude={photo.longitude}
      latitude={photo.latitude}
      anchor="bottom"
      offset={70}
      closeButton={false}
      closeOnClick={false}
      onClose={onClose}
      maxWidth="340px"
      className="storymap-popup"
    >
      <div ref={ref} className="w-[340px] overflow-y-auto overscroll-contain rounded-2xl shadow-2xl" style={{ maxHeight }}>
        <PhotoCard photo={photo} stack={stack} onClose={onClose} />
      </div>
    </Popup>
  );
}
