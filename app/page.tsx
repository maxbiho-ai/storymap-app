"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { MapProvider, useMap } from "react-map-gl";
import PhotoSearchBar from "@/components/PhotoSearchBar";
import BatchUploader from "@/components/upload/BatchUploader";
import FloatingGallery from "@/components/gallery/FloatingGallery";
import PhotoDrawer from "@/components/map/PhotoDrawer";
import AuthButton from "@/components/auth/AuthButton";
import AuthModal from "@/components/auth/AuthModal";
import { useAuth } from "@/hooks/useAuth";
import { getSupabase } from "@/lib/supabase/client";
import { usePhotoSearch, escapeLike } from "@/hooks/usePhotoSearch";
import { useMapStore, padBounds } from "@/store/mapStore";
import { MAP_ID } from "@/components/map/constants";
import type { Photo, PhotoFilters } from "@/types/photo";

// mapbox-gl touches window: browser only
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
  const [uploadOpen, setUploadOpen] = useState(false);
  const { user, loading: authLoading, signOut } = useAuth();
  const [authOpen, setAuthOpen] = useState(false);
  // Guest clicked "Upload": open the uploader right after login
  const [uploadAfterLogin, setUploadAfterLogin] = useState(false);
  const [profileName, setProfileName] = useState("");

  const filters = useMapStore((s) => s.filters);
  const setFilters = useMapStore((s) => s.setFilters);
  const setPhotographer = useMapStore((s) => s.setPhotographer);
  const bounds = useMapStore((s) => s.bounds);
  const pickMode = useMapStore((s) => s.pickMode);
  const pickedLocation = useMapStore((s) => s.pickedLocation);
  const startPick = useMapStore((s) => s.startPick);
  const setPicked = useMapStore((s) => s.setPicked);
  const select = useMapStore((s) => s.select);
  const selectedId = useMapStore((s) => s.selectedId);

  // Filters (text / #tags / @photographer) + the visible area (padded) → one query
  const query = useMemo<PhotoFilters>(
    () => ({ ...filters, bounds: bounds ? padBounds(bounds) : undefined }),
    [filters, bounds],
  );
  const { photos, loading, error, refresh } = usePhotoSearch(query);
  const selectedPhoto = selectedId ? photos.find((p) => p.id === selectedId) : undefined;

  // Login / logout changes what RLS returns (private photos): reload
  const userId = user?.id ?? null;
  useEffect(() => {
    refresh();
    if (!userId) setUploadOpen(false);
    else if (uploadAfterLogin) {
      setUploadOpen(true);
      setUploadAfterLogin(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Default photographer name = profile full name (fallback: sign-up metadata)
  useEffect(() => {
    if (!user) return setProfileName("");
    const meta = (user.user_metadata?.full_name as string | undefined) ?? "";
    setProfileName(meta);
    getSupabase()
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => data?.full_name && setProfileName(data.full_name as string));
  }, [user]);

  // Direct pin link (pinUrl from the API): /?pin=<id> → fly there and open the card
  const deepLinkDone = useRef(false);
  useEffect(() => {
    if (!map || deepLinkDone.current) return;
    const pinId = new URLSearchParams(window.location.search).get("pin");
    if (!pinId) return;
    deepLinkDone.current = true;
    getSupabase()
      .from("photos")
      .select("id, latitude, longitude")
      .eq("id", pinId)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        map.flyTo({ center: [data.longitude, data.latitude], zoom: 14, duration: 2500, essential: true });
        select(data.id); // the card opens as soon as the pin loads with the new bounds
      });
  }, [map, select]);

  // Photographer filter → zoom out to everything they shot
  useEffect(() => {
    const name = filters.photographer;
    if (!map || !name) return;
    let cancelled = false;
    getSupabase()
      .from("photos")
      .select("latitude, longitude")
      .ilike("photographer_name", escapeLike(name))
      .limit(1000)
      .then(({ data }) => {
        if (cancelled || !data?.length) return;
        const lats = data.map((p) => p.latitude as number);
        const lngs = data.map((p) => p.longitude as number);
        if (data.length === 1) {
          map.flyTo({ center: [lngs[0], lats[0]], zoom: Math.max(map.getZoom(), 10), essential: true });
        } else {
          map.fitBounds(
            [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
            { padding: 100, maxZoom: 12, duration: 1500 },
          );
        }
      });
    return () => { cancelled = true; };
  }, [filters.photographer, map]);

  const toggleUpload = () => {
    if (!user) {
      setUploadAfterLogin(true);
      setAuthOpen(true);
      return;
    }
    setUploadOpen((o) => !o);
  };

  const onUploaded = useCallback(
    (uploaded: Photo[]) => {
      refresh();
      setUploadOpen(false);
      if (!map || !uploaded.length) return;

      // First name typed on upload becomes the profile name (if the profile had none)
      const typed = uploaded[0].photographer_name;
      if (user && typed && !profileName) {
        void getSupabase().from("profiles").update({ full_name: typed }).eq("id", user.id);
        setProfileName(typed);
      }

      if (uploaded.length === 1) {
        const p = uploaded[0];
        map.flyTo({ center: [p.longitude, p.latitude], zoom: Math.max(map.getZoom(), 12), essential: true });
        setTimeout(() => select(p.id), 1200);
      } else {
        const lats = uploaded.map((p) => p.latitude);
        const lngs = uploaded.map((p) => p.longitude);
        map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], {
          padding: 120,
          maxZoom: 13,
          duration: 1500,
        });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [map, user, profileName],
  );

  const requestPick = useCallback(() => {
    setUploadOpen(true);
    startPick();
  }, [startPick]);
  const clearPicked = useCallback(() => setPicked(null), [setPicked]);

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-neutral-950">
      <div className="absolute inset-0">
        <MapView photos={photos} />
      </div>

      {/* Top bar */}
      <header className={`pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start gap-3 p-3 md:p-4 ${pickMode ? "opacity-0" : ""}`}>
        <div className="pointer-events-auto hidden shrink-0 rounded-2xl bg-neutral-950/80 px-4 py-2.5 shadow-lg backdrop-blur md:block">
          <span className="text-sm font-black tracking-[0.25em] text-white">STORY<span className="text-amber-300">MAP</span></span>
        </div>
        <div className="pointer-events-auto min-w-0 flex-1">
          <PhotoSearchBar value={filters} onChange={setFilters} resultCount={photos.length} loading={loading} />
          {filters.photographer && (
            <button
              type="button"
              onClick={() => setPhotographer(null)}
              className="mt-1 inline-flex items-center gap-2 rounded-full bg-amber-300 px-3 py-1 text-xs font-semibold text-neutral-900 shadow-lg hover:bg-amber-200"
            >
              Showing only {filters.photographer}
              <span className="rounded-full bg-neutral-900/10 px-1.5">Show all ×</span>
            </button>
          )}
          {error && <p className="mt-1 rounded-lg bg-red-950/80 px-3 py-1 text-xs text-red-200">{error}</p>}
        </div>
        <button
          type="button"
          onClick={toggleUpload}
          className="pointer-events-auto flex h-11 shrink-0 items-center gap-2 rounded-2xl bg-amber-300 px-4 text-sm font-semibold text-neutral-900 shadow-lg hover:bg-amber-200"
        >
          <span className="text-lg leading-none">+</span>
          <span className="hidden sm:inline">Upload</span>
        </button>
        <div className="pointer-events-auto">
          <AuthButton user={user} loading={authLoading} onLogin={() => { setUploadAfterLogin(false); setAuthOpen(true); }} onSignOut={signOut} />
        </div>
      </header>

      <FloatingGallery photos={photos} loading={loading} />

      {selectedPhoto && !pickMode && <PhotoDrawer photo={selectedPhoto} onClose={() => select(null)} />}

      {/*
        Upload panel stays mounted while hidden (pick mode), so the compressed photos
        and the form survive; after the map click it comes back with the coordinates.
      */}
      {user && (
        <div
          className={`absolute z-30 flex max-h-[85dvh] flex-col overflow-hidden rounded-2xl shadow-2xl
            inset-x-2 bottom-2 md:inset-x-auto md:bottom-auto md:right-4 md:top-24 md:max-h-[calc(100dvh-7.5rem)] md:w-[420px]
            ${uploadOpen && !pickMode ? "" : "hidden"}`}
        >
          <div className="flex items-center justify-between bg-white px-4 pt-3 text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100">
            <h2 className="text-sm font-semibold">Upload photos</h2>
            <button type="button" onClick={() => setUploadOpen(false)} aria-label="Close" className="text-xl leading-none text-neutral-400 hover:text-neutral-700">×</button>
          </div>
          <BatchUploader
            userId={user.id}
            defaultPhotographer={profileName}
            pickedLocation={pickedLocation}
            onRequestLocationPick={requestPick}
            onUploaded={onUploaded}
            onReset={clearPicked}
          />
        </div>
      )}
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </main>
  );
}
