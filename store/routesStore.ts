"use client";

import { create } from "zustand";
import type { CuratedRoute, CuratedRouteInsert } from "@/lib/readyRoutes";

/** A route being created or edited in the admin editor (id absent = new) */
export type RouteDraft = CuratedRouteInsert & { id?: string };

/** Route details carried into the Trip Planner's "Publish to Ready Routes" form */
export interface PlannerPrefill {
  title: string;
  slug: string;
  country: string;
  description: string;
  tips: string;
  published: boolean;
  sort_order: number;
}

interface RoutesState {
  /** The 🗺️ Ready Routes gallery */
  galleryOpen: boolean;
  setGalleryOpen: (open: boolean) => void;
  /** The route shown on the map with its sidebar itinerary */
  active: CuratedRoute | null;
  openRoute: (r: CuratedRoute) => void;
  closeRoute: () => void;
  /** Signed-in user is a StoryMap admin (app_is_admin): shows the management controls */
  isAdmin: boolean;
  setIsAdmin: (v: boolean) => void;
  /** Admin editor: a draft, "import" (start from a file / blank), or closed */
  editor: { draft: RouteDraft | null; mode: "edit" | "new" } | null;
  openEditor: (draft: RouteDraft | null) => void;
  closeEditor: () => void;
  /** Bumped after a save / delete so the gallery reloads */
  version: number;
  bump: () => void;
  plannerPrefill: PlannerPrefill | null;
  setPlannerPrefill: (p: PlannerPrefill | null) => void;
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
  isAdmin: false,
  setIsAdmin: (isAdmin) => set({ isAdmin }),
  editor: null,
  openEditor: (draft) => set({ editor: { draft, mode: draft?.id ? "edit" : "new" } }),
  closeEditor: () => set({ editor: null }),
  version: 0,
  bump: () => set((s) => ({ version: s.version + 1 })),
  plannerPrefill: null,
  setPlannerPrefill: (plannerPrefill) => set({ plannerPrefill }),
}));
