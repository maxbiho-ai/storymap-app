"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Photo } from "@/types/photo";
import { deleteOwnPhoto } from "@/lib/photoEdits";

interface Props {
  photo: Photo;
  /** Image being viewed inside a multi-image post */
  imageIndex: number;
  onClose: () => void;
  /** After a successful delete: "photo" = the row is gone, "image" = one image of the post removed */
  onDeleted: (what: "photo" | "image") => void;
}

/** Owner confirmation: one photo → delete it; a multi-image post → this image only, or the whole post */
export default function DeleteDialog({ photo, imageIndex, onClose, onDeleted }: Props) {
  const count = photo.image_urls?.length ?? 0;
  const multi = count > 1;
  const [busy, setBusy] = useState<null | "image" | "photo">(null);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      e.preventDefault();
      if (!busy) onClose();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [busy, onClose]);

  const run = async (what: "image" | "photo") => {
    setBusy(what);
    setError(null);
    try {
      const done = await deleteOwnPhoto(photo.id, what === "image" ? imageIndex : undefined);
      onDeleted(done);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
      setBusy(null);
    }
  };

  const btn = "w-full rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:opacity-50";

  return createPortal(
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70 p-4"
      onClick={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div role="alertdialog" aria-modal="true" aria-labelledby="delete-title" className="w-full max-w-sm rounded-2xl bg-neutral-950 p-5 text-neutral-100 shadow-2xl ring-1 ring-white/10">
        <div className="mb-3 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={multi ? photo.image_urls[imageIndex] : photo.thumb_url ?? photo.photo_url} alt="" className="h-14 w-14 rounded-lg object-cover" />
          <div>
            <h2 id="delete-title" className="font-semibold">{multi ? "Delete from this post?" : "Delete this photo permanently?"}</h2>
            <p className="text-xs text-neutral-400">
              {multi ? `This post has ${count} photos.` : "The photo, its likes, comments and list entries will be removed."} This can’t be undone.
            </p>
          </div>
        </div>

        {error && <p className="mb-2 rounded-lg bg-red-950/70 px-3 py-1.5 text-xs text-red-200">{error}</p>}

        <div className="space-y-2">
          {multi ? (
            <>
              <button type="button" disabled={Boolean(busy)} onClick={() => void run("image")} className={`${btn} bg-red-500/15 text-red-200 hover:bg-red-500/25`}>
                {busy === "image" ? "Deleting…" : `Delete only this photo (${imageIndex + 1} of ${count})`}
              </button>
              <button type="button" disabled={Boolean(busy)} onClick={() => void run("photo")} className={`${btn} bg-red-500 text-white hover:bg-red-400`}>
                {busy === "photo" ? "Deleting…" : `Delete the entire post (${count} photos)`}
              </button>
            </>
          ) : (
            <button type="button" disabled={Boolean(busy)} onClick={() => void run("photo")} className={`${btn} bg-red-500 text-white hover:bg-red-400`}>
              {busy ? "Deleting…" : "Delete permanently"}
            </button>
          )}
          <button ref={cancelRef} type="button" disabled={Boolean(busy)} onClick={onClose} className={`${btn} bg-white/5 font-medium text-neutral-300 hover:bg-white/10`}>
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
