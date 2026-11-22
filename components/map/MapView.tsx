"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Map, { Marker, NavigationControl, GeolocateControl, Source, Layer, useMap, type ViewStateChangeEvent, type MapLayerMouseEvent } from "react-map-gl";
import type { Photo } from "@/types/photo";
import { useMapStore, roundBounds, type Bounds } from "@/store/mapStore";
import { useClusters, stackOf, imageCount } from "@/hooks/useClusters";
import PhotoPin from "./PhotoPin";
import ClusterPin from "./ClusterPin";
import PhotoPopup from "./PhotoPopup";
import PickModeBanner from "./PickModeBanner";
import GpsEditBanner from "./GpsEditBanner";
import SunCompass from "./SunCompass";
import MapStyleSwitcher from "./MapStyleSwitcher";
import { destination } from "@/lib/sunMoon";
import { useIsDesktop } from "@/hooks/useIsDesktop";
import { MAP_ID } from "./constants";

export { MAP_ID };

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

interface Props {
  photos: Photo[];
  mapStyle?: string;
  /** Trip list view: [lng, lat] points joined by a route line, in list order */
  route?: [number, number][];
}

function readBounds(e: { target: mapboxgl.Map }): Bounds {
  const b = e.target.getBounds()!;
  return roundBounds({ north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() });
}

const STYLES = {
  dark: "mapbox://styles/mapbox/dark-v11",
  satellite: "mapbox://styles/mapbox/satellite-streets-v12",
  terrain: "mapbox://styles/mapbox/satellite-streets-v12",
} as const;

