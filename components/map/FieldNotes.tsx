"use client";

import { useState } from "react";
import type { Photo } from "@/types/photo";
import { updateOwnPhoto } from "@/lib/photoEdits";

/**
 * Photographer field notes: Parking & Access, Permit / Drone / Ticket.
 * Read-only for everyone when filled in; the owner can add / edit them inline
 * (RLS: "Users can update their own photos"). `overlay` = on top of the full-screen photo.
 */
export default function FieldNotes({ photo, isOwner, overlay }: { photo: Photo; isOwner: boolean; overlay?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [access, setAccess] = useState(photo.access_info ?? "");
  const [permit, setPermit] = useState(photo.permit_info ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const has = Boolean(photo.access_info || photo.permit_info);
  if (!has && !isOwner) return null;

  const open = () => {
    setAccess(photo.access_info ?? "");
    setPermit(photo.permit_info ?? "");
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateOwnPhoto(photo.id, { access_info: access, permit_info: permit });
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const shell = overlay ? "bg-neutral-950/90 backdrop-blur" : "bg-white/5";
  const area =
    "w-full resize-none rounded-lg border border-white/10 bg-neutral-900 px-2 py-1.5 text-xs text-white outline-none placeholder:text-neutral-500 focus:border-amber-300";

  if (editing) {
    return (
      <div className={`space-y-1.5 rounded-xl p-2.5 ${shell}`} onKeyDown={(e) => e.stopPropagation()}>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Field notes</p>
        <label className="block text-[11px] text-neutral-400">
          🅿️ Parking &amp; Access
          <textarea value={access} onChange={(e) => setAccess(e.target.value)} rows={2} maxLength={600} dir="auto" disabled={saving}
            placeholder="Where to park, walking distance, trail conditions…" className={`${area} mt-0.5`} />
        </label>
        <label className="block text-[11px] text-neutral-400">
          🎫 Permit / Drone / Ticket
          <textarea value={permit} onChange={(e) => setPermit(e.target.value)} rows={2} maxLength={600} dir="auto" disabled={saving}
            placeholder="Entry fee, permits, drone rules…" className={`${area} mt-0.5`} />
        </label>
        {error && <p className="text-[11px] text-red-300">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setEditing(false)} disabled={saving} className="rounded-lg px-2.5 py-1 text-xs text-neutral-300 hover:bg-white/10">Cancel</button>
          <button type="button" onClick={() => void save()} disabled={saving} className="rounded-lg bg-amber-300 px-3 py-1 text-xs font-semibold text-neutral-900 hover:bg-amber-200 disabled:opacity-50">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    );
  }

  if (!has) {
    return (
      <button type="button" onClick={open} className={`rounded-lg px-2.5 py-1 text-[11px] text-neutral-400 hover:text-white ${overlay ? "bg-neutral-950/80" : "bg-white/5 hover:bg-white/10"}`}>
        + Add field notes (parking, permits, drone)
      </button>
    );
  }

  return (
    <div className={`space-y-1 rounded-xl px-3 py-2 text-xs ${shell}`}>
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Field notes</p>
        {isOwner && (
          <button type="button" onClick={open} aria-label="Edit field notes" className="text-[11px] text-neutral-400 hover:text-white">Edit</button>
        )}
      </div>
      {photo.access_info && (
        <p className="flex gap-1.5 leading-snug text-neutral-200" dir="auto">
          <span aria-hidden title="Parking & Access">🅿️</span>
          <span className="whitespace-pre-line break-words"><b className="font-semibold text-neutral-100">Parking &amp; Access: </b>{photo.access_info}</span>
        </p>
      )}
      {photo.permit_info && (
        <p className="flex gap-1.5 leading-snug text-neutral-200" dir="auto">
          <span aria-hidden title="Permit / Drone / Ticket">🎫</span>
          <span className="whitespace-pre-line break-words"><b className="font-semibold text-neutral-100">Permit / Drone / Ticket: </b>{photo.permit_info}</span>
        </p>
      )}
    </div>
  );
}
