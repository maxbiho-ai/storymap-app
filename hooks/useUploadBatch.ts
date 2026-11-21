"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { extractExif } from "@/lib/exif";
import { compressImage, type CompressedImage } from "@/lib/compress";
import { uploadPhoto } from "@/lib/upload";
import { runQueue } from "@/lib/queue";
import { resolveTakenAt } from "@/lib/time";
import { suggestTags, translateToEnglish } from "@/lib/aiClient";
import { normalizeTag } from "@/lib/tags";
import { reverseGeocode, type PlaceSuggestion } from "@/lib/geocode";
import type { ExtractedExif, Photo } from "@/types/photo";
import type { LatLng } from "@/store/mapStore";

export const MAX_BATCH = 20;
const PROCESS_CONCURRENCY = 2; // EXIF + compression: memory-heavy for 45MP files
const UPLOAD_CONCURRENCY = 3;
const TAG_CONCURRENCY = 3;

export type ItemStatus = "queued" | "processing" | "ready" | "uploading" | "done" | "error";
type TagState = "idle" | "loading" | "done";

export interface UploadItem {
  id: string;
  file: File;
  status: ItemStatus;
  error?: string;
  exif?: ExtractedExif;
  compressed?: CompressedImage;
  previewUrl?: string;
  tags: string[];
  tagState: TagState;
  /** Per-photo overrides: empty / undefined = use the shared value */
  title?: string;
  description?: string;
  locationName?: string;
  /** Per-photo location override (Lat/Lng inputs or "Pick on map"): beats EXIF GPS */
  manual?: LatLng | null;
  /** Place name reverse-geocoded from this photo's position (EXIF GPS or picked point) */
  autoLocationName?: string;
  /** Name candidates for that position, for one-click acceptance */
  placeSuggestions?: PlaceSuggestion[];
  /** Position (rounded) the auto name belongs to */
  geoKey?: string;
  photo?: Photo;
}

export interface SharedFields {
  title: string;
  description: string;
  locationName: string;
  photographer: string;
  isPrivate: boolean;
}

interface State {
  items: UploadItem[];
  shared: SharedFields;
  /** Location picked for every photo *without* GPS (never overrides GPS) */
  sharedLocation: LatLng | null;
  /** The shared location name was filled from GPS, not typed */
  sharedNameAuto: boolean;
  /** The user typed in the shared location field: never auto-fill it again */
  sharedNameTouched: boolean;
  submitting: boolean;
  translating: boolean;
}

type Action =
  | { type: "add"; items: UploadItem[] }
  | { type: "patch"; id: string; patch: Partial<UploadItem> }
  | { type: "remove"; id: string }
  | { type: "shared"; patch: Partial<SharedFields>; auto?: boolean }
  | { type: "sharedLocation"; loc: LatLng | null }
  | { type: "submitting"; value: boolean }
  | { type: "translating"; value: boolean }
  | { type: "reset"; photographer: string };

const initialShared = (photographer: string): SharedFields => ({
  title: "",
  description: "",
  locationName: "",
  photographer,
  isPrivate: false,
});

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "add":
      return { ...s, items: [...s.items, ...a.items] };
    case "patch":
      return { ...s, items: s.items.map((it) => (it.id === a.id ? { ...it, ...a.patch } : it)) };
    case "remove":
      return { ...s, items: s.items.filter((it) => it.id !== a.id) };
    case "shared": {
      if (a.patch.locationName === undefined) return { ...s, shared: { ...s.shared, ...a.patch } };
      return a.auto
        ? { ...s, shared: { ...s.shared, ...a.patch }, sharedNameAuto: Boolean(a.patch.locationName) }
        : { ...s, shared: { ...s.shared, ...a.patch }, sharedNameAuto: false, sharedNameTouched: true };
    }
    case "sharedLocation":
      return { ...s, sharedLocation: a.loc };
    case "submitting":
      return { ...s, submitting: a.value };
    case "translating":
      return { ...s, translating: a.value };
    case "reset":
      return { items: [], shared: initialShared(a.photographer), sharedLocation: null, sharedNameAuto: false, sharedNameTouched: false, submitting: false, translating: false };
  }
}

