"use client";

import { useState } from "react";
import type { Photo } from "@/types/photo";
import { useMapStore } from "@/store/mapStore";
import { contentLabPayload, contentLabUrl, type ContentLabFolder } from "@/lib/contentLab";

const btn = "shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-bold tracking-wide transition max-md:min-h-9";

/**
 * One-row Content Lab bar: PAST / EVERGREEN (owner only) + A Bank of Ideas (anyone: a typed idea note, routed to the Content Playbook).
 * Opens Content Lab with the photo in the query string and keeps a JSON copy on the clipboard as a fallback.
 */
export default function ContentLabRow({ photo, imageUrl }: { photo: Photo; imageUrl: string }) {
  const currentUserId = useMapStore((s) => s.currentUserId);
  const isOwner = Boolean(currentUserId && currentUserId === photo.user_id);
  const [idea, setIdea] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const send = (folder: ContentLabFolder, note?: string) => {
    const payload = contentLabPayload(photo, imageUrl, folder, note);
    window.open(contentLabUrl(payload), "_blank", "noopener,noreferrer"); // inside the click, so it is not popup-blocked
    const done = (ok: boolean) => {
      setMsg(`Sent to Content Lab (${folder === "playbook" ? "A Bank of Ideas" : folder.toUpperCase()}).${ok ? " A JSON copy is on your clipboard." : ""}`);
      setTimeout(() => setMsg(null), 5000);
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(JSON.stringify(payload, null, 2)).then(() => done(true), () => done(false));
    else done(false);
  };

  const ownerOnly = "Only the photo's owner can send it to this folder";
  return (
    <div className="!mt-2 space-y-1.5">
      <div className="flex flex-nowrap items-center gap-1.5 overflow-x-auto rounded-xl bg-white/5 px-2 py-1.5">
        <button type="button" disabled={!isOwner} onClick={() => send("past")} title={isOwner ? "Send to Content Lab Past folder" : ownerOnly} className={`${btn} bg-violet-400/90 text-neutral-950 hover:bg-violet-300 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-neutral-500`}>
          PAST
        </button>
        <button type="button" disabled={!isOwner} onClick={() => send("evergreen")} title={isOwner ? "Send to Content Lab Evergreen folder" : ownerOnly} className={`${btn} bg-emerald-400/90 text-neutral-950 hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-neutral-500`}>
          EVERGREEN
        </button>
        <button type="button" onClick={() => setIdea((v) => (v === null ? "" : null))} aria-expanded={idea !== null} title="Send to Content Lab Content Playbook" className={`${btn} bg-amber-300 text-neutral-950 hover:bg-amber-200`}>
          A Bank of Ideas
        </button>
      </div>
      {idea !== null && (
        <div className="space-y-1.5 rounded-xl bg-white/5 p-2">
          <textarea
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            rows={3}
            maxLength={1000}
            autoFocus
            aria-label="Your idea for this photo"
            placeholder="Your idea / concept for this photo (a reel, a story angle, a caption hook…)"
            className="w-full resize-y rounded-lg border border-white/10 bg-neutral-900 px-2.5 py-1.5 text-xs text-white outline-none placeholder:text-neutral-500 focus:border-amber-300"
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setIdea(null)} className="rounded-lg px-2.5 py-1 text-xs text-neutral-300 hover:bg-white/10">Cancel</button>
            <button
              type="button"
              disabled={!idea.trim()}
              onClick={() => { send("playbook", idea); setIdea(null); }}
              className="rounded-lg bg-amber-300 px-3 py-1 text-xs font-semibold text-neutral-900 hover:bg-amber-200 disabled:opacity-40"
            >
              Send idea
            </button>
          </div>
        </div>
      )}
      {msg && <p role="status" className="rounded-lg bg-emerald-950/70 px-3 py-1.5 text-[11px] text-emerald-200">{msg}</p>}
    </div>
  );
}
