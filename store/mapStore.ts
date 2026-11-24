"use client";

import { create } from "zustand";
import { EMPTY_FILTERS, type Photo, type PhotoFilters } from "@/types/photo";
import { EMPTY_GEAR, type GearFilters } from "@/lib/gear";

export type MapMode = "dark" | "streets" | "satellite" | "terrain";
/** Pins / Dots (default), stacked Thumbnails, or a density Heatmap */
export type ViewMode = "dots" | "thumbs" | "heat";
export const DEFAULT_WALK_RADIUS_KM = 15;

export interface Bounds { north: number; south: number; east: number; west: number }
export interface LatLng { latitude: number; longitude: number }

/**
 * Shared state between the map, gallery, search bar, photo card and uploader.
 * The map itself (flyTo etc.) is reached through react-map-gl's useMap(), not the store.
 */
interface MapState {
  /** Search filters (bounds are added separately from the viewport) */
  filters: Omit<PhotoFilters, "bounds">;
  setFilters: (f: Omit<PhotoFilters, "bounds">) => void;
  /** Click on a photographer name → show only their photos */
  setPhotographer: (name: string | null) => void;

  /** The bounds actually on screen (updated on moveend) */
  bounds: Bounds | null;
  zoom: number;
  setViewport: (bounds: Bounds, zoom: number) => void;

  /** Shared hover: gallery ↔ pin */
  hoveredId: string | null;
  setHovered: (id: string | null) => void;

  /** Photo whose card is open */
  selectedId: string | null;
  select: (id: string | null) => void;
  /** A clicked cluster: its photos browsed in order in the card carousel (null = the pin's own group) */
  carouselIds: string[] | null;
  openCarousel: (ids: string[]) => void;

  /** Map view mode switcher */
  viewMode: ViewMode;
  setViewMode: (m: ViewMode) => void;
  /** "Spread Exact GPS Spots": split groups into one sub-pin per exact GPS coordinate */
  exactGps: boolean;
  setExactGps: (on: boolean) => void;
  /** Country picked on the map / in the sidebar (canonical name) */
  countryFilter: string | null;
  setCountryFilter: (c: string | null) => void;
  /** A place picked in the sidebar (exact location name) */
  spotFilter: string | null;
  setSpotFilter: (name: string | null) => void;
  /** Dashed chronological line through the filtered photos */
  showTimeline: boolean;
  setShowTimeline: (on: boolean) => void;

  /** "Pick location on map" mode */
  pickMode: boolean;
  pickedLocation: LatLng | null;
  startPick: () => void;
  cancelPick: () => void;
  setPicked: (loc: LatLng | null) => void;

  /** Logged-in user (owner-only controls on the card) */
  currentUserId: string | null;
  setCurrentUser: (id: string | null) => void;

  /** Inline GPS editor "Pick on Map": the next map click fills the card's coordinate field */
  gpsPick: { photoId: string; point: LatLng | null } | null;
  startGpsPick: (photoId: string) => void;
  setGpsPickPoint: (point: LatLng | null) => void;
  endGpsPick: () => void;

  /** Owner "Edit GPS" mode: a draggable marker on the map for one photo */
  gpsEdit: { photoId: string; point: LatLng; original: LatLng } | null;
  startGpsEdit: (photoId: string, original: LatLng) => void;
  setGpsEditPoint: (point: LatLng) => void;
  cancelGpsEdit: () => void;

  /** Saved owner edits, merged over the loaded photos until the next query returns them */
  edits: Record<string, Partial<Photo>>;
  applyEdit: (id: string, patch: Partial<Photo>) => void;

  /** Photos the owner deleted: hidden at once, before the next query */
  deleted: Record<string, true>;
  markDeleted: (id: string) => void;

  /** Signed-in user's saved list shown on the map as a trip route (null = normal map) */
  activeCollection: { id: string; name: string } | null;
  setActiveCollection: (c: { id: string; name: string } | null) => void;

  /** Open the comments thread of this photo (notification click) */
  commentsFor: string | null;
  openComments: (photoId: string | null) => void;

  /** Mobile: the Destinations / matching-photos half-sheet */
  destinationsOpen: boolean;
  setDestinationsOpen: (open: boolean) => void;

