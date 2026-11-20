"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface Props {
  images: string[];
  startIndex: number;
  alt?: string;
  caption?: string | null;
  onClose: () => void;
}

/**
 * Fullscreen view. Rendered into <body> through a portal: the Mapbox popup uses CSS transforms,
 * which would otherwise trap position: fixed inside the small popup box.
 * Keys: ← → to navigate, Esc to close (without also closing the card underneath).
 */
export default function Lightbox({ images, startIndex, alt = "", caption, onClose }: Props) {
  const [idx, setIdx] = useState(startIndex);
  const touchX = useRef<number | null>(null);
  const many = images.length > 1;
  const go = (d: number) => setIdx((i) => (i + d + images.length) % images.length);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!["Escape", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
      e.stopImmediatePropagation(); // capture phase: the map's Esc handler never sees it
      e.preventDefault();
      if (e.key === "Escape") onClose();
      if (many && e.key === "ArrowLeft") go(-1);
      if (many && e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true });
      document.body.style.overflow = prevOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [many, onClose]);

  const arrow = "absolute top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-2xl text-white backdrop-blur hover:bg-white/20";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Photo viewer"
      className="fixed inset-0 z-[100] flex flex-col bg-black/95"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        if (touchX.current == null || !many) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
        touchX.current = null;
      }}
    >
      <div className="flex items-center justify-between px-4 py-3 text-sm text-white/70">
        <span>{many ? `${idx + 1} / ${images.length}` : ""}</span>
        <button type="button" onClick={onClose} aria-label="Close" className="flex h-10 w-10 items-center justify-center rounded-full text-3xl leading-none text-white hover:bg-white/10">
          ×
        </button>
      </div>

      <div className="relative min-h-0 flex-1" onClick={(e) => e.target === e.currentTarget && onClose()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={images[idx]}
          src={images[idx]}
          alt={alt}
          className="absolute inset-0 m-auto max-h-full max-w-full object-contain"
          onClick={(e) => e.stopPropagation()}
        />
        {many && (
          <>
            <button type="button" onClick={() => go(-1)} aria-label="Previous photo" className={`${arrow} left-3`}>‹</button>
            <button type="button" onClick={() => go(1)} aria-label="Next photo" className={`${arrow} right-3`}>›</button>
          </>
        )}
      </div>

      {caption && <p className="mx-auto max-w-3xl px-6 py-4 text-center text-sm text-white/80">{caption}</p>}
    </div>,
    document.body,
  );
}