export interface ResolvedLocation extends LatLng {
  source: "manual" | "gps" | "shared";
}

/**
 * GPS priority: a per-photo manual override wins, then EXIF GPS, then the shared picked point.
 * A typed location *name* never moves the pin.
 */
export function resolveLocation(item: UploadItem, sharedLocation: LatLng | null): ResolvedLocation | null {
  if (item.manual) return { ...item.manual, source: "manual" };
  if (item.exif?.latitude != null && item.exif.longitude != null) {
    return { latitude: item.exif.latitude, longitude: item.exif.longitude, source: "gps" };
  }
  return sharedLocation ? { ...sharedLocation, source: "shared" } : null;
}

const pick = (override: string | undefined, shared: string) => (override?.trim() ? override.trim() : shared.trim());

/** Location name: the photo's own override → the shared (typed or auto) name → the photo's GPS place name */
export function effectiveLocationName(item: UploadItem, shared: SharedFields): string {
  return pick(item.locationName, shared.locationName) || item.autoLocationName || "";
}

const geoKeyOf = (l: LatLng) => `${l.latitude.toFixed(4)},${l.longitude.toFixed(4)}`;

export function useUploadBatch(opts: {
  userId: string;
  defaultPhotographer: string;
  onNeedsLocation: () => void;
  onUploaded: (photos: Photo[]) => void;
}) {
  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    items: [],
    shared: initialShared(opts.defaultPhotographer),
    sharedLocation: null,
    sharedNameAuto: false,
    sharedNameTouched: false,
    submitting: false,
    translating: false,
  }));
  const stateRef = useRef(state);
  stateRef.current = state;
  const askedForLocation = useRef(false);
  const tagQueue = useRef<Set<string>>(new Set());
  /** Photos removed while still queued (stateRef lags one render behind a dispatch) */
  const removed = useRef<Set<string>>(new Set());

  // Profile name arrives after mount: fill it in unless the user already typed one
  useEffect(() => {
    if (opts.defaultPhotographer && !stateRef.current.shared.photographer) {
      dispatch({ type: "shared", patch: { photographer: opts.defaultPhotographer } });
    }
  }, [opts.defaultPhotographer]);

  const patch = useCallback((id: string, p: Partial<UploadItem>) => dispatch({ type: "patch", id, patch: p }), []);

  /** (a) EXIF → (b) compression, 2 at a time */
  const addFiles = useCallback(
    (files: File[]): { added: number; skipped: number } => {
      const images = files.filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
      const room = Math.max(0, MAX_BATCH - stateRef.current.items.length);
      const accepted = images.slice(0, room);
      const items: UploadItem[] = accepted.map((file) => ({
        id: crypto.randomUUID(),
        file,
        status: "queued",
        tags: [],
        tagState: "idle",
      }));
      if (items.length) {
        dispatch({ type: "add", items });
        void runQueue(items, PROCESS_CONCURRENCY, async (item) => {
          if (removed.current.has(item.id)) return; // removed while waiting
          patch(item.id, { status: "processing" });
          try {
            const exif = await extractExif(item.file);
            // Keep a web-ready original byte-for-byte only when it carries no GPS (the file is public)
            const compressed = await compressImage(item.file, { keepOriginal: exif.latitude == null && exif.longitude == null });
            patch(item.id, {
              exif,
              compressed,
              previewUrl: URL.createObjectURL(compressed.thumb),
              status: "ready",
            });
          } catch (err) {
            patch(item.id, { status: "error", error: err instanceof Error ? err.message : "Could not read this image" });
          }
        });
      }
      return { added: items.length, skipped: files.length - items.length };
    },
    [patch],
  );

  // Photos without GPS → the map switches to "pick location" (once per batch)
  useEffect(() => {
    const missing = state.items.some((i) => i.status === "ready" && !resolveLocation(i, state.sharedLocation));
    if (missing && !askedForLocation.current) {
      askedForLocation.current = true;
      opts.onNeedsLocation();
    }
  }, [state.items, state.sharedLocation, opts]);

  // AI tags once a photo is compressed *and* located (location + time decide sunrise vs sunset)
  useEffect(() => {
    const ready = state.items.filter(
      (i) => i.status === "ready" && i.tagState === "idle" && !tagQueue.current.has(i.id) && resolveLocation(i, state.sharedLocation),
    );
    if (!ready.length) return;
    ready.forEach((i) => tagQueue.current.add(i.id));
    void runQueue(ready, TAG_CONCURRENCY, async (item) => {
      patch(item.id, { tagState: "loading" });
      const s = stateRef.current;
      const current = s.items.find((i) => i.id === item.id) ?? item;
      const loc = resolveLocation(current, s.sharedLocation);
      const { taken_at } = resolveTakenAt(item.exif!.taken_wall, item.exif!.taken_offset, loc?.latitude ?? null, loc?.longitude ?? null);
      const suggested = await suggestTags({
        thumb: item.compressed!.thumb,
        takenAt: taken_at,
        lat: loc?.latitude ?? null,
        lng: loc?.longitude ?? null,
        locationName: effectiveLocationName(current, s.shared) || null,
        title: pick(current.title, s.shared.title) || null,
      });
      // Merge: keep anything the user already added
      const latest = stateRef.current.items.find((i) => i.id === item.id);
      if (!latest) return;
      patch(item.id, { tags: [...new Set([...latest.tags, ...suggested])], tagState: "done" });
    });
  }, [state.items, state.sharedLocation, patch]);

  // Reverse-geocode each photo position (EXIF GPS, manual or picked) → an official place name
  useEffect(() => {
    for (const it of state.items) {
      if (!it.compressed || it.status === "done") continue;
      const loc = resolveLocation(it, state.sharedLocation);
      const key = loc ? geoKeyOf(loc) : undefined;
      if (!loc || key === it.geoKey) continue;
      patch(it.id, { geoKey: key, autoLocationName: undefined, placeSuggestions: undefined });
      void reverseGeocode(loc.latitude, loc.longitude).then((s) => {
        const latest = stateRef.current.items.find((i) => i.id === it.id);
        if (!latest || latest.geoKey !== key) return; // moved again meanwhile
        patch(it.id, { autoLocationName: s[0]?.name ?? "", placeSuggestions: s });
      });
    }
  }, [state.items, state.sharedLocation, patch]);

  // Pre-fill the shared Location field when every photo resolves to the same place,
  // unless the user already typed there. Mixed places → each photo keeps its own name.
  useEffect(() => {
    if (state.sharedNameTouched) return;
    const located = state.items.filter((i) => i.status !== "done" && i.compressed && resolveLocation(i, state.sharedLocation));
    if (!located.length || located.some((i) => i.autoLocationName === undefined)) return; // still resolving
    const names = new Set(located.map((i) => i.autoLocationName ?? ""));
    const common = names.size === 1 ? [...names][0] : "";
    if (common !== state.shared.locationName && (state.sharedNameAuto || !state.shared.locationName)) {
      dispatch({ type: "shared", patch: { locationName: common }, auto: true });
    }
  }, [state.items, state.sharedLocation, state.shared.locationName, state.sharedNameAuto, state.sharedNameTouched]);

  const removeItem = useCallback((id: string) => {
    const it = stateRef.current.items.find((i) => i.id === id);
    if (it?.previewUrl) URL.revokeObjectURL(it.previewUrl);
    removed.current.add(id);
    dispatch({ type: "remove", id });
  }, []);

  const reset = useCallback(() => {
    stateRef.current.items.forEach((i) => {
      if (i.previewUrl) URL.revokeObjectURL(i.previewUrl);
      removed.current.add(i.id);
    });
    askedForLocation.current = false;
    tagQueue.current.clear();
    dispatch({ type: "reset", photographer: opts.defaultPhotographer });
  }, [opts.defaultPhotographer]);

  const addTag = useCallback((id: string, raw: string) => {
    const t = normalizeTag(raw).replace(/\s+/g, "");
    const it = stateRef.current.items.find((i) => i.id === id);
    if (t && it && !it.tags.includes(t)) patch(id, { tags: [...it.tags, t] });
  }, [patch]);

  const removeTag = useCallback((id: string, tag: string) => {
    const it = stateRef.current.items.find((i) => i.id === id);
    if (it) patch(id, { tags: it.tags.filter((t) => t !== tag) });
  }, [patch]);

  /** Translate → (c) Storage → (d) DB, 3 uploads at a time */
  const submit = useCallback(async () => {
    const s = stateRef.current;
    const todo = s.items.filter((i) => (i.status === "ready" || i.status === "error") && i.compressed && resolveLocation(i, s.sharedLocation));
    if (!todo.length || s.submitting) return;
    dispatch({ type: "submitting", value: true });

    // One translation call for every distinct title/description in the batch
    const texts = new Map<string, string>();
    for (const it of todo) {
      for (const t of [pick(it.title, s.shared.title), pick(it.description, s.shared.description)]) {
        if (t) texts.set(t, t);
      }
    }
    if (texts.size) {
      dispatch({ type: "translating", value: true });
      const originals = [...texts.keys()];
      const translated = await translateToEnglish(originals);
      originals.forEach((o, i) => texts.set(o, translated[i] ?? o));
      dispatch({ type: "translating", value: false });
    }
    const en = (t: string) => (t ? texts.get(t) ?? t : null);

    const photographer = s.shared.photographer.trim() || null;
    const uploaded: Photo[] = [];

    await runQueue(todo, UPLOAD_CONCURRENCY, async (it) => {
      const loc = resolveLocation(it, s.sharedLocation)!;
      const { taken_at, taken_tz } = resolveTakenAt(it.exif!.taken_wall, it.exif!.taken_offset, loc.latitude, loc.longitude);
      patch(it.id, { status: "uploading", error: undefined });
      try {
        const latest = stateRef.current.items.find((i) => i.id === it.id) ?? it;
        const photo = await uploadPhoto(opts.userId, it.compressed!, it.exif!, {
          latitude: loc.latitude,
          longitude: loc.longitude,
          is_manual_location: loc.source !== "gps",
          taken_at,
          taken_tz,
          title: en(pick(it.title, s.shared.title)),
          description: en(pick(it.description, s.shared.description)),
          location_name: effectiveLocationName(latest, stateRef.current.shared) || null,
          photographer_name: photographer,
          tags: latest.tags,
          is_private: s.shared.isPrivate,
        });
        uploaded.push(photo);
        patch(it.id, { status: "done", photo });
      } catch (err) {
        patch(it.id, { status: "error", error: err instanceof Error ? err.message : "Upload failed" });
      }
    });

    dispatch({ type: "submitting", value: false });
    if (uploaded.length) opts.onUploaded(uploaded);
    // Everything went up → clear the batch; failures stay for a retry
    if (!stateRef.current.items.some((i) => i.status === "error" || i.status === "processing" || i.status === "queued")) reset();
  }, [opts, patch, reset]);

  const located = state.items.filter((i) => resolveLocation(i, state.sharedLocation));
  const counts = {
    total: state.items.length,
    processing: state.items.filter((i) => i.status === "queued" || i.status === "processing").length,
    ready: state.items.filter((i) => (i.status === "ready" || i.status === "error") && i.compressed).length,
    needLocation: state.items.filter((i) => i.compressed && i.status !== "done" && !resolveLocation(i, state.sharedLocation)).length,
    uploadable: located.filter((i) => (i.status === "ready" || i.status === "error") && i.compressed).length,
    uploading: state.items.filter((i) => i.status === "uploading").length,
    done: state.items.filter((i) => i.status === "done").length,
    failed: state.items.filter((i) => i.status === "error").length,
  };

  return {
    state,
    counts,
    addFiles,
    removeItem,
    reset,
    submit,
    patch,
    addTag,
    removeTag,
    setShared: (p: Partial<SharedFields>) => dispatch({ type: "shared", patch: p }),
    setSharedLocation: (loc: LatLng | null) => dispatch({ type: "sharedLocation", loc }),
  };
}
