"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Photo } from "@/types/photo";
import { getSolarPhase, solarPhaseLabel } from "@/lib/timeOfDay";
import { formatTakenAt } from "@/lib/time";
import { formatLatLng, reverseGeocode, type PlaceSuggestion } from "@/lib/geocode";
import { copyText, updateOwnPhoto } from "@/lib/photoEdits";
import { useMapStore } from "@/store/mapStore";
import LocationAutocomplete, { PlaceChips } from "@/components/LocationAutocomplete";
import TimeIcon from "./TimeIcon";
import Lightbox, { type Slide } from "./Lightbox";
import SocialActions from "@/components/social/SocialActions";
import CommentsSection from "@/components/social/CommentsSection";
import DeleteDialog from "@/components/social/DeleteDialog";
import FieldNotes from "./FieldNotes";
import LightPlanner from "./LightPlanner";
import GpsInlineEditor from "./GpsInlineEditor";
import ReportButton from "./ReportButton";
import { streetViewUrl } from "@/lib/walk";

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

const imagesOf = (p: Photo) => (p.image_urls?.length ? p.image_urls : [p.photo_url]);

/* ---------- small icons ---------- */
const Icon = {
  copy: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </svg>
  ),
  check: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  ),
  pencil: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
    </svg>
  ),
  info: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
    </svg>
  ),
  street: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="5" r="2.5" /><path d="M12 9v6M8 21l4-6 4 6M7 12h10" />
    </svg>
  ),
  gps: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21s-7-6.2-7-11.5A7 7 0 0119 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" />
    </svg>
  ),
};

