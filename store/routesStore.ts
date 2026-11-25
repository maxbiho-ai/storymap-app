"use client";

import { create } from "zustand";
import type { CuratedRoute } from "@/lib/readyRoutes";

interface RoutesState {
  /** The 🗺️ Ready Routes gallery */
  galleryOpen: boolean;
  setGalleryOpen: (open: boolean) => void;
  /** The route shown on the map with its sidebar itinerary */
  active: CuratedRoute | null;
  openRoute: (r: CuratedRoute) => void;
  closeRoute: () => void;
}

/** Keeps ?route=<slug> in the address bar in sync, so the page can be shared as is */
function syncUrl(slug: string | null) {
  if (typeof window === "undefined") return;
  const u = new URL(window.location.href);
  if (slug) u.searchParams.set("route", slug);
  else {
    u.searchParams.delete("route");
    for (const k of [...u.searchParams.keys()]) if (k.startsWith("utm_")) u.searchParams.delete(k);
  }
  window.history.replaceState(window.history.state, "", u.toString());
}

export const useRoutesStore = create<RoutesState>((set) => ({
  galleryOpen: false,
  setGalleryOpen: (galleryOpen) => set({ galleryOpen }),
  active: null,
  openRoute: (active) => {
    syncUrl(active.slug);
    set({ active, galleryOpen: false });
  },
  closeRoute: () => {
    syncUrl(null);
    set({ active: null });
  },
}));
