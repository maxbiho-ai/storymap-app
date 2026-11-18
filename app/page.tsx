"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { MapProvider, useMap } from "react-map-gl";
import PhotoSearchBar from "@/components/PhotoSearchBar";
import PhotoUploader from "@/components/PhotoUploader";
import FloatingGallery from "@/components/gallery/FloatingGallery";
import PhotoDrawer from "@/components/map/PhotoDrawer";
import { usePhotoSearch } from "@/hooks/usePhotoSearch";
import { useMapStore, padBounds } from "@/store/mapStore";
import { MAP_ID } from "@/components/map/constants";
import type { Photo, PhotoFilters } from "@/types/photo";

// mapbox-gl נוגע ב-window — טוענים רק בדפדפן
const MapView = dynamic(() => import("@/components/map/MapView"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-neutral-900" />,
});

export default function Home() {
  return (
    <MapProvider>
      <StoryMap />
    </MapProvider>
  );
}

function StoryMap() {
  const { [MAP_ID]: map } = useMap();
  const [filters, setFilters] = useState<PhotoFilters>({ query: "", tags: [] });
  const [uploadOpen, setUploadOpen] = useState(false);

  const bounds = useMapStore((s) => s.bounds);
  const pickMode = useMapStore((s) => s.pickMode);
  const pickedLocation = useMapStore((s) => s.pickedLocation);
  const startPick = useMapStore((s) => s.startPick);
  const setPicked = useMapStore((s) => s.setPicked);
  const select = useMapStore((s) => s.select);
  const selectedId = useMapStore((s) => s.selectedId);

  // סינון (תגיות/טקסט) + האזור הנראה (מרופד) → שאילתה אחת
  const query = useMemo<PhotoFilters>(
    () => ({ ...filters, bounds: bounds ? padBounds(bounds) : undefined }),
    [filters, bounds],
  );
  const { photos, loading, error, refresh } = usePhotoSearch(query);

  const selectedPhoto = selectedId ? photos.find((p) => p.id === selectedId) : undefined;

  const onUploaded = (p: Photo) => {
    refresh();
    setUploadOpen(false);
    map?.flyTo({ center: [p.longitude, p.latitude], zoom: Math.max(map.getZoom(), 12), essential: true });
    setTimeout(() => select(p.id), 1200);
  };

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-neutral-950">
      <div className="absolute inset-0">
        <MapView photos={photos} />
      </div>

      {/* סרגל עליון */}
      <header
        dir="rtl"
        className={`pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start gap-3 p-3 md:p-4 ${pickMode ? "opacity-0" : ""}`}
      >
        <div className="pointer-events-auto hidden shrink-0 rounded-2xl bg-neutral-950/80 px-4 py-2.5 shadow-lg backdrop-blur md:block">
          <span className="text-sm font-black tracking-[0.25em] text-white">STORY<span className="text-amber-300">MAP</span></span>
        </div>
        <div className="pointer-events-auto min-w-0 flex-1">
          <PhotoSearchBar value={filters} onChange={setFilters} resultCount={photos.length} loading={loading} />
          {error && <p className="mt-1 rounded-lg bg-red-950/80 px-3 py-1 text-xs text-red-200">{error}</p>}
        </div>
        <button
          type="button"
          onClick={() => setUploadOpen((o) => !o)}
          className="pointer-events-auto flex h-11 shrink-0 items-center gap-2 rounded-2xl bg-amber-300 px-4 text-sm font-semibold text-neutral-900 shadow-lg hover:bg-amber-200"
        >
          <span className="text-lg leading-none">+</span>
          <span className="hidden sm:inline">העלאה</span>
        </button>
      </header>

      <FloatingGallery photos={photos} loading={loading} />

      {selectedPhoto && !pickMode && <PhotoDrawer photo={selectedPhoto} onClose={() => select(null)} />}

      {/*
        פאנל העלאה: נשאר mounted גם כשמוסתר (במצב בחירה), כדי לא לאבד את
        התמונה המכווצת והטופס. אחרי לחיצה על המפה — חוזר עם הקואורדינטות.
      */}
      <div
        className={`absolute z-30 max-h-[85dvh] overflow-y-auto rounded-2xl shadow-2xl
          inset-x-2 bottom-2 md:inset-x-auto md:bottom-auto md:end-4 md:top-24 md:w-[400px]
          ${uploadOpen && !pickMode ? "" : "hidden"}`}
      >
        <div dir="rtl" className="flex items-center justify-between rounded-t-2xl bg-white px-4 pt-3 dark:bg-neutral-900">
          <h2 className="text-sm font-semibold">העלאת תמונה</h2>
          <button type="button" onClick={() => setUploadOpen(false)} aria-label="סגור" className="text-xl leading-none text-neutral-400 hover:text-neutral-700">×</button>
        </div>
        <PhotoUploader
          onUploaded={onUploaded}
          pickedLocation={pickedLocation}
          onRequestLocationPick={() => {
            if (!uploadOpen) setUploadOpen(true);
            startPick();
          }}
          onReset={() => setPicked(null)}
        />
      </div>
    </main>
  );
}
