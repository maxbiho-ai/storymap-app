"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Map, { Marker, NavigationControl, GeolocateControl, Source, Layer, useMap, type ViewStateChangeEvent, type MapLayerMouseEvent } from "react-map-gl";
import type { Photo } from "@/types/photo";
import { useMapStore, roundBounds, type Bounds } from "@/store/mapStore";
import { useClusters, type ClusterItem } from "@/hooks/useClusters";
import { boundsOf, distKm, exactKey, spotPhotoCount, type Pin, type PinGroup } from "@/lib/pins";
import { canonicalCountry } from "@/lib/countries";
import PhotoPin from "./PhotoPin";
import ClusterPin from "./ClusterPin";
import DotPin from "./DotPin";
import PhotoPopup from "./PhotoPopup";
import PickModeBanner from "./PickModeBanner";
import GpsEditBanner from "./GpsEditBanner";
import SunCompass from "./SunCompass";
import MapStyleSwitcher from "./MapStyleSwitcher";
import CountryLayer, { type CountryPill } from "./CountryLayer";
import TripLayer from "@/components/trip/TripLayer";
import { destination } from "@/lib/sunMoon";
import { useIsDesktop } from "@/hooks/useIsDesktop";
import { MAP_ID } from "./constants";

export { MAP_ID };

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

interface Props {
  /** Every pin matching the filters (the lightweight global layer) */
  pins: Pin[];
  /** The pins merged into spots (or exact-GPS stacks) */
  groups: PinGroup[];
  /** The open card's photo (full row) and the photos browsed with its carousel */
  selected?: Photo;
  stack: Photo[];
  /** canonical country → photo count */
  countryCounts: Map<string, number>;
  /** Floating country summary pills */
  countryPills: CountryPill[];
  /** Countries that light up (flight-only photos excluded) */
  visitedCountries?: Set<string>;
  mapStyle?: string;
  /** Trip list view: [lng, lat] points joined by a route line, in list order */
  route?: [number, number][];
  /** Chronological dashed line through the filtered photos (EXIF time order) */
  timeline?: [number, number][];
}

function readBounds(e: { target: mapboxgl.Map }): Bounds {
  const b = e.target.getBounds()!;
  return roundBounds({ north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() });
}

const STYLES = {
  dark: "mapbox://styles/mapbox/dark-v11",
  streets: "mapbox://styles/mapbox/streets-v12",
  satellite: "mapbox://styles/mapbox/satellite-streets-v12",
  terrain: "mapbox://styles/mapbox/satellite-streets-v12",
} as const;

/** Popup geometry: the card sits POPUP_GAP above its pin; the sun compass needs BELOW_PIN beneath it */
const POPUP_GAP = 70;
const BELOW_PIN = 128;
const CARD_W = 340;

const lineFc = (coordinates: [number, number][]) => ({ type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates } });

