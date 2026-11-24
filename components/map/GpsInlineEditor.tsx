"use client";

import { useEffect, useState } from "react";
import { useMap } from "react-map-gl";
import type { Photo } from "@/types/photo";
import { formatLatLng, reverseGeocode } from "@/lib/geocode";
import { updateOwnPhoto, updateOwnPhotos } from "@/lib/photoEdits";
import { useMapStore } from "@/store/mapStore";
import { MAP_ID } from "./constants";

/** "42.24894, 23.60994" (also "42.24894 23.60994", "42.24894; 23.60994", "42.24894°N, 23.60994°E") → [lat, lng], or null */
export function parseLatLng(text: string): [number, number] | null {
  const nums = text.match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length !== 2) return null;
  let [lat, lng] = nums.map(Number);
  if (/\d\s*°?\s*S\b/i.test(text)) lat = -Math.abs(lat);
  if (/\d\s*°?\s*W\b/i.test(text)) lng = -Math.abs(lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lat, lng] : null;
}

interface Props {
  photo: Photo;
  /** Every photo on this pin / spot, including `photo` */
  stack: Photo[];
  onDone: () => void;
}

/**
 * Owner-only inline GPS editor: a "lat, lng" field (paste a pair) or "Pick on Map", applied to this photo or to every
 * photo of the open spot. Saving reverse-geocodes the point for a new location name and moves the pin at once.
 */
export default function GpsInlineEditor({ photo, stack, onDone }: Props) {
  const { [MAP_ID]: map } = useMap();
  const currentUserId = useMapStore((s) => s.currentUserId);
  const gpsPick = useMapStore((s) => s.gpsPick);
  const startGpsPick = useMapStore((s) => s.startGpsPick);
  const endGpsPick = useMapStore((s) => s.endGpsPick);
  const pickedPoint = gpsPick?.photoId === photo.id ? gpsPick.point : null;
  const picking = gpsPick?.photoId === photo.id;

  const mine = stack.filter((p) => p.user_id === currentUserId);
  const [text, setText] = useState(formatLatLng(photo.latitude, photo.longitude));
  const [scope, setScope] = useState<"one" | "all">("one");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = parseLatLng(text);

  // A map click while "Pick on Map" is on fills the field
  useEffect(() => {
    if (pickedPoint) {
      setText(formatLatLng(pickedPoint.latitude, pickedPoint.longitude));
      setError(null);
    }
  }, [pickedPoint]);
  // Leaving the editor (or the photo) ends pick mode
  useEffect(() => () => endGpsPick(), [endGpsPick]);

  const save = async () => {
    if (!parsed) return setError("Enter coordinates like 42.24894, 23.60994");
    const [latitude, longitude] = parsed;
    setSaving(true);
    setError(null);
    try {
      // Mapbox reverse geocoding: the nearest landmark / town for the new point (unchanged name if there is none)
      const name = (await reverseGeocode(latitude, longitude))[0]?.name;
      const patch = { latitude, longitude, is_manual_location: true, ...(name ? { location_name: name } : {}) };
      if (scope === "all" && mine.length > 1) await updateOwnPhotos(mine.map((p) => p.id), patch);
      else await updateOwnPhoto(photo.id, patch);
      endGpsPick();
      map?.flyTo({ center: [longitude, latitude], zoom: Math.max(map.getZoom(), 12), duration: 1200, essential: true });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
      setSaving(false);
    }
  };

  const cancel = () => {
    endGpsPick();
    onDone();
  };

  return (
    <div className="!mt-1.5 space-y-1.5 rounded-xl bg-white/5 p-2 text-xs">
      <div className="flex items-center gap-1.5">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
            if (e.key === "Escape") cancel();
          }}
          autoFocus
          spellCheck={false}
          inputMode="decimal"
          aria-label="Latitude, longitude"
          placeholder="42.24894, 23.60994"
          className={`min-w-0 flex-1 rounded-lg bg-neutral-900 px-2 py-1 font-mono tabular-nums text-neutral-100 outline-none ring-1 focus:ring-amber-300/70 ${parsed || !text.trim() ? "ring-white/10" : "ring-red-400/70"}`}
        />
        <button
          type="button"
          onClick={() => (picking ? endGpsPick() : startGpsPick(photo.id))}
          aria-pressed={picking}
          title="Click anywhere on the map to fill the coordinates"
          className={`shrink-0 rounded-lg px-2 py-1 font-semibold transition ${picking ? "bg-sky-400 text-neutral-950" : "bg-white/10 text-neutral-100 hover:bg-white/15"}`}
        >
          {picking ? "Click the map…" : "Pick on Map"}
        </button>
      </div>

      {mine.length > 1 && (
        <div role="radiogroup" aria-label="Apply to" className="flex flex-wrap gap-x-3 gap-y-1 text-neutral-300">
          <label className="flex cursor-pointer items-center gap-1">
            <input type="radio" name={`gps-scope-${photo.id}`} checked={scope === "one"} onChange={() => setScope("one")} className="accent-amber-300" />
            This photo only
          </label>
          <label className="flex cursor-pointer items-center gap-1">
            <input type="radio" name={`gps-scope-${photo.id}`} checked={scope === "all"} onChange={() => setScope("all")} className="accent-amber-300" />
            All {mine.length} photos in this spot
          </label>
        </div>
      )}

      {error && <p className="text-[11px] text-red-300">{error}</p>}

      <div className="flex justify-end gap-1.5">
        <button type="button" onClick={cancel} disabled={saving} className="rounded-lg px-2.5 py-1 text-neutral-300 hover:bg-white/10">
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving || !parsed}
          className="rounded-lg bg-amber-300 px-3 py-1 font-semibold text-neutral-900 hover:bg-amber-200 disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
