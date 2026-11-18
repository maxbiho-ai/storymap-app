"use client";

import { create } from "zustand";

export interface Bounds { north: number; south: number; east: number; west: number }
export interface LatLng { latitude: number; longitude: number }

/**
 * State משותף בין המפה, הגלריה וטופס ההעלאה.
 * המפה עצמה (flyTo וכו') נגישה דרך useMap() של react-map-gl — לא דרך ה-store.
 */
interface MapState {
  /** הגבולות הנראים בפועל (מתעדכן ב-moveend) */
  bounds: Bounds | null;
  zoom: number;
  setViewport: (bounds: Bounds, zoom: number) => void;

  /** hover משותף: גלריה ↔ פין */
  hoveredId: string | null;
  setHovered: (id: string | null) => void;

  /** תמונה שה-Popup שלה פתוח */
  selectedId: string | null;
  select: (id: string | null) => void;

  /** מצב "בחר מיקום במפה" */
  pickMode: boolean;
  pickedLocation: LatLng | null;
  startPick: () => void;
  cancelPick: () => void;
  setPicked: (loc: LatLng | null) => void;
}

export const useMapStore = create<MapState>((set) => ({
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

/** האם נקודה בתוך גבולות (כולל מפה שחוצה את קו התאריך) */
export function inBounds(b: Bounds, lat: number, lng: number): boolean {
  if (lat < b.south || lat > b.north) return false;
  return b.west <= b.east ? lng >= b.west && lng <= b.east : lng >= b.west || lng <= b.east;
}

/** הרחבת הגבולות ב-X% לכל כיוון — טוענים מעט מעבר למסך כדי שפנינג קצר לא יציג מפה ריקה */
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

/** עיגול כדי שתזוזה של פיקסל לא תשלח שאילתה חדשה */
export function roundBounds(b: Bounds, digits = 3): Bounds {
  const r = (x: number) => Number(x.toFixed(digits));
  return { north: r(b.north), south: r(b.south), east: r(b.east), west: r(b.west) };
}