export default function MapView({ photos, mapStyle, route }: Props) {
  const { [MAP_ID]: map } = useMap();
  const bounds = useMapStore((s) => s.bounds);
  const setViewport = useMapStore((s) => s.setViewport);
  const hoveredId = useMapStore((s) => s.hoveredId);
  const setHovered = useMapStore((s) => s.setHovered);
  const selectedId = useMapStore((s) => s.selectedId);
  const select = useMapStore((s) => s.select);
  const pickMode = useMapStore((s) => s.pickMode);
  const pickedLocation = useMapStore((s) => s.pickedLocation);
  const setPicked = useMapStore((s) => s.setPicked);
  const cancelPick = useMapStore((s) => s.cancelPick);
  const gpsEdit = useMapStore((s) => s.gpsEdit);
  const setGpsEditPoint = useMapStore((s) => s.setGpsEditPoint);
  const cancelGpsEdit = useMapStore((s) => s.cancelGpsEdit);
  const isDesktop = useIsDesktop();
  const mapMode = useMapStore((s) => s.mapMode);
  const zoom = useMapStore((s) => s.zoom);
  const walk = useMapStore((s) => s.walk);
  const walkStops = useMapStore((s) => s.walkStops);
  const terrain = mapMode === "terrain";

  // זום שלם — לחישוב מחדש של ה-clusters *תוך כדי* זום, לא רק בסופו
  const [zoomLevel, setZoomLevel] = useState(2);
  const clusters = useClusters(photos, bounds, zoomLevel);

  const byId = useMemo(() => new globalThis.Map(photos.map((p) => [p.id, p])), [photos]);
  const selected = selectedId ? byId.get(selectedId) : undefined;
  const hovered = hoveredId ? byId.get(hoveredId) : undefined;
  const selectedStack = useMemo(() => (selected ? stackOf(photos, selected) : []), [photos, selected]);
  // Snapshot: the photo may leave the loaded area while the owner pans to its new spot
  const editingSnap = useRef<Photo | undefined>(undefined);
  const editingLive = gpsEdit ? byId.get(gpsEdit.photoId) : undefined;
  if (editingLive) editingSnap.current = editingLive;
  const editing = gpsEdit ? editingLive ?? (editingSnap.current?.id === gpsEdit.photoId ? editingSnap.current : undefined) : undefined;
  const editingStackSize = useMemo(() => (editing ? stackOf(photos, editing).length : 0), [photos, editing]);
  const busy = pickMode || Boolean(gpsEdit);
  // Walk radius ring around the origin pin
  const ringData = useMemo(() => {
    if (!walk) return null;
    const { latitude: lat, longitude: lng } = walk.origin;
    const pts = Array.from({ length: 97 }, (_, i) => destination(lat, lng, i * 3.75, walk.radiusKm * 1000));
    return { type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: pts } };
  }, [walk]);
  const routeData = useMemo(
    () =>
      route && route.length > 1
        ? { type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: route } }
        : null,
    [route],
  );

  const onMove = useCallback((e: ViewStateChangeEvent) => {
    const z = Math.floor(e.viewState.zoom);
    setZoomLevel((prev) => (prev === z ? prev : z));
  }, []);

  // bounds בזמן אמת → usePhotoSearch טוען את האזור (debounce 300ms בתוך ה-hook)
  const onMoveEnd = useCallback(
    (e: ViewStateChangeEvent) => setViewport(readBounds(e), e.viewState.zoom),
    [setViewport],
  );

  const onClick = useCallback(
    (e: MapLayerMouseEvent) => {
      if (gpsEdit) setGpsEditPoint({ latitude: e.lngLat.lat, longitude: e.lngLat.lng });
      else if (pickMode) setPicked({ latitude: e.lngLat.lat, longitude: e.lngLat.lng });
      else select(null);
    },
    [gpsEdit, setGpsEditPoint, pickMode, setPicked, select],
  );

  // Esc יוצא ממצב בחירה / סוגר popup
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      if (gpsEdit) cancelGpsEdit();
      else if (pickMode) cancelPick();
      else select(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [gpsEdit, cancelGpsEdit, pickMode, cancelPick, select]);

  // Edit GPS: bring the photo into view
  const editPhotoId = gpsEdit?.photoId;
  useEffect(() => {
    if (!editPhotoId || !map || !gpsEdit) return;
    const { latitude, longitude } = gpsEdit.original;
    map.flyTo({ center: [longitude, latitude], zoom: Math.max(map.getZoom(), 14), duration: 800, essential: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editPhotoId, map]);

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

  return (
    <Map
      id={MAP_ID}
      mapboxAccessToken={TOKEN}
      mapStyle={mapStyle ?? STYLES[mapMode]}
      maxPitch={80}
      initialViewState={{ longitude: 34.85, latitude: 31.5, zoom: 2 }}
      style={{ width: "100%", height: "100%" }}
      projection={{ name: "globe" }}
      cursor={busy ? "crosshair" : undefined}
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

      {/* Light direction around the open pin */}
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

      {!pickMode && clusters.map((c) =>
        c.kind === "cluster" ? (
          <ClusterPin
            key={`c-${c.id}`}
            longitude={c.longitude}
            latitude={c.latitude}
            count={c.count}
            preview={c.preview}
            dimmed={Boolean(gpsEdit)}
            onClick={() => map?.flyTo({ center: [c.longitude, c.latitude], zoom: c.expansionZoom, duration: 900, essential: true })}
          />
        ) : (
          (() => {
            // A selected / hovered stack member is shown on top of its pile
            const top = c.stack.find((p) => p.id === selectedId) ?? c.stack.find((p) => p.id === hoveredId) ?? c.photo;
            const multi = c.stack.length > 1;
            const pos = multi && c.stack.some((p) => p.id === selectedId) ? c.stack.indexOf(top) + 1 : undefined;
            // While editing, the edited photo is drawn by the draggable marker instead
            const stackLeft = gpsEdit ? c.stack.filter((p) => p.id !== gpsEdit.photoId) : c.stack;
            if (!stackLeft.length) return null;
            const shown = stackLeft.includes(top) ? top : stackLeft[0];
            return (
              <PhotoPin
                key={`s-${c.photo.id}`}
                photo={shown}
                count={stackLeft.length > 1 ? stackLeft.length : imageCount(stackLeft)}
                position={gpsEdit ? undefined : pos}
                highlighted={!gpsEdit && c.stack.some((p) => p.id === hoveredId)}
                selected={!gpsEdit && c.stack.some((p) => p.id === selectedId)}
                dimmed={Boolean(gpsEdit)}
                onHover={setHovered}
                onSelect={select}
              />
            );
          })()
        ),
      )}

      {/* hover מהגלריה על תמונה שנמצאת בתוך cluster → טבעת פועמת במיקום המדויק */}
      {hovered && !busy && (
        <Marker longitude={hovered.longitude} latitude={hovered.latitude} anchor="center" style={{ zIndex: 30, pointerEvents: "none" }}>
          <span className="relative block h-6 w-6">
            <span className="absolute inset-0 animate-ping rounded-full bg-amber-300/70" />
            <span className="absolute inset-1.5 rounded-full bg-amber-300 ring-2 ring-white" />
          </span>
        </Marker>
      )}

      {/* במובייל הכרטיסייה היא Drawer (מרונדר ב-page) */}
      {selected && !busy && isDesktop && <PhotoPopup photo={selected} stack={selectedStack} onClose={() => select(null)} />}

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