  /** Visited-country overlay (fill, outline and country pills) */
  countriesOn: boolean;
  setCountriesOn: (on: boolean) => void;

  /** Base map: dark vector, streets, satellite hybrid, or satellite + 3D terrain */
  mapMode: MapMode;
  setMapMode: (m: MapMode) => void;

  /** Lighting / long exposure / lens filters (applied client-side to the loaded pins) */
  gear: GearFilters;
  setGear: (g: GearFilters) => void;

  /** Nearby Photo Walk: pins within radiusKm of the origin pin, ordered by shooting light */
  walk: { origin: Photo; radiusKm: number } | null;
  walkStops: Photo[];
  startWalk: (origin: Photo) => void;
  setWalkRadius: (km: number) => void;
  setWalkStops: (p: Photo[]) => void;
  endWalk: () => void;

  /** A guest tried a signed-in action (like, save, comment): page opens the login modal */
  loginRequest: number;
  requestLogin: () => void;
}

export const useMapStore = create<MapState>((set) => ({
  filters: EMPTY_FILTERS,
  setFilters: (filters) => set({ filters }),
  setPhotographer: (photographer) => set((s) => ({ filters: { ...s.filters, photographer } })),

  bounds: null,
  zoom: 1.6,
  setViewport: (bounds, zoom) => set({ bounds, zoom }),

  hoveredId: null,
  setHovered: (hoveredId) => set({ hoveredId }),

  selectedId: null,
  select: (selectedId) => set((s) => ({ selectedId, carouselIds: selectedId && s.carouselIds?.includes(selectedId) ? s.carouselIds : null })),
  carouselIds: null,
  openCarousel: (ids) => set({ carouselIds: ids.length > 1 ? ids : null, selectedId: ids[0] ?? null }),

  viewMode: "dots",
  setViewMode: (viewMode) => set({ viewMode }),
  exactGps: false,
  setExactGps: (exactGps) => set({ exactGps }),
  countryFilter: null,
  setCountryFilter: (countryFilter) => set({ countryFilter, spotFilter: null }),
  spotFilter: null,
  setSpotFilter: (spotFilter) => set({ spotFilter }),
  showTimeline: false,
  setShowTimeline: (showTimeline) => set({ showTimeline }),

  pickMode: false,
  pickedLocation: null,
  startPick: () => set({ pickMode: true, selectedId: null, carouselIds: null, gpsEdit: null }),
  cancelPick: () => set({ pickMode: false }),
  setPicked: (pickedLocation) => set({ pickedLocation, pickMode: false }),

  currentUserId: null,
  setCurrentUser: (currentUserId) => set({ currentUserId }),

  gpsPick: null,
  startGpsPick: (photoId) => set({ gpsPick: { photoId, point: null } }),
  setGpsPickPoint: (point) => set((s) => (s.gpsPick ? { gpsPick: { ...s.gpsPick, point } } : {})),
  endGpsPick: () => set({ gpsPick: null }),

  gpsEdit: null,
  startGpsEdit: (photoId, original) => set({ gpsEdit: { photoId, original, point: original }, pickMode: false }),
  setGpsEditPoint: (point) => set((s) => (s.gpsEdit ? { gpsEdit: { ...s.gpsEdit, point } } : {})),
  cancelGpsEdit: () => set({ gpsEdit: null }),

  edits: {},
  applyEdit: (id, patch) => set((s) => ({ edits: { ...s.edits, [id]: { ...s.edits[id], ...patch } } })),

  deleted: {},
  markDeleted: (id) =>
    set((s) => ({ deleted: { ...s.deleted, [id]: true }, selectedId: s.selectedId === id ? null : s.selectedId, carouselIds: s.carouselIds?.filter((x) => x !== id) ?? null, hoveredId: s.hoveredId === id ? null : s.hoveredId })),

  activeCollection: null,
  setActiveCollection: (activeCollection) => set((s) => (activeCollection ? { activeCollection, walk: null, walkStops: [] } : { activeCollection })),

  commentsFor: null,
  openComments: (commentsFor) => set({ commentsFor }),

  destinationsOpen: false,
  setDestinationsOpen: (destinationsOpen) => set({ destinationsOpen }),

  countriesOn: true,
  setCountriesOn: (countriesOn) => set({ countriesOn }),

  mapMode: "dark",
  setMapMode: (mapMode) => set({ mapMode }),

  gear: EMPTY_GEAR,
  setGear: (gear) => set({ gear }),

  walk: null,
  walkStops: [],
  startWalk: (origin) => set((s) => ({ walk: { origin, radiusKm: s.walk?.radiusKm ?? DEFAULT_WALK_RADIUS_KM }, walkStops: [], activeCollection: null })),
  setWalkRadius: (radiusKm) => set((s) => (s.walk ? { walk: { ...s.walk, radiusKm } } : {})),
  setWalkStops: (walkStops) => set({ walkStops }),
  endWalk: () => set({ walk: null, walkStops: [] }),

  loginRequest: 0,
  requestLogin: () => set((s) => ({ loginRequest: s.loginRequest + 1 })),
}));

