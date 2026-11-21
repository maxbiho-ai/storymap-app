"use client";

import { useEffect, useState } from "react";
import type { Photo } from "@/types/photo";
import { formatLatLng, reverseGeocode, type PlaceSuggestion } from "@/lib/geocode";
import { updateOwnPhoto } from "@/lib/photoEdits";
import { useMapStore, type LatLng } from "@/store/mapStore";
import { PlaceChips } from "@/components/LocationAutocomplete";

interface Props {
  photo: Photo;
  point: LatLng;
  /** Other photos sharing the photo's current pin (they stay where they are) */
  stackSize: number;
  onSaved: (p: Photo) => void;
}

/** Owner "Edit GPS": click / drag on the map, then save. Suggests the official place name for the new point. */
export default function GpsEditBanner({ photo, point, stackSize, onSaved }: Props) {
  const cancel = useMapStore((s) => s.cancelGpsEdit);
  const [names, setNames] = useState<PlaceSuggestion[]>([]);
  const [rename, setRename] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const moved = Math.abs(point.latitude - photo.latitude) > 1e-7 || Math.abs(point.longitude - photo.longitude) > 1e-7;

  useEffect(() => {
    if (!moved) return setNames([]);
    let alive = true;
    const t = setTimeout(() => reverseGeocode(point.latitude, point.longitude).then((s) => alive && setNames(s)), 300);
    return () => { alive = false; clearTimeout(t); };
  }, [point.latitude, point.longitude, moved]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateOwnPhoto(photo.id, {
        latitude: point.latitude,
        longitude: point.longitude,
        is_manual_location: true,
        ...(rename ? { location_name: rename } : {}),
      });
      cancel();
      onSaved(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
      setSaving(false);
    }
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 top-20 z-30 flex justify-center px-3 md:top-24">
      <div className="pointer-events-auto w-full max-w-md rounded-2xl bg-neutral-950/95 p-3 text-neutral-100 shadow-2xl ring-1 ring-amber-300/40 backdrop-blur">
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo.thumb_url ?? photo.photo_url} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Edit GPS · {photo.location_name ?? photo.title ?? "photo"}</p>
            <p className="text-[11px] text-neutral-400">Click the map or drag the pin to the new position.</p>
          </div>
        </div>

        <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 font-mono text-[11px] tabular-nums">
          <span className="text-neutral-500">From</span>
          <span className="text-neutral-400">{formatLatLng(photo.latitude, photo.longitude)}</span>
          <span className="text-neutral-500">To</span>
          <span className={moved ? "text-amber-200" : "text-neutral-400"}>{formatLatLng(point.latitude, point.longitude)}</span>
        </div>

        {moved && stackSize > 1 && (
          <p className="mt-2 rounded-lg bg-white/5 px-2 py-1 text-[11px] text-neutral-300">
            This photo will leave its pin and get its own; the other {stackSize - 1} stay at the original spot.
          </p>
        )}

        {moved && names.length > 0 && (
          <div className="mt-2">
            {rename ? (
              <p className="flex items-center gap-2 text-[11px] text-neutral-300">
                Location name → <span className="font-medium text-amber-200">{rename}</span>
                <button type="button" onClick={() => setRename(null)} className="text-neutral-500 hover:text-white">keep “{photo.location_name ?? "none"}”</button>
              </p>
            ) : (
              <PlaceChips suggestions={names} current={photo.location_name ?? undefined} onPick={(s) => setRename(s.name)} theme="dark" label="Also rename to" />
            )}
          </div>
        )}

        {error && <p className="mt-2 text-[11px] text-red-300">{error}</p>}

        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={cancel} disabled={saving} className="rounded-lg px-3 py-1.5 text-xs text-neutral-300 hover:bg-white/10">
            Cancel (Esc)
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || !moved}
            className="rounded-lg bg-amber-300 px-4 py-1.5 text-xs font-semibold text-neutral-900 hover:bg-amber-200 disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save position"}
          </button>
        </div>
      </div>
    </div>
  );
}
