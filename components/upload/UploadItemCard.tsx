"use client";

import { useState } from "react";
import type { UploadItem, SharedFields, ResolvedLocation } from "@/hooks/useUploadBatch";
import { resolveTakenAt, formatTakenAt } from "@/lib/time";
import TagEditor from "./TagEditor";
import LocationAutocomplete, { PlaceChips } from "@/components/LocationAutocomplete";

interface Props {
  item: UploadItem;
  shared: SharedFields;
  location: ResolvedLocation | null;
  picking: boolean;
  disabled: boolean;
  onPatch: (p: Partial<UploadItem>) => void;
  onRemove: () => void;
  onPick: () => void;
  onAddTag: (t: string) => void;
  onRemoveTag: (t: string) => void;
}

const STATUS: Record<UploadItem["status"], string> = {
  queued: "Waiting…",
  processing: "Reading & compressing…",
  ready: "Ready",
  uploading: "Uploading…",
  done: "Uploaded",
  error: "Failed",
};

const field =
  "w-full rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-amber-400 dark:border-neutral-700 dark:bg-neutral-800";

export default function UploadItemCard({ item, shared, location, picking, disabled, onPatch, onRemove, onPick, onAddTag, onRemoveTag }: Props) {
  const [open, setOpen] = useState(false);
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");

  const exif = item.exif;
  const time = exif ? resolveTakenAt(exif.taken_wall, exif.taken_offset, location?.latitude ?? null, location?.longitude ?? null) : null;
  const when = time ? formatTakenAt(time.taken_at, time.taken_tz) : null;
  const customized = Boolean(item.title?.trim() || item.description?.trim() || item.locationName?.trim() || item.manual);

  const applyManual = () => {
    const la = Number(lat), lo = Number(lng);
    if (lat && lng && Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180) {
      onPatch({ manual: { latitude: la, longitude: lo } });
    }
  };

  const locBadge = !item.compressed ? null : location ? (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${location.source === "gps" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300"}`}>
      {location.source === "gps" ? "GPS" : location.source === "manual" ? "Manual location" : "Picked on map"}
    </span>
  ) : (
    <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-950 dark:text-red-300">No location</span>
  );

  return (
    <li className={`rounded-xl border p-2.5 ${picking ? "border-amber-400 ring-2 ring-amber-300/40" : "border-neutral-200 dark:border-neutral-800"} ${item.status === "done" ? "opacity-60" : ""}`}>
      <div className="flex gap-2.5">
        <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-neutral-100 dark:bg-neutral-800">
          {item.previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="absolute inset-0 animate-pulse bg-neutral-200 dark:bg-neutral-700" />
          )}
          {item.status === "uploading" && <span className="absolute inset-0 animate-pulse bg-amber-300/40" />}
          {item.status === "done" && <span className="absolute inset-0 flex items-center justify-center bg-emerald-600/60 text-lg text-white">✓</span>}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate text-xs font-medium" title={item.file.name}>{item.file.name}</p>
            {!disabled && item.status !== "done" && (
              <button type="button" onClick={onRemove} aria-label="Remove photo" className="-mt-0.5 text-base leading-none text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200">×</button>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-500">
            <span className={item.status === "error" ? "text-red-600" : ""}>{STATUS[item.status]}</span>
            {item.compressed && <span>· {(item.compressed.file.size / 1e3).toFixed(0)} KB</span>}
            {locBadge}
          </div>
          {when && <p className="mt-0.5 text-[11px] text-neutral-500">{when}</p>}
          {location && (
            <p className="truncate text-[11px] text-neutral-500" title="Location name used for this photo">
              📍 {item.locationName?.trim() || shared.locationName.trim() || item.autoLocationName || (item.geoKey && item.autoLocationName === undefined ? "Finding place name…" : "No place name")}
            </p>
          )}
          {exif?.camera_model && (
            <p className="truncate text-[11px] text-neutral-400">
              {[exif.camera_model, exif.lens].filter(Boolean).join(" · ")}
            </p>
          )}
          {item.error && <p className="mt-0.5 text-[11px] text-red-600">{item.error}</p>}
        </div>
      </div>

      {item.compressed && item.status !== "done" && (
        <>
          <div className="mt-2">
            <TagEditor tags={item.tags} loading={item.tagState === "loading"} onAdd={onAddTag} onRemove={onRemoveTag} />
            {item.tagState === "idle" && !location && <p className="text-[10px] text-neutral-400">Tags are suggested once the photo has a location.</p>}
          </div>

          <div className="mt-2 flex items-center gap-3 text-[11px]">
            <button type="button" onClick={() => setOpen((o) => !o)} className="font-medium text-sky-700 hover:underline dark:text-sky-400" aria-expanded={open}>
              {open ? "Hide details" : customized ? "Customized · edit" : "Customize this photo"}
            </button>
            {!location && (
              <button type="button" onClick={onPick} className="font-medium text-amber-700 hover:underline dark:text-amber-400">
                Pick on map
              </button>
            )}
          </div>

          {open && (
            <div className="mt-2 space-y-1.5 rounded-lg bg-neutral-50 p-2 dark:bg-neutral-800/50">
              <input className={field} value={item.title ?? ""} onChange={(e) => onPatch({ title: e.target.value })} placeholder={shared.title ? `Title: ${shared.title}` : "Title (this photo only)"} />
              <textarea className={`${field} resize-none`} rows={2} value={item.description ?? ""} onChange={(e) => onPatch({ description: e.target.value })} placeholder={shared.description ? `Description: ${shared.description}` : "Description (this photo only)"} />
              <div>
                <LocationAutocomplete
                  value={item.locationName ?? ""}
                  onChange={(v) => onPatch({ locationName: v })}
                  proximity={location}
                  placeholder={shared.locationName || item.autoLocationName ? `Location name: ${shared.locationName || item.autoLocationName}` : "Location name (this photo only)"}
                  ariaLabel="Location name for this photo"
                  inputClassName={`${field} pr-7`}
                />
                {item.placeSuggestions && item.placeSuggestions.length > 0 && (
                  <PlaceChips suggestions={item.placeSuggestions} current={item.locationName} onPick={(s) => onPatch({ locationName: s.name })} label="At this GPS" />
                )}
              </div>

              <div className="pt-1">
                <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                  Override pin position {location?.source === "gps" && "(replaces GPS)"}
                </p>
                <div className="flex gap-1.5">
                  <input className={field} value={lat} onChange={(e) => setLat(e.target.value)} onBlur={applyManual} placeholder={location ? location.latitude.toFixed(5) : "Lat"} inputMode="decimal" aria-label="Latitude" />
                  <input className={field} value={lng} onChange={(e) => setLng(e.target.value)} onBlur={applyManual} placeholder={location ? location.longitude.toFixed(5) : "Lng"} inputMode="decimal" aria-label="Longitude" />
                </div>
                <div className="mt-1.5 flex gap-3 text-[11px]">
                  <button type="button" onClick={onPick} className="font-medium text-amber-700 hover:underline dark:text-amber-400">Pick point on map</button>
                  {customized && (
                    <button
                      type="button"
                      onClick={() => { onPatch({ title: undefined, description: undefined, locationName: undefined, manual: null }); setLat(""); setLng(""); }}
                      className="text-neutral-500 hover:underline"
                    >
                      Reset to shared
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </li>
  );
}
