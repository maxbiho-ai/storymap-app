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
import { useCreatorAccess } from "@/hooks/useCreatorAccess";
import { photosLeft, quotaLabel } from "@/lib/beta";
import InviteGateModal from "@/components/beta/InviteGateModal";
import AdminPanel from "@/components/admin/AdminPanel";
import { getSupabase } from "@/lib/supabase/client";
import { escapeLike } from "@/hooks/usePhotoSearch";
import { usePins } from "@/hooks/usePins";
import { useFullPhotos } from "@/hooks/useFullPhotos";
import { useMapStore, startViewPrefs } from "@/store/mapStore";
import { loadCountryIndex, resolveCountry } from "@/lib/countryGeo";
import type { CountryPill } from "@/components/map/CountryLayer";
import { boundsOf, groupPins, summarizePlaces, timelineCoords, toPin, type Pin } from "@/lib/pins";
import { MAP_ID } from "@/components/map/constants";
import ListsMenu from "@/components/social/ListsMenu";
import GearFilters from "@/components/map/GearFilters";
import NearbyWalkPanel from "@/components/map/NearbyWalkPanel";
import MapToolbar from "@/components/map/MapToolbar";
import TripPlanner from "@/components/trip/TripPlanner";
import { useTripStore } from "@/store/tripStore";
import { useIsDesktop } from "@/hooks/useIsDesktop";
import { lensOptions, matchesGear, gearCount, EMPTY_GEAR } from "@/lib/gear";
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
  const { user, loading: authLoading, signOut, recovery, endRecovery } = useAuth();
  const [authOpen, setAuthOpen] = useState(false);
  // Guest clicked "Upload": open the uploader right after login
  const [uploadAfterLogin, setUploadAfterLogin] = useState(false);
  const [profileName, setProfileName] = useState("");
  // Invite-only beta: who may upload, and the two modals around it
  const { access, loading: accessLoading, refresh: refreshAccess } = useCreatorAccess(user?.id ?? null);
  const [gateOpen, setGateOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const canUploadNow = access.isAdmin || access.canUpload;

  // Saved map view prefs (style, 3D, view mode, countries) are applied once on the client, before the map mounts
  const [prefsReady, setPrefsReady] = useState(false);
  useEffect(() => {
    startViewPrefs();
    setPrefsReady(true);
  }, []);
  // Country polygons: every photo's country comes from its coordinates (point-in-polygon), names are the fallback
  const [geoReady, setGeoReady] = useState(false);
  useEffect(() => {
    let alive = true;
    void loadCountryIndex().then((ok) => alive && ok && setGeoReady(true));
    return () => { alive = false; };
  }, []);

  const filters = useMapStore((s) => s.filters);
  const setFilters = useMapStore((s) => s.setFilters);
  const setPhotographer = useMapStore((s) => s.setPhotographer);
  const pickMode = useMapStore((s) => s.pickMode);
  const pickedLocation = useMapStore((s) => s.pickedLocation);
  const startPick = useMapStore((s) => s.startPick);
  const setPicked = useMapStore((s) => s.setPicked);
  const select = useMapStore((s) => s.select);
  const selectedId = useMapStore((s) => s.selectedId);
  const carouselIds = useMapStore((s) => s.carouselIds);
  const countryFilter = useMapStore((s) => s.countryFilter);
  const setCountryFilter = useMapStore((s) => s.setCountryFilter);
  const spotFilter = useMapStore((s) => s.spotFilter);
  const setSpotFilter = useMapStore((s) => s.setSpotFilter);
  const exactGps = useMapStore((s) => s.exactGps);
  const showTimeline = useMapStore((s) => s.showTimeline);
  const isDesktop = useIsDesktop();
  const tripOpen = useTripStore((s) => s.open);
  const setTripOpen = useTripStore((s) => s.setOpen);

  // The global pin layer: every photo matching the search (text / #tags / @photographer / place), whatever the
  // viewport and whatever the sidebar shows. Panning never re-queries.
  const dbFilters = useMemo(
    () => ({ query: filters.query, tags: filters.tags, photographer: filters.photographer, area: filters.area }),
    [filters],
  );
  const { pins: loadedPins, loading, error, refresh } = usePins(dbFilters);
  // Owner edits (location name / GPS) apply at once, before the next query returns them
  const edits = useMapStore((s) => s.edits);
  const deleted = useMapStore((s) => s.deleted);

  // Trip list view: only that list's pins, in saved order, joined by a route line
  const activeCollection = useMapStore((s) => s.activeCollection);
  const setActiveCollection = useMapStore((s) => s.setActiveCollection);
  const listVersion = useSocialStore((s) => s.version);
  const { photos: listPhotos, loading: listLoading } = useCollectionPhotos(activeCollection?.id ?? null, listVersion);

  // Lens / lighting / long-exposure filters apply to the pins
  const gear = useMapStore((s) => s.gear);
  const walk = useMapStore((s) => s.walk);
  const walkStops = useMapStore((s) => s.walkStops);
  const lenses = useMemo(() => lensOptions(activeCollection ? listPhotos : loadedPins), [activeCollection, listPhotos, loadedPins]);

  // Pins before the country / spot filters: feeds the country layer and the destinations list
  const pinsBase = useMemo(() => {
    let base: Pin[] = activeCollection ? filterLocally(listPhotos, filters).map(toPin) : loadedPins;
    if (gearCount(gear)) base = base.filter((p) => matchesGear(p, gear));
    // A Nearby Photo Walk always shows its origin and stops, wherever the viewport is
    if (walk) {
      const have = new Set(base.map((p) => p.id));
      base = [...base, ...[walk.origin, ...walkStops].filter((p) => !have.has(p.id)).map(toPin)];
    }
    if (Object.keys(deleted).length) base = base.filter((p) => !deleted[p.id]);
    if (Object.keys(edits).length) base = base.map((p) => (edits[p.id] ? toPin({ ...p, ...edits[p.id] }) : p));
    if (geoReady) {
      base = base.map((p) => {
        const country = resolveCountry(p);
        return country === p.country ? p : { ...p, country };
      });
    }
    return base;
  }, [activeCollection, listPhotos, loadedPins, filters, gear, walk, walkStops, edits, deleted, geoReady]);

  const pins = useMemo(() => {
    if (!countryFilter && !spotFilter) return pinsBase;
    return pinsBase.filter((p) => (!countryFilter || p.country === countryFilter) && (!spotFilter || p.location_name?.trim() === spotFilter));
  }, [pinsBase, countryFilter, spotFilter]);
  const groups = useMemo(() => groupPins(pins, exactGps), [pins, exactGps]);
  const countryCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of pinsBase) if (p.country) m.set(p.country, (m.get(p.country) ?? 0) + 1);
    return m;
  }, [pinsBase]);

  // One pill per visited country, on the photo nearest to the middle of that country's photos
  const countryPills = useMemo<CountryPill[]>(() => {
    const acc = new Map<string, { n: number; lat: number; lng: number; pins: Pin[] }>();
    for (const p of pinsBase) {
      if (!p.country) continue;
      const a = acc.get(p.country) ?? { n: 0, lat: 0, lng: 0, pins: [] };
      a.n++;
      a.lat += p.latitude;
      a.lng += p.longitude;
      if (a.pins.length < 400) a.pins.push(p);
      acc.set(p.country, a);
    }
    return [...acc].map(([name, a]) => {
      const mLat = a.lat / a.n;
      const mLng = a.lng / a.n;
      let best = a.pins[0];
      let bd = Infinity;
      for (const p of a.pins) {
        const d = (p.latitude - mLat) ** 2 + (p.longitude - mLng) ** 2;
        if (d < bd) { bd = d; best = p; }
      }
      return { name, count: a.n, latitude: best.latitude, longitude: best.longitude };
    });
  }, [pinsBase]);

  // Sidebar: destinations until something filters, then the photo grid (newest 500)
  const filtersActive = Boolean(
    filters.query.trim() || filters.tags.length || filters.photographer || filters.area || countryFilter || spotFilter || gearCount(gear) || activeCollection,
  );
  const summary = useMemo(() => (filtersActive ? [] : summarizePlaces(pinsBase)), [filtersActive, pinsBase]);
  const gridPins = useMemo(
    () => (filtersActive ? [...pins].sort((a, b) => (b.ts ?? -Infinity) - (a.ts ?? -Infinity)).slice(0, 500) : []),
    [filtersActive, pins],
  );
  const timeline = useMemo(
    () => (showTimeline && filtersActive && pins.length > 1 ? timelineCoords(pins) : undefined),
    [showTimeline, filtersActive, pins],
  );

  const route = useMemo<[number, number][] | undefined>(() => {
    if (walk) return [walk.origin, ...walkStops].map((p) => [p.longitude, p.latitude] as [number, number]);
    return activeCollection ? pins.map((p) => [p.longitude, p.latitude] as [number, number]) : undefined;
  }, [activeCollection, pins, walk, walkStops]);
  const routeUrl = activeCollection ? googleMapsRouteUrl(pins) : null;
  const gpsEdit = useMapStore((s) => s.gpsEdit);
  const setCurrentUser = useMapStore((s) => s.setCurrentUser);

  // The open card: the pin's spot (or the clicked cluster) as one carousel; full rows load on demand
  const spot = useMemo(() => {
    if (!selectedId) return { ids: [] as string[], members: null as Pin[] | null };
    const byCarousel = Boolean(carouselIds && carouselIds.includes(selectedId));
    const g = byCarousel ? undefined : groups.find((x) => x.members.some((m) => m.id === selectedId));
    const ids = byCarousel ? carouselIds! : g ? g.members.map((m) => m.id) : [selectedId];
    return { ids, members: g?.members ?? null };
  }, [selectedId, carouselIds, groups]);
  // Very large spots: load a window of 120 photos around the open one
  const stackIds = useMemo(() => {
    if (spot.ids.length <= 120) return spot.ids;
    const i = Math.max(0, spot.ids.indexOf(selectedId ?? ""));
    const from = Math.max(0, Math.min(i - 60, spot.ids.length - 120));
    return spot.ids.slice(from, from + 120);
  }, [spot.ids, selectedId]);
  const fullPhotos = useFullPhotos(stackIds);
  const selectedStack = useMemo(
    () => fullPhotos.filter((p) => !deleted[p.id]).map((p) => (edits[p.id] ? { ...p, ...edits[p.id] } : p)),
    [fullPhotos, edits, deleted],
  );
  const selectedPhoto = selectedId ? selectedStack.find((p) => p.id === selectedId) : undefined;
  const openSpot = useMemo(
    () => spot.members ?? (carouselIds && selectedId ? pins.filter((p) => carouselIds.includes(p.id)) : null),
    [spot.members, carouselIds, selectedId, pins],
  );

  const fitAll = useCallback(() => {
    const box = boundsOf(pins);
    if (!map || !box) return;
    if (box[0][0] === box[1][0] && box[0][1] === box[1][1]) map.flyTo({ center: box[0], zoom: 12, essential: true });
    else map.fitBounds(box, { padding: { top: 130, bottom: 80, left: isDesktop ? 400 : 50, right: 60 }, maxZoom: 14, duration: 1400 });
  }, [map, pins, isDesktop]);

  const clearFilters = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    setCountryFilter(null);
    setSpotFilter(null);
    useMapStore.getState().setGear(EMPTY_GEAR);
    setActiveCollection(null);
    select(null);
  }, [setFilters, setCountryFilter, setSpotFilter, setActiveCollection, select]);

  // A country / spot was picked: zoom to its pins (once per pick)
  const fittedFilter = useRef<string | null>(null);
  useEffect(() => {
    const key = countryFilter ? `c:${countryFilter}` : spotFilter ? `s:${spotFilter}` : null;
    if (!key) {
      fittedFilter.current = null;
      return;
    }
    if (!map || fittedFilter.current === key || !pins.length) return;
    const box = boundsOf(pins);
    if (!box) return;
    fittedFilter.current = key;
    const width = box[1][0] - box[0][0];
    if (width > 200) map.flyTo({ center: [(box[0][0] + box[1][0]) / 2, (box[0][1] + box[1][1]) / 2], zoom: 3, duration: 1600, essential: true });
    else if (box[0][0] === box[1][0] && box[0][1] === box[1][1]) map.flyTo({ center: box[0], zoom: 14, duration: 1400, essential: true });
    else map.fitBounds(box, { padding: { top: 130, bottom: 80, left: isDesktop ? 400 : 50, right: 60 }, maxZoom: countryFilter ? 7 : 15, duration: 1600 });
  }, [countryFilter, spotFilter, pins, map, isDesktop]);

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
    if (!userId) {
      setUploadOpen(false);
      setGateOpen(false);
      setAdminOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Clicked Upload while signed out: once logged in and the profile is read, open the uploader (or the invite modal)
  useEffect(() => {
    if (!uploadAfterLogin || !userId || accessLoading) return;
    setUploadAfterLogin(false);
    if (canUploadNow) setUploadOpen(true);
    else setGateOpen(true);
  }, [uploadAfterLogin, userId, accessLoading, canUploadNow]);

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
        select(data.id); // the card opens once its full row loads
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
      setCountryFilter(null);
      setSpotFilter(null);
      setActiveCollection(null);
      select(n.photo.id);
      openComments(n.type === "like" ? null : n.photo.id);
      map?.flyTo({ center: [n.photo.longitude, n.photo.latitude], zoom: Math.max(map.getZoom(), 14), duration: 2000, essential: true });
    },
    [map, select, setFilters, setCountryFilter, setSpotFilter, setActiveCollection, openComments],
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
    if (accessLoading) return;
    if (!canUploadNow) {
      setGateOpen(true);
      return;
    }
    setTripOpen(false);
    setUploadOpen((o) => !o);
  };

  const toggleTrip = () => {
    if (!tripOpen) {
      setUploadOpen(false);
      useMapStore.getState().endWalk();
      select(null);
    }
    setTripOpen(!tripOpen);
  };

  const onUploaded = useCallback(
    (uploaded: Photo[]) => {
      refresh();
      void refreshAccess();
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
    [map, user, profileName, refreshAccess],
  );

  const requestPick = useCallback(() => {
    setUploadOpen(true);
    startPick();
  }, [startPick]);
  const clearPicked = useCallback(() => setPicked(null), [setPicked]);

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-neutral-950">
      <div className="absolute inset-0">
        {prefsReady ? (
          <MapView pins={pins} groups={groups} selected={selectedPhoto} stack={selectedStack} countryCounts={countryCounts} countryPills={countryPills} route={route} timeline={timeline} />
        ) : (
          <div className="h-full w-full animate-pulse bg-neutral-900" />
        )}
      </div>

      {/* Top bar */}
      <header className={`pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start gap-3 p-3 md:p-4 ${pickMode || gpsEdit ? "opacity-0 [&_*]:!pointer-events-none" : ""}`}>
        <div className="pointer-events-auto hidden shrink-0 rounded-2xl bg-neutral-950/80 px-4 py-2.5 shadow-lg backdrop-blur md:block">
          <span className="text-sm font-black tracking-[0.25em] text-white">STORY<span className="text-amber-300">MAP</span></span>
        </div>
        <div className="pointer-events-auto min-w-0 flex-1">
          <PhotoSearchBar value={filters} onChange={setFilters} resultCount={pins.length} loading={activeCollection ? listLoading : loading} />
          <div className="mt-0.5">
            <GearFilters lenses={lenses} />
          </div>
          {activeCollection && (
            <div className="mt-1 flex max-w-xl flex-wrap items-center gap-2 rounded-2xl bg-neutral-950/85 px-3 py-2 text-xs text-neutral-200 shadow-lg backdrop-blur">
              <span className="font-semibold text-amber-300" dir="auto">🧭 {activeCollection.name}</span>
              <span className="text-neutral-400">{pins.length} stop{pins.length === 1 ? "" : "s"}</span>
              {routeUrl && (
                <a
                  href={routeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={pins.length > GOOGLE_MAPS_MAX_STOPS ? `Google Maps takes the first ${GOOGLE_MAPS_MAX_STOPS} stops` : "Directions through every pin"}
                  className="rounded-full bg-amber-300 px-2.5 py-1 font-semibold text-neutral-900 hover:bg-amber-200"
                >
                  Open Route in Google Maps{pins.length > GOOGLE_MAPS_MAX_STOPS ? ` (first ${GOOGLE_MAPS_MAX_STOPS})` : ""}
                </a>
              )}
              {!listLoading && !pins.length && <span className="text-neutral-400">Empty list: save pins with the bookmark button.</span>}
              <button type="button" onClick={() => setActiveCollection(null)} className="ml-auto rounded-full bg-white/10 px-2 py-0.5 hover:bg-white/20">
                Show all ×
              </button>
            </div>
          )}
          <div className="flex flex-wrap gap-1">
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
            {countryFilter && (
              <button
                type="button"
                onClick={() => setCountryFilter(null)}
                aria-label={`Clear country filter ${countryFilter}`}
                className="mt-1 inline-flex items-center gap-2 rounded-full bg-amber-300 px-3 py-1 text-xs font-semibold text-neutral-900 shadow-lg hover:bg-amber-200"
              >
                🌍 {countryFilter} · {pins.length.toLocaleString()}
                <span className="rounded-full bg-neutral-900/10 px-1.5">Reset ×</span>
              </button>
            )}
            {spotFilter && (
              <button
                type="button"
                onClick={() => setSpotFilter(null)}
                aria-label={`Clear place filter ${spotFilter}`}
                className="mt-1 inline-flex max-w-full items-center gap-2 rounded-full bg-amber-300 px-3 py-1 text-xs font-semibold text-neutral-900 shadow-lg hover:bg-amber-200"
              >
                <span className="truncate" dir="auto">📍 {spotFilter}</span>
                <span className="shrink-0 rounded-full bg-neutral-900/10 px-1.5">Reset ×</span>
              </button>
            )}
          </div>
          {error && <p className="mt-1 rounded-lg bg-red-950/80 px-3 py-1 text-xs text-red-200">{error}</p>}
        </div>
        <button
          type="button"
          onClick={toggleTrip}
          aria-pressed={tripOpen}
          className={`pointer-events-auto flex h-11 shrink-0 items-center gap-2 rounded-2xl px-3 text-sm font-semibold shadow-lg transition sm:px-4 ${
            tripOpen ? "bg-white text-neutral-900 hover:bg-neutral-200" : "bg-neutral-950/85 text-white ring-1 ring-amber-300/60 backdrop-blur hover:bg-neutral-800"
          }`}
        >
          <span aria-hidden>🧭</span>
          <span className="hidden lg:inline">Plan a Photo Trip</span>
          <span className="lg:hidden">Plan</span>
        </button>
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
          <AuthButton user={user} loading={authLoading} onLogin={() => { setUploadAfterLogin(false); setAuthOpen(true); }} onSignOut={signOut} onAdmin={access.isAdmin ? () => setAdminOpen(true) : undefined} />
        </div>
      </header>

      <MapToolbar onFitAll={fitAll} disabled={pickMode || Boolean(gpsEdit)} />
      <FloatingGallery
        gridPins={gridPins}
        matchCount={pins.length}
        summary={summary}
        totalPins={pinsBase.length}
        filtersActive={filtersActive}
        openSpot={openSpot}
        loading={loading}
        onClearFilters={clearFilters}
      />
      {walk && !pickMode && !gpsEdit && <NearbyWalkPanel />}
      {!pickMode && !gpsEdit && <TripPlanner user={user} onRequireLogin={() => setAuthOpen(true)} />}

      {selectedPhoto && !pickMode && !gpsEdit && <PhotoDrawer photo={selectedPhoto} stack={selectedStack} onClose={() => select(null)} />}

      {/*
        Upload panel stays mounted while hidden (pick mode), so the compressed photos
        and the form survive; after the map click it comes back with the coordinates.
      */}
      {user && canUploadNow && (
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
            maxPhotos={Number.isFinite(photosLeft(access)) ? photosLeft(access) : undefined}
            quotaText={quotaLabel(access)}
          />
        </div>
      )}
      {gateOpen && user && !canUploadNow && (
        <InviteGateModal
          userId={user.id}
          email={user.email ?? ""}
          fullName={profileName || (user.user_metadata?.full_name as string | undefined) || ""}
          onClose={() => setGateOpen(false)}
          onUnlocked={async () => {
            const a = await refreshAccess();
            setGateOpen(false);
            if (a.canUpload || a.isAdmin) {
              setTripOpen(false);
              setUploadOpen(true);
            }
          }}
        />
      )}
      {adminOpen && access.isAdmin && <AdminPanel onClose={() => setAdminOpen(false)} />}
      <AuthModal open={authOpen || recovery} recovery={recovery} onClose={() => { setAuthOpen(false); endRecovery(); }} />
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
