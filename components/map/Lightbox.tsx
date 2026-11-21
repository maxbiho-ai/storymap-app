"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Photo } from "@/types/photo";
import { useMapStore } from "@/store/mapStore";
import SocialActions from "@/components/social/SocialActions";
import CommentsSection from "@/components/social/CommentsSection";
import DeleteDialog from "@/components/social/DeleteDialog";

export interface Slide {
  src: string;
  alt?: string;
  caption?: string | null;
  /** Full place name, shown untruncated above the caption */
  location?: string | null;
  /** The photo this image belongs to: enables like / save / comments / owner delete */
  photo?: Photo;
  /** Index of this image inside photo.image_urls */
  imageIndex?: number;
}

/** Typing in a field, or a confirm dialog on top: the viewer leaves the keys alone */
function keysBelongElsewhere(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return true;
  return Boolean(document.querySelector("[role=alertdialog]"));
}

interface Props {
  slides: Slide[];
  startIndex: number;
  onClose: () => void;
}

/**
 * Full-screen viewer. Rendered into <body> through a portal: the Mapbox popup uses CSS transforms,
 * which would otherwise trap position: fixed inside the small popup box.
 * The image is scaled up to fill 95vw × 92vh (object-contain), even when the file is smaller.
 * Keys: ← → to navigate, Esc to close (without also closing the card underneath).
 */
export default function Lightbox({ slides, startIndex, onClose }: Props) {
  const [idx, setIdx] = useState(Math.min(startIndex, slides.length - 1));
  const touchX = useRef<number | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const many = slides.length > 1;
  const go = useCallback((d: number) => setIdx((i) => (i + d + slides.length) % slides.length), [slides.length]);
  const slide = slides[Math.min(idx, slides.length - 1)];
  const me = useMapStore((s) => s.currentUserId);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const photo = slide?.photo;
  const isOwner = Boolean(photo && me && me === photo.user_id);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!["Escape", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
      if (keysBelongElsewhere(e)) return;
      e.stopImmediatePropagation(); // capture phase: the map's Esc handler never sees it
      e.preventDefault();
      if (e.key === "Escape") onClose();
      if (many && e.key === "ArrowLeft") go(-1);
      if (many && e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true });
      document.body.style.overflow = prevOverflow;
    };
  }, [many, onClose, go]);

  // Preload neighbours so arrow navigation is instant
  useEffect(() => {
    if (!many) return;
    for (const d of [-1, 1]) {
      const img = new Image();
      img.src = slides[(idx + d + slides.length) % slides.length].src;
    }
  }, [idx, many, slides]);

  const arrow = "absolute top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-3xl leading-none text-white backdrop-blur transition hover:bg-black/80";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Photo viewer"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        if (touchX.current == null || !many) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
        touchX.current = null;
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={slide.src}
        src={slide.src}
        alt={slide.alt ?? ""}
        className="h-[92vh] w-[95vw] max-h-[92vh] max-w-[95vw] select-none object-contain"
        draggable={false}
      />

      {/* Top bar: counter + close */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent px-4 py-3 text-sm text-white/80">
        <span className="tabular-nums">{many ? `${idx + 1} / ${slides.length}` : ""}</span>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close (Esc)"
          className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-3xl leading-none text-white backdrop-blur hover:bg-white/20"
        >
          ×
        </button>
      </div>

      {many && (
        <>
          <button type="button" onClick={() => go(-1)} aria-label="Previous photo" className={`${arrow} left-3`}>‹</button>
          <button type="button" onClick={() => go(1)} aria-label="Next photo" className={`${arrow} right-3`}>›</button>
        </>
      )}

      {photo && (
        <div className="absolute left-3 top-14 z-20 w-[min(22rem,calc(100vw-1.5rem))]">
          <SocialActions
            photoId={photo.id}
            tone="overlay"
            commentsOpen={commentsOpen}
            onToggleComments={() => setCommentsOpen((o) => !o)}
            onDelete={isOwner ? () => setDeleting(true) : undefined}
          />
        </div>
      )}

      {photo && commentsOpen && (
        <aside onTouchStart={(e) => e.stopPropagation()} onTouchEnd={(e) => e.stopPropagation()} className="absolute inset-x-0 bottom-0 z-20 max-h-[70vh] overflow-y-auto rounded-t-2xl bg-neutral-950/95 p-4 text-neutral-100 shadow-2xl backdrop-blur sm:inset-x-auto sm:bottom-0 sm:right-0 sm:top-16 sm:max-h-none sm:w-96 sm:rounded-none sm:rounded-tl-2xl">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Comments &amp; questions</p>
            <button type="button" onClick={() => setCommentsOpen(false)} aria-label="Close comments" className="text-xl leading-none text-neutral-400 hover:text-white">×</button>
          </div>
          <CommentsSection photoId={photo.id} ownerId={photo.user_id} tall />
        </aside>
      )}

      {photo && deleting && (
        <DeleteDialog
          photo={photo}
          imageIndex={Math.min(slide.imageIndex ?? 0, Math.max(0, (photo.image_urls?.length ?? 1) - 1))}
          onClose={() => setDeleting(false)}
          onDeleted={() => {
            setDeleting(false);
            onClose();
          }}
        />
      )}

      {(slide.caption || slide.location) && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-6 pb-5 pt-10 text-center">
          {slide.location && <p className="break-words text-xs font-medium text-white/65">📍 {slide.location}</p>}
          {slide.caption && <p className="mt-0.5 text-sm text-white/90">{slide.caption}</p>}
        </div>
      )}
    </div>,
    document.body,
  );
}