export default function MapView({ pins, groups, selected, stack, countryCounts, countryPills, visitedCountries, mapStyle, route, timeline }: Props) {
  const { [MAP_ID]: map } = useMap();
  const bounds = useMapStore((s) => s.bounds);
  const setViewport = useMapStore((s) => s.setViewport);
  const hoveredId = useMapStore((s) => s.hoveredId);
  const setHovered = useMapStore((s) => s.setHovered);
  const selectedId = useMapStore((s) => s.selectedId);
  const select = useMapStore((s) => s.select);
  const openCarousel = useMapStore((s) => s.openCarousel);
  const pickMode = useMapStore((s) => s.pickMode);
  const pickedLocation = useMapStore((s) => s.pickedLocation);
  const setPicked = useMapStore((s) => s.setPicked);
  const cancelPick = useMapStore((s) => s.cancelPick);
  const gpsPick = useMapStore((s) => s.gpsPick);
  const setGpsPickPoint = useMapStore((s) => s.setGpsPickPoint);
  const endGpsPick = useMapStore((s) => s.endGpsPick);
  const countriesOn = useMapStore((s) => s.countriesOn);
  const gpsEdit = useMapStore((s) => s.gpsEdit);
  const setGpsEditPoint = useMapStore((s) => s.setGpsEditPoint);
  const cancelGpsEdit = useMapStore((s) => s.cancelGpsEdit);
  const isDesktop = useIsDesktop();
  const mapMode = useMapStore((s) => s.mapMode);
  const viewMode = useMapStore((s) => s.viewMode);
  const exactGps = useMapStore((s) => s.exactGps);
  const countryFilter = useMapStore((s) => s.countryFilter);
  const setCountryFilter = useMapStore((s) => s.setCountryFilter);
  const zoom = useMapStore((s) => s.zoom);
  const walk = useMapStore((s) => s.walk);
  const walkStops = useMapStore((s) => s.walkStops);
  const terrain = mapMode === "terrain";

  // זום שלם — לחישוב מחדש של ה-clusters *תוך כדי* זום, לא רק בסופו
  const [zoomLevel, setZoomLevel] = useState(2);
  const { items, leaves } = useClusters(groups, bounds, zoomLevel);

  const pinById = useMemo(() => new globalThis.Map(pins.map((p) => [p.id, p])), [pins]);
  const hovered = hoveredId ? pinById.get(hoveredId) : undefined;
  const selectedGroupKey = useMemo(
    () => (selectedId ? groups.find((g) => g.members.some((m) => m.id === selectedId))?.key : undefined),
    [groups, selectedId],
  );
  const [dotHover, setDotHover] = useState<{ longitude: number; latitude: number; pin: Pin; count: number } | null>(null);

  // Snapshot: the photo may leave the loaded area while the owner pans to its new spot
  const editingSnap = useRef<Photo | undefined>(undefined);
  const editingLive = gpsEdit && selected?.id === gpsEdit.photoId ? selected : undefined;
  if (editingLive) editingSnap.current = editingLive;
  const editing = gpsEdit ? editingLive ?? (editingSnap.current?.id === gpsEdit.photoId ? editingSnap.current : undefined) : undefined;
  const editingStackSize = useMemo(() => {
    if (!editing) return 0;
    const k = exactKey(editing);
    return pins.reduce((n, p) => n + (exactKey(p) === k ? 1 : 0), 0);
  }, [pins, editing]);
  const busy = pickMode || Boolean(gpsEdit);

  // Walk radius ring around the origin pin
  const ringData = useMemo(() => {
    if (!walk) return null;
    const { latitude: lat, longitude: lng } = walk.origin;
    const pts = Array.from({ length: 97 }, (_, i) => destination(lat, lng, i * 3.75, walk.radiusKm * 1000));
    return lineFc(pts);
  }, [walk]);
  const routeData = useMemo(() => (route && route.length > 1 ? lineFc(route) : null), [route]);
  const timelineData = useMemo(() => (timeline && timeline.length > 1 ? lineFc(timeline) : null), [timeline]);
  const heatData = useMemo(
    () =>
      viewMode === "heat"
        ? {
            type: "FeatureCollection" as const,
            features: pins.map((p) => ({ type: "Feature" as const, properties: {}, geometry: { type: "Point" as const, coordinates: [p.longitude, p.latitude] } })),
          }
        : null,
    [viewMode, pins],
  );

  const onMove = useCallback((e: ViewStateChangeEvent) => {
    const z = Math.floor(e.viewState.zoom);
    setZoomLevel((prev) => (prev === z ? prev : z));
  }, []);
  const onMoveEnd = useCallback((e: ViewStateChangeEvent) => setViewport(readBounds(e), e.viewState.zoom), [setViewport]);

  const onClick = useCallback(
    (e: MapLayerMouseEvent) => {
      // Inline GPS editor "Pick on Map": the card stays open, the click fills its coordinate field
      if (gpsPick) return setGpsPickPoint({ latitude: e.lngLat.lat, longitude: e.lngLat.lng });
      if (gpsEdit) return setGpsEditPoint({ latitude: e.lngLat.lat, longitude: e.lngLat.lng });
      if (pickMode) return setPicked({ latitude: e.lngLat.lat, longitude: e.lngLat.lng });
      // An open card closes first; the next click on a country filters by it
      if (selectedId) return select(null);
      const m = e.target;
      if (countriesOn && m.getLayer("country-fill")) {
        const f = m.queryRenderedFeatures(e.point, { layers: ["country-fill"] })[0];
        const canon = canonicalCountry(f?.properties?.name_en as string | undefined);
        if (canon && countryCounts.has(canon)) setCountryFilter(canon);
      }
    },
    [gpsPick, setGpsPickPoint, countriesOn, gpsEdit, setGpsEditPoint, pickMode, setPicked, select, selectedId, countryCounts, setCountryFilter],
  );

  /** A cluster: a compact one opens the carousel (1 of N, with arrows); a big / spread one zooms in */
  const onClusterClick = (c: Extract<ClusterItem, { kind: "cluster" }>) => {
    const lv = leaves(c.id);
    const members = lv.flatMap((g) => g.members);
    const box = boundsOf(lv);
    const diagKm = box ? distKm(box[0][1], box[0][0], box[1][1], box[1][0]) : Infinity;
    if (!exactGps && members.length <= 80 && diagKm <= 5) {
      setDotHover(null);
      members.sort((a, b) => (a.ts ?? Infinity) - (b.ts ?? Infinity) || (a.id < b.id ? -1 : 1));
      openCarousel(members.map((m) => m.id));
    } else {
      map?.flyTo({ center: [c.longitude, c.latitude], zoom: c.expansionZoom, duration: 900, essential: true });
    }
  };

  const onGroupClick = (g: PinGroup) => {
    setDotHover(null);
    const open = g.members.find((m) => m.id === selectedId) ?? g.members[0];
    select(open.id);
  };

  // Esc יוצא ממצב בחירה / סוגר popup
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      if (gpsPick) endGpsPick();
      else if (gpsEdit) cancelGpsEdit();
      else if (pickMode) cancelPick();
      else select(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [gpsPick, endGpsPick, gpsEdit, cancelGpsEdit, pickMode, cancelPick, select]);

  // Edit GPS: bring the photo into view
  const editPhotoId = gpsEdit?.photoId;
  useEffect(() => {
    if (!editPhotoId || !map || !gpsEdit) return;
    const { latitude, longitude } = gpsEdit.original;
    map.flyTo({ center: [longitude, latitude], zoom: Math.max(map.getZoom(), 14), duration: 800, essential: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editPhotoId, map]);

  // "Spread Exact GPS Spots" switched ON: zoom into the open spot so each GPS coordinate becomes its own pin
  const prevExact = useRef(exactGps);
  useEffect(() => {
    const was = prevExact.current;
    prevExact.current = exactGps;
    if (!exactGps || was || !map) return;
    const box = boundsOf(stack.length ? stack : selected ? [selected] : []);
    if (!box) return;
    const same = box[0][0] === box[1][0] && box[0][1] === box[1][1];
    if (same) map.flyTo({ center: box[0], zoom: Math.max(map.getZoom(), 17), duration: 900, essential: true });
    else map.fitBounds(box, { padding: { top: 160, bottom: 160, left: isDesktop ? 400 : 60, right: 60 }, maxZoom: 19, duration: 1000 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exactGps, map]);

  /* ---------------- Viewport-safe photo card ---------------- */
  const [cardH, setCardH] = useState(520);
  const [cardMax, setCardMax] = useState<number | undefined>(undefined);
  const selLat = selected?.latitude;
  const selLng = selected?.longitude;
  const selKey = selected?.id;

  useEffect(() => {
    const m = map?.getMap();
    if (!m || !selKey || selLat == null || selLng == null || busy) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const fit = () => {
      if (cancelled) return;
      if (m.isMoving()) {
        m.once("moveend", fit);
        return;
      }
      const rect = m.getContainer().getBoundingClientRect();
      const W = rect.width;
      const H = rect.height;
      const headerBottom = document.querySelector("header")?.getBoundingClientRect().bottom ?? 80;
      const top = Math.max(0, headerBottom - rect.top) + 12;
      const p = m.project([selLng, selLat]);
      let targetX = p.x;
      let targetY = p.y;

      if (isDesktop) {
        // The card scrolls inside, so it can always fit: top bar (photographer + X) .. image .. EXIF .. pin + compass
        const maxH = Math.max(280, H - top - POPUP_GAP - BELOW_PIN - 12);
        setCardMax(maxH);
        const ch = Math.min(cardH, maxH);
        const minY = top + ch + POPUP_GAP;
        const maxY = H - BELOW_PIN - 4;
        targetY = minY > maxY ? minY : Math.min(Math.max(p.y, minY), maxY);
        const left = 372 + CARD_W / 2; // the sidebar covers the left 372px
        const minX = left;
        const maxX = W - CARD_W / 2 - 12;
        targetX = minX > maxX ? (372 + W) / 2 : Math.min(Math.max(p.x, minX), maxX);
      } else {
        // Phone: the card is a bottom sheet; keep the pin + compass in the strip above it
        const sheet = document.querySelector("[data-photo-drawer] > div")?.getBoundingClientRect();
        const bottomLimit = (sheet ? sheet.top - rect.top : H * 0.5) - 12;
        const minY = top + 110;
        const maxY = bottomLimit - 110;
        targetY = minY > maxY ? (top + bottomLimit) / 2 : Math.min(Math.max(p.y, minY), maxY);
        targetX = Math.min(Math.max(p.x, 50), W - 50);
      }

      const dx = targetX - p.x;
      const dy = targetY - p.y;
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return; // already fully visible
      // Same result as easeTo + padding, without leaving a permanent camera padding behind
      m.easeTo({ center: m.unproject([W / 2 - dx, H / 2 - dy]), duration: 550, essential: true });
    };

    timer = setTimeout(fit, 90);
    window.addEventListener("resize", fit);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      m.off("moveend", fit);
      window.removeEventListener("resize", fit);
    };
    // Re-checked when another photo opens or the card grows / shrinks
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey, Math.round(cardH / 24), busy, isDesktop, map]);

  // 3D terrain: the DEM source + terrain are set on the raw map (and again whenever a style swap wipes them)
  useEffect(() => {
    const m = map?.getMap();
    if (!m) return;
    const apply = () => {
      try {
        if (terrain) {
          if (!m.getSource("mapbox-dem")) m.addSource("mapbox-dem", { type: "raster-dem", url: "mapbox://mapbox.mapbox-dem", tileSize: 512, maxzoom: 14 });
          m.setTerrain({ source: "mapbox-dem", exaggeration: 1.4 });
        } else if (m.getTerrain()) m.setTerrain(null);
      } catch (e) {
        console.warn("Terrain setup failed", e);
      }
    };
    if (m.isStyleLoaded()) apply();
    m.on("style.load", apply);
    return () => {
      m.off("style.load", apply);
    };
  }, [terrain, map]);

  // 3D terrain tilts the camera; leaving it flattens again
  const prevMode = useRef(mapMode);
  useEffect(() => {
    if (!map || prevMode.current === mapMode) return;
    const was3d = prevMode.current === "terrain";
    prevMode.current = mapMode;
    if (mapMode === "terrain") map.easeTo({ pitch: 62, duration: 1200 });
    else if (was3d) map.easeTo({ pitch: 0, bearing: 0, duration: 900 });
  }, [mapMode, map]);

  if (!TOKEN) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-neutral-900 p-6 text-center text-sm text-neutral-300">
        NEXT_PUBLIC_MAPBOX_TOKEN is missing in .env.local
      </div>
    );
  }

  const markersVisible = !pickMode && (viewMode !== "heat" || zoomLevel >= 11);

  const renderItem = (c: ClusterItem) => {
    if (c.kind === "cluster") {
      return viewMode === "thumbs" ? (
        <ClusterPin
          key={`c-${c.id}`}
          longitude={c.longitude}
          latitude={c.latitude}
          count={c.count}
          preview={c.preview}
          dimmed={Boolean(gpsEdit)}
          onClick={() => onClusterClick(c)}
        />
      ) : (
        <DotPin
          key={`c-${c.id}`}
          longitude={c.longitude}
          latitude={c.latitude}
          count={c.count}
          dimmed={Boolean(gpsEdit)}
          onClick={() => onClusterClick(c)}
          onHover={(h) => setDotHover(h && c.preview[0] ? { longitude: c.longitude, latitude: c.latitude, pin: c.preview[0], count: c.count } : null)}
        />
      );
    }

    const g = c.group;
    // While editing, the edited photo is drawn by the draggable marker instead
    const members = gpsEdit ? g.members.filter((p) => p.id !== gpsEdit.photoId) : g.members;
    if (!members.length) return null;
    const isSel = !gpsEdit && g.key === selectedGroupKey;

    if (viewMode === "thumbs") {
      // A selected / hovered member is shown on top of its pile
      const top = members.find((p) => p.id === selectedId) ?? members.find((p) => p.id === hoveredId) ?? members[0];
      const pos = members.length > 1 && isSel ? members.indexOf(top) + 1 : undefined;
      return (
        <PhotoPin
          key={`s-${g.key}`}
          photo={top}
          longitude={g.longitude}
          latitude={g.latitude}
          count={spotPhotoCount(members)}
          position={gpsEdit ? undefined : pos}
          highlighted={!gpsEdit && members.some((p) => p.id === hoveredId)}
          selected={isSel}
          dimmed={Boolean(gpsEdit)}
          onHover={setHovered}
          onSelect={() => onGroupClick(g)}
        />
      );
    }
    return (
      <DotPin
        key={`s-${g.key}`}
        longitude={g.longitude}
        latitude={g.latitude}
        count={spotPhotoCount(members)}
        active={isSel || members.some((p) => p.id === hoveredId)}
        dimmed={Boolean(gpsEdit)}
        onClick={() => onGroupClick(g)}
        onHover={(h) => setDotHover(h ? { longitude: g.longitude, latitude: g.latitude, pin: members[0], count: spotPhotoCount(members) } : null)}
      />
    );
  };

  return (
    <Map
      id={MAP_ID}
      mapboxAccessToken={TOKEN}
      mapStyle={mapStyle ?? STYLES[mapMode]}
      maxPitch={80}
      initialViewState={{ longitude: 34.85, latitude: 31.5, zoom: 2 }}
      style={{ width: "100%", height: "100%" }}
      projection={{ name: "globe" }}
      cursor={busy || gpsPick ? "crosshair" : undefined}
      onLoad={(e) => setViewport(readBounds(e), e.target.getZoom())}
      onMove={onMove}
      onMoveEnd={onMoveEnd}
      onClick={onClick}
      attributionControl
      reuseMaps
    >
      <NavigationControl position="bottom-right" showCompass={terrain} visualizePitch={terrain} />
      <MapStyleSwitcher />

      {terrain && (
        <>
          <Layer id="sky" type="sky" paint={{ "sky-type": "atmosphere", "sky-atmosphere-sun": [0, 0], "sky-atmosphere-sun-intensity": 12 }} />
        </>
      )}

      {/* Countries with photos: hover highlight + tooltip, click filters */}
      <CountryLayer counts={countryCounts} visited={visitedCountries} pills={countryPills} active={countryFilter} enabled={countriesOn} light={mapMode === "streets"} disabled={busy} onPick={setCountryFilter} />

      {/* Heatmap view: photo density hotspots (dots take over once zoomed in) */}
      {heatData && (
        <Source id="pins-heat" type="geojson" data={heatData}>
          <Layer
            id="pins-heat-layer"
            type="heatmap"
            paint={
              {
                "heatmap-weight": 1,
                "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 0.6, 9, 2.4],
                "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 6, 6, 18, 12, 34],
                "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 9, 0.95, 14, 0.45],
                "heatmap-color": [
                  "interpolate", ["linear"], ["heatmap-density"],
                  0, "rgba(0,0,0,0)", 0.15, "rgba(37,99,235,0.45)", 0.35, "rgba(20,184,166,0.65)",
                  0.55, "rgba(250,204,21,0.8)", 0.78, "rgba(249,115,22,0.9)", 1, "rgba(239,68,68,1)",
                ],
              } as never
            }
          />
        </Source>
      )}

      {/* Nearby Photo Walk: radius ring + numbered stops */}
      {ringData && (
        <Source id="walk-ring" type="geojson" data={ringData}>
          <Layer id="walk-ring-line" type="line" paint={{ "line-color": "#38bdf8", "line-width": 1.5, "line-opacity": 0.7, "line-dasharray": [2, 2] }} />
        </Source>
      )}
      {walk && !busy && (
        <>
          <Marker longitude={walk.origin.longitude} latitude={walk.origin.latitude} anchor="center" style={{ zIndex: 26, pointerEvents: "none" }}>
            <span className="block h-4 w-4 rounded-full border-2 border-white bg-sky-400 shadow-[0_0_0_6px_rgba(56,189,248,0.3)]" />
          </Marker>
          {walkStops.map((p, i) => (
            <Marker key={`walk-${p.id}`} longitude={p.longitude} latitude={p.latitude} anchor="center" offset={[22, -62]} style={{ zIndex: 27, pointerEvents: "none" }}>
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sky-400 text-xs font-bold text-neutral-950 shadow-lg ring-2 ring-white">{i + 1}</span>
            </Marker>
          ))}
        </>
      )}

      {/* Light direction around the open pin: follows the carousel to each photo's exact EXIF coordinates */}
      {selected && !busy && <SunCompass photo={selected} zoom={zoom} />}
      <GeolocateControl position="bottom-right" />

      {/* Trip list: a subtle dashed line through the saved pins, in list order */}
      {routeData && (
        <Source id="trip-route" type="geojson" data={routeData}>
          <Layer id="trip-route-glow" type="line" layout={{ "line-cap": "round", "line-join": "round" }}
            paint={{ "line-color": "#fcd34d", "line-width": 6, "line-opacity": 0.15, "line-blur": 2 }} />
          <Layer id="trip-route-line" type="line" layout={{ "line-cap": "round", "line-join": "round" }}
            paint={{ "line-color": "#fcd34d", "line-width": 2, "line-opacity": 0.85, "line-dasharray": [2, 2] }} />
        </Source>
      )}

      {/* Filtered photos in EXIF time order */}
      {timelineData && (
        <Source id="photo-timeline" type="geojson" data={timelineData}>
          <Layer id="photo-timeline-line" type="line" layout={{ "line-cap": "round", "line-join": "round" }}
            paint={{ "line-color": "#7dd3fc", "line-width": 1.8, "line-opacity": 0.8, "line-dasharray": [2, 2.5] }} />
        </Source>
      )}

      <TripLayer />

      {markersVisible && items.map(renderItem)}

      {/* Compact hover preview of a dot: cover thumbnail + place name + photo count */}
      {dotHover && !selected && !busy && (
        <Marker longitude={dotHover.longitude} latitude={dotHover.latitude} anchor="bottom" offset={[0, -18]} style={{ zIndex: 25, pointerEvents: "none" }}>
          <span className="flex w-44 items-center gap-2 rounded-xl bg-neutral-950/95 p-1.5 text-white shadow-2xl ring-1 ring-white/15">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={dotHover.pin.thumb_url ?? dotHover.pin.photo_url} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover" />
            <span className="min-w-0">
              <span className="block truncate text-xs font-semibold" dir="auto">{dotHover.pin.location_name ?? dotHover.pin.title ?? "Photo spot"}</span>
              <span className="block text-[11px] text-amber-300">{dotHover.count} photo{dotHover.count === 1 ? "" : "s"}</span>
            </span>
          </span>
        </Marker>
      )}

      {/* hover מהגלריה על תמונה → טבעת פועמת במיקום המדויק */}
      {hovered && !busy && (
        <Marker longitude={hovered.longitude} latitude={hovered.latitude} anchor="center" style={{ zIndex: 30, pointerEvents: "none" }}>
          <span className="relative block h-6 w-6">
            <span className="absolute inset-0 animate-ping rounded-full bg-amber-300/70" />
            <span className="absolute inset-1.5 rounded-full bg-amber-300 ring-2 ring-white" />
          </span>
        </Marker>
      )}

      {/* The photo shown in the card: a highlighted pin at its exact EXIF coordinates */}
      {selected && !busy && (
        <Marker longitude={selected.longitude} latitude={selected.latitude} anchor="center" style={{ zIndex: 31, pointerEvents: "none" }}>
          <span className="relative block h-5 w-5">
            <span className="absolute inset-0 animate-ping rounded-full bg-amber-300/60" />
            <span className="absolute inset-0.5 rounded-full border-2 border-white bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.9)]" />
          </span>
        </Marker>
      )}

      {/* במובייל הכרטיסייה היא Drawer (מרונדר ב-page) */}
      {selected && !busy && isDesktop && (
        <PhotoPopup photo={selected} stack={stack} onClose={() => select(null)} maxHeight={cardMax} onHeight={setCardH} />
      )}

      {/* Edit GPS: original spot (ghost) + the photo as a draggable pin */}
      {gpsEdit && editing && (
        <>
          <Marker longitude={gpsEdit.original.longitude} latitude={gpsEdit.original.latitude} anchor="center" style={{ zIndex: 35, pointerEvents: "none" }}>
            <span className="block h-3 w-3 rounded-full border-2 border-white/80 bg-neutral-900/60" />
          </Marker>
          <Marker
            longitude={gpsEdit.point.longitude}
            latitude={gpsEdit.point.latitude}
            anchor="bottom"
            draggable
            onDragEnd={(e) => setGpsEditPoint({ latitude: e.lngLat.lat, longitude: e.lngLat.lng })}
            style={{ zIndex: 45, cursor: "grab" }}
          >
            <span className="flex flex-col items-center">
              <span className="block h-14 w-14 overflow-hidden rounded-xl border-[3px] border-amber-300 bg-neutral-800 shadow-[0_8px_24px_rgba(0,0,0,0.6)] ring-4 ring-amber-300/30">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={editing.thumb_url ?? editing.photo_url} alt="" draggable={false} className="h-full w-full object-cover" />
              </span>
              <span className="-mt-1 h-3 w-3 rotate-45 bg-amber-300 shadow" />
            </span>
          </Marker>
          <GpsEditBanner
            photo={editing}
            point={gpsEdit.point}
            stackSize={editingStackSize}
            onSaved={(p) => select(p.id)}
          />
        </>
      )}

      {/* Inline GPS editor: the point picked on the map */}
      {gpsPick?.point && (
        <Marker longitude={gpsPick.point.longitude} latitude={gpsPick.point.latitude} anchor="bottom" style={{ zIndex: 46, pointerEvents: "none" }}>
          <svg width="30" height="40" viewBox="0 0 34 44" className="drop-shadow-lg" aria-label="New GPS position">
            <path d="M17 43C17 43 33 27 33 17A16 16 0 001 17c0 10 16 26 16 26z" fill="#38bdf8" stroke="white" strokeWidth="2.5" />
            <circle cx="17" cy="17" r="6" fill="#0c4a6e" />
          </svg>
        </Marker>
      )}

      {/* מיקום שנבחר ידנית — ניתן לגרירה לכוונון */}
      {pickedLocation && (
        <Marker
          longitude={pickedLocation.longitude}
          latitude={pickedLocation.latitude}
          anchor="bottom"
          draggable
          onDragEnd={(e) => setPicked({ latitude: e.lngLat.lat, longitude: e.lngLat.lng })}
          style={{ zIndex: 40 }}
        >
          <svg width="34" height="44" viewBox="0 0 34 44" className="drop-shadow-lg" aria-label="New photo location">
            <path d="M17 43C17 43 33 27 33 17A16 16 0 001 17c0 10 16 26 16 26z" fill="#fcd34d" stroke="white" strokeWidth="2.5" />
            <circle cx="17" cy="17" r="6" fill="#171717" />
          </svg>
        </Marker>
      )}

      {pickMode && <PickModeBanner onCancel={cancelPick} />}
    </Map>
  );
}