/* ------------------------------------------------------------------ */
/* Persisted map view preferences (localStorage)                       */
/* ------------------------------------------------------------------ */

const PREFS_KEY = "storymap:view-prefs:v1";
const MAP_MODES: readonly MapMode[] = ["dark", "streets", "satellite", "terrain"];
const VIEW_MODES: readonly ViewMode[] = ["dots", "thumbs", "heat"];

interface ViewPrefs { mapMode: MapMode; viewMode: ViewMode; countriesOn: boolean }

/** Reads and validates the saved prefs; anything missing or invalid falls back to the defaults field by field */
function readPrefs(): Partial<ViewPrefs> {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null") as Record<string, unknown> | null;
    if (!raw || typeof raw !== "object") return {};
    const out: Partial<ViewPrefs> = {};
    if (MAP_MODES.includes(raw.mapMode as MapMode)) out.mapMode = raw.mapMode as MapMode;
    if (VIEW_MODES.includes(raw.viewMode as ViewMode)) out.viewMode = raw.viewMode as ViewMode;
    if (typeof raw.countriesOn === "boolean") out.countriesOn = raw.countriesOn;
    return out;
  } catch {
    return {};
  }
}

let prefsStarted = false;

/** Browser only, once: applies the saved prefs to the store, then saves every later change */
export function startViewPrefs(): void {
  if (prefsStarted || typeof window === "undefined") return;
  prefsStarted = true;
  useMapStore.setState(readPrefs());
  useMapStore.subscribe((s, prev) => {
    if (s.mapMode === prev.mapMode && s.viewMode === prev.viewMode && s.countriesOn === prev.countriesOn) return;
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ mapMode: s.mapMode, viewMode: s.viewMode, countriesOn: s.countriesOn } satisfies ViewPrefs));
    } catch {
      /* storage full / blocked: the prefs just aren't remembered */
    }
  });
}

/** Is a point inside bounds (handles maps crossing the date line) */
export function inBounds(b: Bounds, lat: number, lng: number): boolean {
  if (lat < b.south || lat > b.north) return false;
  return b.west <= b.east ? lng >= b.west && lng <= b.east : lng >= b.west || lng <= b.east;
}

/** Pads bounds by X% each way, so a short pan never shows an empty map */
export function padBounds(b: Bounds, ratio = 0.25): Bounds {
  const dLat = (b.north - b.south) * ratio;
  const width = b.west <= b.east ? b.east - b.west : 360 - b.west + b.east;
  const dLng = width * ratio;
  if (width + 2 * dLng >= 360) return { north: Math.min(90, b.north + dLat), south: Math.max(-90, b.south - dLat), west: -180, east: 180 };
  const wrap = (x: number) => (x > 180 ? x - 360 : x < -180 ? x + 360 : x);
  return {
    north: Math.min(90, b.north + dLat),
    south: Math.max(-90, b.south - dLat),
    west: wrap(b.west - dLng),
    east: wrap(b.east + dLng),
  };
}

/** Rounded, so a 1px move does not trigger a new query */
export function roundBounds(b: Bounds, digits = 3): Bounds {
  const r = (x: number) => Number(x.toFixed(digits));
  return { north: r(b.north), south: r(b.south), east: r(b.east), west: r(b.west) };
}
