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
import { stackOf } from "@/hooks/useClusters";
import { MAP_ID } from "@/components/map/constants";
import ListsMenu from "@/components/social/ListsMenu";
import NotificationsBell, { type AppNotification } from "@/components/social/NotificationsBell";
import { useSocialStore } from "@/store/socialStore";
import { useCollectionPhotos, googleMapsRouteUrl, GOOGLE_MAPS_MAX_STOPS } from "@/hooks/useCollectionPhotos";
import { EMPTY_FILTERS, type Photo, type PhotoFilters } from "@/types/photo";

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

  // Filters (text / #tags / @photographer / place) + the visible area (padded) → one query.
  // A searched place brings its own bbox, so panning doesn't re-query.
  const query = useMemo<PhotoFilters>(
    () => ({ ...filters, bounds: bounds && !filters.area ? padBounds(bounds) : undefined }),
    [filters, bounds],
  );
  const { photos: loaded, loading, error, refresh } = usePhotoSearch(query);
  // Owner edits (location name / GPS) apply at once, before the next query returns them
  const edits = useMapStore((s) => s.edits);
  const deleted = useMapStore((s) => s.deleted);

  // Trip list view: only that list's pins, in saved order, joined by a route line
  const activeCollection = useMapStore((s) => s.activeCollection);
  const setActiveCollection = useMapStore((s) => s.setActiveCollection);
  const listVersion = useSocialStore((s) => s.version);
  const { photos: listPhotos, loading: listLoading } = useCollectionPhotos(activeCollection?.id ?? null, listVersion);

  const photos = useMemo(() => {
    let base = activeCollection ? filterLocally(listPhotos, filters) : loaded;
    if (Object.keys(deleted).length) base = base.filter((p) => !deleted[p.id]);
    return Object.keys(edits).length ? base.map((p) => (edits[p.id] ? { ...p, ...edits[p.id] } : p)) : base;
  }, [activeCollection, listPhotos, loaded, filters, edits, deleted]);
  const route = useMemo<[number, number][] | undefined>(
    () => (activeCollection ? photos.map((p) => [p.longitude, p.latitude]) : undefined),
    [activeCollection, photos],
  );
  const routeUrl = activeCollection ? googleMapsRouteUrl(photos) : null;
  const gpsEdit = useMapStore((s) => s.gpsEdit);
  const setCurrentUser = useMapStore((s) => s.setCurrentUser);
  const selectedPhoto = selectedId ? photos.find((p) => p.id === selectedId) : undefined;
  const selectedStack = useMemo(() => (selectedPhoto ? stackOf(photos, selectedPhoto) : []), [photos, selectedPhoto]);

  // Login / logout changes what RLS returns (private photos): reload
  const userId = user?.id ?? null;
  useEffect(() => setCurrentUser(userId), [userId, setCurrentUser]);
  useEffect(() => {
    refresh();
    if (userId) void useSocialStore.getState().loadCollections();
    else {
      setActiveCollection(null);
      useSocialStore.getState().reset();
    }
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

  // Guest tried to like / save / comment → login
  const loginRequest = useMapStore((s) => s.loginRequest);
  useEffect(() => {
    if (loginRequest) setAuthOpen(true);
  }, [loginRequest]);

  // Searched place (Germany, Frankfurt…) → fit the map to it
  const area = filters.area;
  useEffect(() => {
    if (!map || !area) return;
    const [w, s, e, n] = area.bbox;
    // Areas spanning (nearly) the whole globe or the date line (Russia, Fiji…): fly to the center
    if (e - w > 300 || w > e) {
      map.flyTo({ center: area.center, zoom: 3, duration: 1800, essential: true });
    } else {
      map.fitBounds([[w, s], [e, n]], { padding: 80, maxZoom: area.kind === "country" ? 7 : 12, duration: 1800 });
    }
  }, [area, map]);

  // Trip list opened → fit every pin of the list
  const fittedList = useRef<string | null>(null);
  useEffect(() => {
    if (!activeCollection) {
      fittedList.current = null;
      return;
    }
    if (!map || listLoading || fittedList.current === activeCollection.id || !listPhotos.length) return;
    fittedList.current = activeCollection.id;
    const lats = listPhotos.map((p) => p.latitude);
    const lngs = listPhotos.map((p) => p.longitude);
    if (listPhotos.length === 1) map.flyTo({ center: [lngs[0], lats[0]], zoom: Math.max(map.getZoom(), 11), essential: true });
    else map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 100, maxZoom: 13, duration: 1500 });
  }, [activeCollection, listPhotos, listLoading, map]);

  // A different pin was opened → the "open its comments" request from a notification is done
  const commentsFor = useMapStore((s) => s.commentsFor);
  const openComments = useMapStore((s) => s.openComments);
  useEffect(() => {
    if (commentsFor && selectedId !== commentsFor) openComments(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Notification → clear filters, fly to the pin, open the card (and its thread)
  const onNotification = useCallback(
    (n: AppNotification) => {
      if (!n.photo) return;
      setFilters(EMPTY_FILTERS);
      setActiveCollection(null);
      select(n.photo.id);
      openComments(n.type === "like" ? null : n.photo.id);
      map?.flyTo({ center: [n.photo.longitude, n.photo.latitude], zoom: Math.max(map.getZoom(), 14), duration: 2000, essential: true });
    },
    [map, select, setFilters, setActiveCollection, openComments],
  );

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
        <MapView photos={photos} route={route} />
      </div>

      {/* Top bar */}
      <header className={`pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start gap-3 p-3 md:p-4 ${pickMode || gpsEdit ? "opacity-0 [&_*]:!pointer-events-none" : ""}`}>
        <div className="pointer-events-auto hidden shrink-0 rounded-2xl bg-neutral-950/80 px-4 py-2.5 shadow-lg backdrop-blur md:block">
          <span className="text-sm font-black tracking-[0.25em] text-white">STORY<span className="text-amber-300">MAP</span></span>
        </div>
        <div className="pointer-events-auto min-w-0 flex-1">
          <PhotoSearchBar value={filters} onChange={setFilters} resultCount={photos.length} loading={activeCollection ? listLoading : loading} />
          {activeCollection && (
            <div className="mt-1 flex max-w-xl flex-wrap items-center gap-2 rounded-2xl bg-neutral-950/85 px-3 py-2 text-xs text-neutral-200 shadow-lg backdrop-blur">
              <span className="font-semibold text-amber-300" dir="auto">🧭 {activeCollection.name}</span>
              <span className="text-neutral-400">{photos.length} stop{photos.length === 1 ? "" : "s"}</span>
              {routeUrl && (
                <a
                  href={routeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={photos.length > GOOGLE_MAPS_MAX_STOPS ? `Google Maps takes the first ${GOOGLE_MAPS_MAX_STOPS} stops` : "Directions through every pin"}
                  className="rounded-full bg-amber-300 px-2.5 py-1 font-semibold text-neutral-900 hover:bg-amber-200"
                >
                  Open Route in Google Maps{photos.length > GOOGLE_MAPS_MAX_STOPS ? ` (first ${GOOGLE_MAPS_MAX_STOPS})` : ""}
                </a>
              )}
              {!listLoading && !photos.length && <span className="text-neutral-400">Empty list: save pins with the bookmark button.</span>}
              <button type="button" onClick={() => setActiveCollection(null)} className="ml-auto rounded-full bg-white/10 px-2 py-0.5 hover:bg-white/20">
                Show all ×
              </button>
            </div>
          )}
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
        <div className="pointer-events-auto flex gap-2">
          <ListsMenu />
          <NotificationsBell onNavigate={onNotification} />
        </div>
        <div className="pointer-events-auto">
          <AuthButton user={user} loading={authLoading} onLogin={() => { setUploadAfterLogin(false); setAuthOpen(true); }} onSignOut={signOut} />
        </div>
      </header>

      <FloatingGallery photos={photos} loading={loading} />

      {selectedPhoto && !pickMode && !gpsEdit && <PhotoDrawer photo={selectedPhoto} stack={selectedStack} onClose={() => select(null)} />}

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

/** Text / #tag / @photographer / place filters applied to an already-loaded list (trip view) */
function filterLocally(list: Photo[], f: Omit<PhotoFilters, "bounds">): Photo[] {
  const text = f.query.trim().toLowerCase();
  const who = f.photographer?.trim().toLowerCase();
  return list.filter((p) => {
    if (f.tags.length && !f.tags.every((t) => p.tags.includes(t))) return false;
    if (who && p.photographer_name?.toLowerCase() !== who) return false;
    if (text && ![p.location_name, p.title, p.tags.join(" ")].some((x) => x?.toLowerCase().includes(text))) return false;
    if (f.area) {
      const [w, s, e, n] = f.area.bbox;
      if (p.latitude < s || p.latitude > n) return false;
      if (w <= e ? p.longitude < w || p.longitude > e : p.longitude < w && p.longitude > e) return false;
    }
    return true;
  });
}
