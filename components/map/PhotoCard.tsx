"use client";

import { useEffect, useState } from "react";
import type { Photo } from "@/types/photo";
import { getTimeOfDay, TIME_OF_DAY_LABEL } from "@/lib/timeOfDay";
import { formatTakenAt } from "@/lib/time";
import { useMapStore } from "@/store/mapStore";
import TimeIcon from "./TimeIcon";
import Lightbox from "./Lightbox";

function exposureLine(p: Photo): string {
  return [
    p.focal_length && `${Number(p.focal_length)}mm`,
    p.aperture && `f/${Number(p.aperture)}`,
    p.shutter_speed,
    p.iso && `ISO ${p.iso}`,
  ].filter(Boolean).join("  ·  ");
}

function cameraLine(p: Photo): string {
  return [p.camera_make, p.camera_model]
    .filter(Boolean)
    .join(" ")
    // "NIKON CORPORATION NIKON Z 7_2" → "NIKON Z 7_2"
    .replace(/^(\w+)( CORPORATION| Corporation)? \1 /i, "$1 ");
}

/** The pin's detail card: shared by the desktop popup and the mobile drawer */
export default function PhotoCard({ photo, onClose }: { photo: Photo; onClose: () => void }) {
  const setPhotographer = useMapStore((s) => s.setPhotographer);
  const activePhotographer = useMapStore((s) => s.filters.photographer);

  const tod = getTimeOfDay(photo.taken_at, photo.latitude, photo.longitude);
  const camera = cameraLine(photo);
  const exposure = exposureLine(photo);
  const ratio = photo.width && photo.height ? photo.width / photo.height : 3 / 2;
  const images = photo.image_urls?.length ? photo.image_urls : [photo.photo_url];
  const when = formatTakenAt(photo.taken_at, photo.taken_tz);
  const heading = photo.location_name ?? photo.title ?? "Untitled";
  const tooltip = photo.location_name && photo.title ? photo.title : null;
  const body = photo.description ?? photo.story;

  const [idx, setIdx] = useState(0);
  const [bodyOpen, setBodyOpen] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  useEffect(() => { setIdx(0); setBodyOpen(false); setLightbox(false); }, [photo.id]);
  const go = (d: number) => setIdx((i) => (i + d + images.length) % images.length);

  const filterByPhotographer = () => {
    if (!photo.photographer_name) return;
    setPhotographer(activePhotographer === photo.photographer_name ? null : photo.photographer_name);
  };

  return (
    <div className="overflow-hidden rounded-2xl bg-neutral-950 text-neutral-100">
      <div className="relative max-h-[50dvh]" style={{ aspectRatio: String(Math.max(ratio, 0.8)) }}>
        {idx === 0 && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo.thumb_url ?? photo.photo_url} alt="" className="absolute inset-0 h-full w-full scale-105 object-cover blur-sm" />
        )}
        <button type="button" onClick={() => setLightbox(true)} className="absolute inset-0 cursor-zoom-in" aria-label="Open photo full screen">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img key={images[idx]} src={images[idx]} alt={photo.title ?? heading} className="h-full w-full bg-neutral-900 object-cover" />
        </button>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-neutral-950 to-transparent" />

        {/* Photographer badge: click → only this photographer's photos */}
        {photo.photographer_name && (
          <button
            type="button"
            onClick={filterByPhotographer}
            title={activePhotographer === photo.photographer_name ? "Show all photographers" : `Show only photos by ${photo.photographer_name}`}
            className={`absolute left-2 top-2 max-w-[70%] truncate rounded-full px-3 py-1 text-xs font-medium backdrop-blur transition ${
              activePhotographer === photo.photographer_name ? "bg-amber-300 text-neutral-900" : "bg-black/55 text-white hover:bg-black/75"
            }`}
          >
            {photo.photographer_name}
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-lg leading-none text-white backdrop-blur hover:bg-black/75"
        >
          ×
        </button>

        {images.length > 1 && (
          <>
            <button type="button" onClick={() => go(-1)} aria-label="Previous photo"
              className="absolute left-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur hover:bg-black/70">‹</button>
            <button type="button" onClick={() => go(1)} aria-label="Next photo"
              className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur hover:bg-black/70">›</button>
            <div className="absolute inset-x-0 bottom-2 z-10 flex justify-center gap-1.5">
              {images.map((u, i) => (
                <button key={u} type="button" onClick={() => setIdx(i)} aria-label={`Photo ${i + 1}`}
                  className={`h-1.5 rounded-full transition-all ${i === idx ? "w-4 bg-white" : "w-1.5 bg-white/50"}`} />
              ))}
            </div>
          </>
        )}
      </div>

      <div className="space-y-2 px-4 pb-4 pt-1">
        {/* Location name; the title shows as a tooltip on hover */}
        <div className="group/loc relative inline-block max-w-full">
          <h3 className={`truncate text-base font-semibold leading-tight ${tooltip ? "cursor-help underline decoration-white/25 decoration-dotted underline-offset-4" : ""}`} tabIndex={tooltip ? 0 : -1}>
            {heading}
          </h3>
          {tooltip && (
            <span
              role="tooltip"
              className="pointer-events-none absolute bottom-full left-0 z-20 mb-2 w-max max-w-[280px] rounded-lg bg-white px-3 py-1.5 text-xs font-medium leading-snug text-neutral-900 opacity-0 shadow-xl transition-opacity duration-150 group-hover/loc:opacity-100 group-focus-within/loc:opacity-100"
            >
              {tooltip}
            </span>
          )}
        </div>

        {when && (
          <p className="flex items-center gap-1.5 text-xs text-neutral-400">
            {tod && <TimeIcon t={tod} size={16} />}
            {when}
            {tod && <span className="text-neutral-500">· {TIME_OF_DAY_LABEL[tod]}</span>}
          </p>
        )}

        {body && (
          <div>
            <p className={`whitespace-pre-line text-sm leading-relaxed text-neutral-200 ${bodyOpen ? "" : "line-clamp-4"}`}>{body}</p>
            {body.length > 220 && (
              <button type="button" onClick={() => setBodyOpen((o) => !o)} className="mt-1 text-xs text-amber-300 hover:underline">
                {bodyOpen ? "Show less" : "Read more"}
              </button>
            )}
          </div>
        )}

        {(camera || exposure || photo.lens) && (
          <div className="space-y-0.5 rounded-xl bg-white/5 px-3 py-2 font-mono text-[11px] text-neutral-300">
            {camera && <div className="truncate">{camera}</div>}
            {photo.lens && <div className="truncate text-neutral-400">{photo.lens}</div>}
            {exposure && <div className="text-amber-200/90">{exposure}</div>}
          </div>
        )}

        {photo.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {photo.tags.map((t) => (
              <span key={t} className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-neutral-300">#{t}</span>
            ))}
          </div>
        )}
      </div>

      {lightbox && (
        <Lightbox images={images} startIndex={idx} alt={photo.title ?? heading} caption={photo.title} onClose={() => setLightbox(false)} />
      )}
    </div>
  );
}
