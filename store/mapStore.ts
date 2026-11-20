"use client";

import { create } from "zustand";
import { EMPTY_FILTERS, type PhotoFilters } from "@/types/photo";

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

  /** "Pick location on map" mode */
  pickMode: boolean;
  pickedLocation: LatLng | null;
  startPick: () => void;
  cancelPick: () => void;
  setPicked: (loc: LatLng | null) => void;
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
  select: (selectedId) => set({ selectedId }),

  pickMode: false,
  pickedLocation: null,
  startPick: () => set({ pickMode: true, selectedId: null }),
  cancelPick: () => set({ pickMode: false }),
  setPicked: (pickedLocation) => set({ pickedLocation, pickMode: false }),
}));

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