function IconButton({ label, onClick, children, active }: { label: string; onClick: () => void; children: React.ReactNode; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition max-md:h-10 max-md:w-10 ${
        active ? "bg-emerald-400/15 text-emerald-300" : "text-neutral-400 hover:bg-white/10 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

interface Props {
  photo: Photo;
  /** Every photo on this pin (same point), including `photo` */
  stack?: Photo[];
  onClose: () => void;
}

/** The pin's detail card: shared by the desktop popup and the mobile drawer */
export default function PhotoCard({ photo, stack: stackProp, onClose }: Props) {
  const setPhotographer = useMapStore((s) => s.setPhotographer);
  const activePhotographer = useMapStore((s) => s.filters.photographer);
  const select = useMapStore((s) => s.select);
  const exactGps = useMapStore((s) => s.exactGps);
  const setExactGps = useMapStore((s) => s.setExactGps);
  const currentUserId = useMapStore((s) => s.currentUserId);
  const walk = useMapStore((s) => s.walk);
  const startWalk = useMapStore((s) => s.startWalk);
  const endWalk = useMapStore((s) => s.endWalk);
  const walking = walk?.origin.id === photo.id;
  const commentsFor = useMapStore((s) => s.commentsFor);
  const openComments = useMapStore((s) => s.openComments);
  const isOwner = Boolean(currentUserId && currentUserId === photo.user_id);

  const stack = stackProp?.length ? stackProp : [photo];
  const solar = getSolarPhase(photo.taken_at, photo.latitude, photo.longitude);
  const tod = solar?.phase ?? null;
  const camera = cameraLine(photo);
  const exposure = exposureLine(photo);
  const ratio = photo.width && photo.height ? photo.width / photo.height : 3 / 2;
  const images = imagesOf(photo);
  const when = formatTakenAt(photo.taken_at, photo.taken_tz);
  const heading = photo.location_name ?? photo.title ?? "Untitled";
  const tipTitle = photo.location_name && photo.title ? photo.title : null;
  const body = photo.description ?? photo.story;
  const hasTip = Boolean(tipTitle || body);
  const coords = formatLatLng(photo.latitude, photo.longitude);

  // Every image of every photo on this pin, as one sequence
  const slides = useMemo(
    () => stack.flatMap((p) => imagesOf(p).map((src, i) => ({ photoId: p.id, photo: p, i, src, alt: p.title ?? p.location_name ?? "", caption: p.title, location: p.location_name }))),
    [stack],
  );
  const offset = slides.findIndex((s) => s.photoId === photo.id);

  const swipe = useRef<{ x: number; y: number } | null>(null);
  const [idx, setIdx] = useState(0);
  const pendingIdx = useRef<number | null>(null);
  const [lightbox, setLightbox] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [tipBelow, setTipBelow] = useState(false);
  const [copied, setCopied] = useState<"loc" | "gps" | null>(null);
  const [editLoc, setEditLoc] = useState(false);
  const [editGps, setEditGps] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Opened from a notification: show the thread with the composer focused
  const fromNotification = commentsFor === photo.id;
  useEffect(() => {
    if (fromNotification) setCommentsOpen(true);
  }, [fromNotification]);
  // An image of the post was deleted: stay inside the remaining ones
  useEffect(() => {
    setIdx((i) => Math.min(i, images.length - 1));
  }, [images.length]);

  useEffect(() => {
    setIdx(pendingIdx.current ?? 0);
    pendingIdx.current = null;
    setInfoOpen(false);
    setEditLoc(false);
    setEditGps(false);
    setCommentsOpen(false);
    setDeleting(false);
  }, [photo.id]);

  const global = Math.max(0, offset) + idx;
  const goTo = (g: number) => {
    const n = (g + slides.length) % slides.length;
    const s = slides[n];
    if (s.photoId === photo.id) setIdx(s.i);
    else {
      pendingIdx.current = s.i;
      select(s.photoId);
    }
  };

  const copy = async (what: "loc" | "gps", text: string) => {
    if (await copyText(text)) {
      setCopied(what);
      setTimeout(() => setCopied((c) => (c === what ? null : c)), 1500);
    }
  };

  const filterByPhotographer = () => {
    if (!photo.photographer_name) return;
    setPhotographer(activePhotographer === photo.photographer_name ? null : photo.photographer_name);
  };

  const lightboxSlides: Slide[] = slides.map((s) => ({ src: s.src, alt: s.alt, caption: s.caption, location: s.location, photo: s.photo, imageIndex: s.i }));
  const stackPos = stack.length > 1 ? stack.findIndex((p) => p.id === photo.id) + 1 : 0;

  return (
    <div className="rounded-2xl bg-neutral-950 text-neutral-100">
      <div
        className="relative max-h-[50dvh] touch-pan-y overflow-hidden rounded-t-2xl max-md:max-h-[34dvh] max-md:rounded-t-none"
        style={{ aspectRatio: String(Math.max(ratio, 0.8)) }}
        onTouchStart={(e) => { swipe.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
        onTouchEnd={(e) => {
          const s0 = swipe.current;
          swipe.current = null;
          if (!s0 || slides.length < 2) return;
          const dx = e.changedTouches[0].clientX - s0.x;
          const dy = e.changedTouches[0].clientY - s0.y;
          if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) goTo(global + (dx < 0 ? 1 : -1));
        }}
      >
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
          className="absolute right-2 top-2 flex h-8 w-8 max-md:h-10 max-md:w-10 items-center justify-center rounded-full bg-black/55 text-lg leading-none text-white backdrop-blur hover:bg-black/75"
        >
          ×
        </button>

        {slides.length > 1 && (
          <>
            <button type="button" onClick={() => goTo(global - 1)} aria-label="Previous photo"
              className="absolute left-2 top-1/2 flex h-8 w-8 max-md:h-10 max-md:w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur hover:bg-black/70">‹</button>
            <button type="button" onClick={() => goTo(global + 1)} aria-label="Next photo"
              className="absolute right-2 top-1/2 flex h-8 w-8 max-md:h-10 max-md:w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur hover:bg-black/70">›</button>
            {slides.length <= 12 ? (
              <div className="absolute inset-x-0 bottom-2 z-10 flex justify-center gap-1.5">
                {slides.map((s, i) => (
                  <button key={`${s.photoId}-${s.i}`} type="button" onClick={() => goTo(i)} aria-label={`Photo ${i + 1}`}
                    className={`h-1.5 rounded-full transition-all ${i === global ? "w-4 bg-white" : "w-1.5 bg-white/50"}`} />
                ))}
              </div>
            ) : (
              <span className="absolute bottom-2 left-1/2 z-10 -translate-x-1/2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] tabular-nums text-white">
                {global + 1} / {slides.length}
              </span>
            )}
          </>
        )}
        {stackPos > 0 && (
          <span className="absolute bottom-2 right-2 z-10 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white/90 backdrop-blur">
            {stackPos} of {stack.length}
          </span>
        )}
      </div>

      <div className="space-y-1.5 px-4 pb-4 pt-1">
        <div className="-mx-2">
          <SocialActions
            photoId={photo.id}
            commentsOpen={commentsOpen}
            onToggleComments={() => {
              setCommentsOpen((o) => !o);
              if (fromNotification) openComments(null);
            }}
            onDelete={isOwner ? () => setDeleting(true) : undefined}
          />
        </div>

        {/* Location: hover (or ⓘ on touch) shows the description / story */}
        {editLoc ? (
          <LocationEditor photo={photo} onDone={() => setEditLoc(false)} />
        ) : (
          <div className="flex items-center gap-1">
            <div
              className="group/loc relative min-w-0"
              // Not enough room above (popup near the top of the screen) → show the tooltip below
              onMouseEnter={(e) => setTipBelow(e.currentTarget.getBoundingClientRect().top < 220)}
              onFocus={(e) => setTipBelow(e.currentTarget.getBoundingClientRect().top < 220)}
            >
              <h3
                className={`truncate text-base font-semibold leading-tight ${hasTip ? "cursor-help underline decoration-white/25 decoration-dotted underline-offset-4" : ""}`}
                tabIndex={hasTip ? 0 : -1}
                onClick={() => hasTip && setInfoOpen((o) => !o)}
              >
                {heading}
              </h3>
              {hasTip && !infoOpen && (
                <div
                  role="tooltip"
                  className={`pointer-events-none invisible absolute left-0 z-30 ${tipBelow ? "top-full mt-2" : "bottom-full mb-2"} w-[300px] max-w-[calc(100vw-3rem)] rounded-xl bg-white px-3 py-2 text-xs leading-relaxed text-neutral-800 opacity-0 shadow-2xl transition-opacity duration-150 group-hover/loc:visible group-hover/loc:opacity-100 group-focus-within/loc:visible group-focus-within/loc:opacity-100`}
                >
                  {photo.location_name && (
                    <p className="mb-0.5 flex items-start gap-1 text-[11px] font-medium text-neutral-500">
                      <span aria-hidden>📍</span>
                      <span className="break-words">{photo.location_name}</span>
                    </p>
                  )}
                  {tipTitle && <p className="mb-1 font-semibold text-neutral-900">{tipTitle}</p>}
                  {body && <p className="line-clamp-[12] whitespace-pre-line">{body}</p>}
                  {body && body.length > 600 && <p className="mt-1 text-[10px] text-neutral-500">Click the name to read all</p>}
                </div>
              )}
            </div>
            {hasTip && (
              <IconButton label={infoOpen ? "Hide story" : "Show story"} onClick={() => setInfoOpen((o) => !o)} active={infoOpen}>
                {Icon.info}
              </IconButton>
            )}
            <IconButton label={copied === "loc" ? "Copied" : "Copy location"} onClick={() => copy("loc", photo.location_name ?? heading)} active={copied === "loc"}>
              {copied === "loc" ? Icon.check : Icon.copy}
            </IconButton>
            {isOwner && (
              <IconButton label="Edit location name" onClick={() => setEditLoc(true)}>
                {Icon.pencil}
              </IconButton>
            )}
            {copied === "loc" && <span className="text-[10px] text-emerald-300">Copied</span>}
          </div>
        )}

        {/* Tap / click version of the story: in-flow, scrollable */}
        {infoOpen && hasTip && !editLoc && (
          <div className="max-h-56 overflow-y-auto rounded-xl bg-white/5 px-3 py-2 text-sm leading-relaxed text-neutral-200">
            {photo.location_name && (
              <p className="mb-0.5 flex items-start gap-1 text-xs font-medium text-neutral-400">
                <span aria-hidden>📍</span>
                <span className="break-words">{photo.location_name}</span>
              </p>
            )}
            {tipTitle && <p className="mb-1 font-semibold text-white">{tipTitle}</p>}
            {body && <p className="whitespace-pre-line">{body}</p>}
          </div>
        )}

        {/* GPS: the photo's coordinates (EXIF GPS when present, else the assigned pin position) */}
        <div className="flex items-center gap-1 text-xs text-neutral-400">
          <span className="text-neutral-500">{Icon.gps}</span>
          <span className="font-mono tabular-nums text-neutral-300">{coords}</span>
          <span
            className="rounded bg-white/5 px-1 text-[9px] uppercase tracking-wide text-neutral-500"
            title={photo.is_manual_location ? "Position set by hand (the photo had no GPS, or it was edited)" : "From the photo's EXIF GPS"}
          >
            {photo.is_manual_location ? "Pin" : "EXIF"}
          </span>
          <IconButton label={copied === "gps" ? "Copied" : "Copy coordinates"} onClick={() => copy("gps", coords)} active={copied === "gps"}>
            {copied === "gps" ? Icon.check : Icon.copy}
          </IconButton>
          <IconButton label="Open in Street View" onClick={() => window.open(streetViewUrl(photo.latitude, photo.longitude), "_blank", "noopener,noreferrer")}>
            {Icon.street}
          </IconButton>
          {isOwner && (
            <IconButton label={editGps ? "Close GPS editor" : "Edit GPS"} onClick={() => setEditGps((o) => !o)} active={editGps}>
              {Icon.pencil}
            </IconButton>
          )}
          {copied === "gps" && <span className="text-[10px] text-emerald-300">Copied</span>}
        </div>
        {isOwner && editGps && <GpsInlineEditor photo={photo} stack={stack} onDone={() => setEditGps(false)} />}

        {(stack.length > 1 || exactGps) && (
          <button
            type="button"
            onClick={() => setExactGps(!exactGps)}
            aria-pressed={exactGps}
            title="Off: photos of one spot stay grouped. On: the map zooms in and spreads a pin per exact GPS coordinate"
            className={`!mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${exactGps ? "bg-amber-300 text-neutral-900 hover:bg-amber-200" : "bg-white/10 text-neutral-100 hover:bg-white/15"}`}
          >
            {Icon.gps} Spread Exact GPS Spots{exactGps ? " · on" : ""}
          </button>
        )}

        {when && (
          <p className="flex items-center gap-1.5 text-xs text-neutral-400">
            {tod && <TimeIcon t={tod} size={16} />}
            {when}
            {solar && <span className="text-neutral-500">· {solarPhaseLabel(solar)}</span>}
          </p>
        )}

        {photo.taken_at && (
          <div className="!mt-2">
            <LightPlanner photo={photo} />
          </div>
        )}

        {(camera || exposure || photo.lens) && (
          <div className="!mt-2.5 space-y-0.5 rounded-xl bg-white/5 px-3 py-2 font-mono text-[11px] text-neutral-300">
            {camera && <div className="truncate">{camera}</div>}
            {photo.lens && <div className="truncate text-neutral-400">{photo.lens}</div>}
            {exposure && <div className="text-amber-200/90">{exposure}</div>}
          </div>
        )}

        <div className="!mt-2.5">
          <FieldNotes photo={photo} isOwner={isOwner} />
        </div>

        <button
          type="button"
          onClick={() => (walking ? endWalk() : startWalk(photo))}
          aria-pressed={walking}
          className={`!mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition ${walking ? "bg-sky-400 text-neutral-950 hover:bg-sky-300" : "bg-white/10 text-neutral-100 hover:bg-white/15"}`}
        >
          🥾 {walking ? "End Nearby Photo Walk" : "Nearby Photo Walk · what else within 30 min?"}
        </button>

        {!isOwner && <ReportButton photoId={photo.id} />}

        {photo.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {photo.tags.map((t) => (
              <span key={t} className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-neutral-300">#{t}</span>
            ))}
          </div>
        )}
      </div>

      {commentsOpen && (
        <div className="border-t border-white/10 px-4 pb-4 pt-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Comments &amp; questions</p>
          <CommentsSection photoId={photo.id} ownerId={photo.user_id} autoFocus={fromNotification} />
        </div>
      )}

      {deleting && (
        <DeleteDialog
          photo={photo}
          imageIndex={Math.min(idx, images.length - 1)}
          onClose={() => setDeleting(false)}
          onDeleted={(what) => {
            setDeleting(false);
            setLightbox(false);
            if (what === "photo") onClose();
            else setIdx(0);
          }}
        />
      )}

      {lightbox && <Lightbox slides={lightboxSlides} startIndex={global} onClose={() => setLightbox(false)} />}
    </div>
  );
}

/** Owner: rename the location with live Mapbox autocomplete + names suggested for the photo's GPS */
function LocationEditor({ photo, onDone }: { photo: Photo; onDone: () => void }) {
  const [value, setValue] = useState(photo.location_name ?? "");
  const [nearby, setNearby] = useState<PlaceSuggestion[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    reverseGeocode(photo.latitude, photo.longitude).then((s) => alive && setNearby(s));
    return () => { alive = false; };
  }, [photo.latitude, photo.longitude]);

  const save = async (name = value) => {
    setSaving(true);
    setError(null);
    try {
      await updateOwnPhoto(photo.id, { location_name: name });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
      setSaving(false);
    }
  };

  return (
    <div className="space-y-1.5 rounded-xl bg-white/5 p-2">
      <LocationAutocomplete
        value={value}
        onChange={setValue}
        proximity={photo}
        theme="dark"
        autoFocus
        disabled={saving}
        placeholder="Search a place, landmark, peak…"
        ariaLabel="Location name"
        onSubmit={() => void save()}
        onCancel={onDone}
        inputClassName="w-full rounded-lg border border-white/10 bg-neutral-900 px-2.5 py-1.5 pr-7 text-sm text-white outline-none placeholder:text-neutral-500 focus:border-amber-300"
      />
      <PlaceChips suggestions={nearby} current={value} onPick={(s) => setValue(s.name)} theme="dark" label="At this GPS" />
      {error && <p className="text-[11px] text-red-300">{error}</p>}
      <div className="flex justify-end gap-2 pt-0.5">
        <button type="button" onClick={onDone} disabled={saving} className="rounded-lg px-2.5 py-1 text-xs text-neutral-300 hover:bg-white/10">
          Cancel
        </button>
        <button type="button" onClick={() => void save()} disabled={saving} className="rounded-lg bg-amber-300 px-3 py-1 text-xs font-semibold text-neutral-900 hover:bg-amber-200 disabled:opacity-50">
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
