"use client";

import { useEffect, useRef, useState } from "react";
import { useUploadBatch, resolveLocation, MAX_BATCH } from "@/hooks/useUploadBatch";
import type { LatLng } from "@/store/mapStore";
import type { Photo } from "@/types/photo";
import UploadItemCard from "./UploadItemCard";

interface Props {
  userId: string;
  defaultPhotographer: string;
  /** Point clicked on the map in "pick location" mode */
  pickedLocation: LatLng | null;
  /** Ask the map to enter "pick location" mode */
  onRequestLocationPick: () => void;
  onUploaded: (photos: Photo[]) => void;
  /** Batch cleared (cancel / all uploaded): remove the picked marker from the map */
  onReset?: () => void;
}

const input =
  "w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-300/30 dark:border-neutral-700 dark:bg-neutral-800";

/**
 * Up to 20 photos at once:
 * (a) EXIF → (b) compression, 2 in parallel → AI tags → translate → (c) Storage → (d) DB, 3 in parallel.
 * Title, description, location name and photographer apply to all photos; each photo can override them.
 */
export default function BatchUploader({ userId, defaultPhotographer, pickedLocation, onRequestLocationPick, onUploaded, onReset }: Props) {
  /** Who the next map click belongs to: "all" photos without GPS, or one photo id */
  const [pickingFor, setPickingFor] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const batch = useUploadBatch({
    userId,
    defaultPhotographer,
    onNeedsLocation: () => {
      setPickingFor("all");
      onRequestLocationPick();
    },
    onUploaded,
  });
  const { state, counts } = batch;

  // Map click → the photo (or group) that asked for it
  useEffect(() => {
    if (!pickedLocation || !pickingFor) return;
    if (pickingFor === "all") batch.setSharedLocation(pickedLocation);
    else batch.patch(pickingFor, { manual: pickedLocation });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedLocation]);

  const startPick = (target: string) => {
    setPickingFor(target);
    onRequestLocationPick();
  };

  const add = (files: FileList | File[] | null) => {
    if (!files) return;
    const { skipped } = batch.addFiles(Array.from(files));
    setNotice(skipped > 0 ? `Up to ${MAX_BATCH} photos per upload: ${skipped} file${skipped > 1 ? "s were" : " was"} skipped.` : null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const cancel = () => {
    batch.reset();
    setPickingFor(null);
    setNotice(null);
    onReset?.();
  };

  // Batch emptied after a successful upload → clean the map marker too
  const hadItems = useRef(false);
  useEffect(() => {
    if (state.items.length) hadItems.current = true;
    else if (hadItems.current) {
      hadItems.current = false;
      setPickingFor(null);
      onReset?.();
    }
  }, [state.items.length, onReset]);

  const busy = state.submitting;
  const noGps = state.items.filter((i) => i.compressed && i.exif && (i.exif.latitude == null || i.exif.longitude == null) && !i.manual);
  const full = counts.total >= MAX_BATCH;

  let cta = `Upload ${counts.uploadable} photo${counts.uploadable === 1 ? "" : "s"}`;
  if (state.translating) cta = "Translating to English…";
  else if (busy) cta = `Uploading ${counts.done + counts.uploading}/${counts.done + counts.uploading + counts.uploadable}…`;
  else if (counts.failed && counts.uploadable) cta = `Retry ${counts.uploadable} photo${counts.uploadable === 1 ? "" : "s"}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {/* Drop zone */}
        {!full && !busy && (
          <label
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); add(e.dataTransfer.files); }}
            className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-neutral-300 text-center text-sm text-neutral-500 hover:border-amber-400 dark:border-neutral-700 ${counts.total ? "p-3" : "p-8"}`}
          >
            <span className="font-medium text-neutral-700 dark:text-neutral-200">
              {counts.total ? `Add more photos (${counts.total}/${MAX_BATCH})` : "Drop photos here or click to choose"}
            </span>
            {!counts.total && <span className="text-xs">Up to {MAX_BATCH} photos · JPEG / PNG / HEIC · resized to 2048px in your browser</span>}
            <input ref={fileRef} type="file" multiple accept="image/*,.heic,.heif" className="hidden" onChange={(e) => add(e.target.files)} />
          </label>
        )}
        {notice && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">{notice}</p>}

        {counts.total > 0 && (
          <>
            {/* Shared fields */}
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                {counts.total > 1 ? `Applies to all ${counts.total} photos` : "Details"}
              </h3>
              <input className={input} value={state.shared.title} onChange={(e) => batch.setShared({ title: e.target.value })} placeholder="Title" disabled={busy} />
              <textarea className={`${input} resize-none`} rows={2} value={state.shared.description} onChange={(e) => batch.setShared({ description: e.target.value })} placeholder="Description" disabled={busy} />
              <div>
                <input className={input} value={state.shared.locationName} onChange={(e) => batch.setShared({ locationName: e.target.value })} placeholder="Location name (e.g. Frankfurt am Main)" disabled={busy} />
                <p className="mt-1 text-[11px] text-neutral-500">Used for search. Pins always sit on each photo&apos;s GPS position.</p>
              </div>
              <input className={input} value={state.shared.photographer} onChange={(e) => batch.setShared({ photographer: e.target.value })} placeholder="Photographer name" disabled={busy} aria-label="Photographer name" />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={state.shared.isPrivate} onChange={(e) => batch.setShared({ isPrivate: e.target.checked })} disabled={busy} />
                Private (only I can see {counts.total > 1 ? "these photos" : "this photo"})
              </label>
              <p className="text-[11px] text-neutral-500">Titles and descriptions in other languages are translated to English on upload.</p>
            </section>

            {/* Photos without GPS */}
            {noGps.length > 0 && (
              <div className={`rounded-xl border p-3 text-xs ${pickingFor === "all" ? "border-amber-400 bg-amber-50 dark:bg-amber-950/40" : "border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/20"}`}>
                <p className="font-medium text-amber-900 dark:text-amber-200">
                  {noGps.length} photo{noGps.length > 1 ? "s have" : " has"} no GPS
                </p>
                <p className="mt-0.5 text-amber-800/80 dark:text-amber-200/70">
                  {state.sharedLocation
                    ? `Placed at ${state.sharedLocation.latitude.toFixed(5)}, ${state.sharedLocation.longitude.toFixed(5)}. Drag the pin on the map to adjust.`
                    : "Pick one point on the map for all of them, or set each photo separately."}
                </p>
                <button type="button" onClick={() => startPick("all")} disabled={busy}
                  className="mt-2 rounded-lg bg-amber-300 px-3 py-1.5 font-semibold text-neutral-900 hover:bg-amber-200 disabled:opacity-50">
                  {state.sharedLocation ? "Pick again on map" : "Pick location on map"}
                </button>
              </div>
            )}

            {/* Per-photo list */}
            <ul className="space-y-2">
              {state.items.map((it) => (
                <UploadItemCard
                  key={it.id}
                  item={it}
                  shared={state.shared}
                  location={resolveLocation(it, state.sharedLocation)}
                  picking={pickingFor === it.id}
                  disabled={busy}
                  onPatch={(p) => batch.patch(it.id, p)}
                  onRemove={() => batch.removeItem(it.id)}
                  onPick={() => startPick(it.id)}
                  onAddTag={(t) => batch.addTag(it.id, t)}
                  onRemoveTag={(t) => batch.removeTag(it.id, t)}
                />
              ))}
            </ul>
          </>
        )}
      </div>

      {/* Sticky footer */}
      {counts.total > 0 && (
        <div className="space-y-2 border-t border-neutral-200 p-3 dark:border-neutral-800">
          {(counts.processing > 0 || counts.needLocation > 0) && (
            <p className="text-[11px] text-neutral-500">
              {counts.processing > 0 && `Preparing ${counts.processing} photo${counts.processing > 1 ? "s" : ""}… `}
              {counts.needLocation > 0 && `${counts.needLocation} still need${counts.needLocation > 1 ? "" : "s"} a location and will wait.`}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={batch.submit}
              disabled={busy || counts.uploadable === 0}
              className="flex-1 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 dark:bg-amber-300 dark:text-neutral-900"
            >
              {cta}
            </button>
            <button type="button" onClick={cancel} disabled={busy} className="rounded-lg border border-neutral-200 px-4 py-2 text-sm disabled:opacity-40 dark:border-neutral-700">
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
