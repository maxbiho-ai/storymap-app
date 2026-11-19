"use client";

import { useEffect, useState } from "react";
import type { Photo } from "@/types/photo";
import { getTimeOfDay, TIME_OF_DAY_LABEL } from "@/lib/timeOfDay";
import TimeIcon from "./TimeIcon";

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
    // "NIKON CORPORATION NIKON Z 8" → "NIKON Z 8"
    .replace(/^(\w+)( CORPORATION| Corporation)? \1 /i, "$1 ");
}

/** תוכן כרטיסיית התמונה: משותף ל-Popup (דסקטופ) ול-Drawer (מובייל) */
export default function PhotoCard({ photo, onClose }: { photo: Photo; onClose: () => void }) {
  const tod = getTimeOfDay(photo.taken_at, photo.latitude, photo.longitude);
  const camera = cameraLine(photo);
  const exposure = exposureLine(photo);
  const ratio = photo.width && photo.height ? photo.width / photo.height : 3 / 2;
  const images = photo.image_urls?.length ? photo.image_urls : [photo.photo_url];
  const [idx, setIdx] = useState(0);
  const [storyOpen, setStoryOpen] = useState(false);
  useEffect(() => { setIdx(0); setStoryOpen(false); }, [photo.id]);
  const go = (d: number) => setIdx((i) => (i + d + images.length) % images.length);

  return (
    <div dir="rtl" className="overflow-hidden rounded-2xl bg-neutral-950 text-neutral-100">
      <div className="relative max-h-[50dvh]" style={{ aspectRatio: String(Math.max(ratio, 0.8)) }}>
        {/* thumb כ-placeholder מיידי, ומעליו התמונה המלאה */}
        {idx === 0 && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo.thumb_url ?? photo.photo_url} alt="" className="absolute inset-0 h-full w-full scale-105 object-cover blur-sm" />
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img key={images[idx]} src={images[idx]} alt={photo.title ?? ""} className="absolute inset-0 h-full w-full bg-neutral-900 object-cover" />
        {images.length > 1 && (
          <>
            {/* ב-RTL: החץ הימני = הקודמת */}
            <button type="button" onClick={() => go(-1)} aria-label="התמונה הקודמת"
              className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur hover:bg-black/70">›</button>
            <button type="button" onClick={() => go(1)} aria-label="התמונה הבאה"
              className="absolute left-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur hover:bg-black/70">‹</button>
            <div className="absolute inset-x-0 bottom-2 z-10 flex justify-center gap-1.5">
              {images.map((u, i) => (
                <button key={u} type="button" onClick={() => setIdx(i)} aria-label={`תמונה ${i + 1}`}
                  className={`h-1.5 rounded-full transition-all ${i === idx ? "w-4 bg-white" : "w-1.5 bg-white/50"}`} />
              ))}
            </div>
          </>
        )}
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-neutral-950 to-transparent" />
        <button
          type="button"
          onClick={onClose}
          aria-label="סגור"
          className="absolute start-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-lg leading-none text-white backdrop-blur hover:bg-black/70"
        >
          ×
        </button>
        {tod && (
          <span className="absolute end-2 top-2 flex items-center gap-1.5 rounded-full bg-black/50 py-0.5 pe-2.5 ps-0.5 text-xs backdrop-blur">
            <TimeIcon t={tod} size={22} />
            {TIME_OF_DAY_LABEL[tod]}
          </span>
        )}
      </div>

      <div className="space-y-2 px-4 pb-4 pt-1">
        <div>
          <h3 className="text-base font-semibold leading-tight">{photo.location_name ?? photo.title ?? "ללא שם"}</h3>
          {photo.location_name && photo.title && <p className="text-sm text-neutral-400">{photo.title}</p>}
        </div>

        {photo.story && (
          <div>
            <p className={`whitespace-pre-line text-sm leading-relaxed text-neutral-200 ${storyOpen ? "" : "line-clamp-4"}`}>
              {photo.story}
            </p>
            {photo.story.length > 220 && (
              <button type="button" onClick={() => setStoryOpen((o) => !o)} className="mt-1 text-xs text-amber-300 hover:underline">
                {storyOpen ? "הצג פחות" : "קרא עוד"}
              </button>
            )}
          </div>
        )}

        {photo.taken_at && (
          <p className="text-xs text-neutral-400">
            {new Date(photo.taken_at).toLocaleString("he-IL", { dateStyle: "long", timeStyle: "short" })}
          </p>
        )}

        {(camera || exposure || photo.lens) && (
          <div dir="ltr" className="space-y-0.5 rounded-xl bg-white/5 px-3 py-2 text-left font-mono text-[11px] text-neutral-300">
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
    </div>
  );
}
