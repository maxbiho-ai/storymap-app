"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Map, { Marker, NavigationControl, GeolocateControl, useMap, type ViewStateChangeEvent, type MapLayerMouseEvent } from "react-map-gl";
import type { Photo } from "@/types/photo";
import { useMapStore, roundBounds, type Bounds } from "@/store/mapStore";
import { useClusters } from "@/hooks/useClusters";
import PhotoPin from "./PhotoPin";
import ClusterPin from "./ClusterPin";
import PhotoPopup from "./PhotoPopup";
import PickModeBanner from "./PickModeBanner";
import { useIsDesktop } from "@/hooks/useIsDesktop";
import { MAP_ID } from "./constants";

export { MAP_ID };

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

interface Props {
  photos: Photo[];
  mapStyle?: string;
}

function readBounds(e: { target: mapboxgl.Map }): Bounds {
  const b = e.target.getBounds()!;
  return roundBounds({ north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() });
}

export default function MapView({ photos, mapStyle = "mapbox://styles/mapbox/dark-v11" }: Props) {
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
  const isDesktop = useIsDesktop();

  // זום שלם — לחישוב מחדש של ה-clusters *תוך כדי* זום, לא רק בסופו
  const [zoomLevel, setZoomLevel] = useState(2);
  const clusters = useClusters(photos, bounds, zoomLevel);

  const byId = useMemo(() => new globalThis.Map(photos.map((p) => [p.id, p])), [photos]);
  const selected = selectedId ? byId.get(selectedId) : undefined;
  const hovered = hoveredId ? byId.get(hoveredId) : undefined;

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
      if (pickMode) setPicked({ latitude: e.lngLat.lat, longitude: e.lngLat.lng });
      else select(null);
    },
    [pickMode, setPicked, select],
  );

  // Esc יוצא ממצב בחירה / סוגר popup
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      if (pickMode) cancelPick();
      else select(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickMode, cancelPick, select]);

  if (!TOKEN) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-neutral-900 p-6 text-center text-sm text-neutral-300">
        חסר NEXT_PUBLIC_MAPBOX_TOKEN ב-.env.local
      </div>
    );
  }

  return (
    <Map
      id={MAP_ID}
      mapboxAccessToken={TOKEN}
      mapStyle={mapStyle}
      initialViewState={{ longitude: 34.85, latitude: 31.5, zoom: 2 }}
      style={{ width: "100%", height: "100%" }}
      projection={{ name: "globe" }}
      cursor={pickMode ? "crosshair" : undefined}
      onLoad={(e) => setViewport(readBounds(e), e.target.getZoom())}
      onMove={onMove}
      onMoveEnd={onMoveEnd}
      onClick={onClick}
      attributionControl
      reuseMaps
    >
      <NavigationControl position="bottom-left" showCompass={false} />
      <GeolocateControl position="bottom-left" />

      {!pickMode && clusters.map((c) =>
        c.kind === "cluster" ? (
          <ClusterPin
            key={`c-${c.id}`}
            longitude={c.longitude}
            latitude={c.latitude}
            count={c.count}
            preview={c.preview}
            onClick={() => map?.flyTo({ center: [c.longitude, c.latitude], zoom: c.expansionZoom, duration: 900, essential: true })}
          />
        ) : (
          <PhotoPin
            key={c.photo.id}
            photo={c.photo}
            highlighted={hoveredId === c.photo.id}
            selected={selectedId === c.photo.id}
            onHover={setHovered}
            onSelect={select}
          />
        ),
      )}

      {/* hover מהגלריה על תמונה שנמצאת בתוך cluster → טבעת פועמת במיקום המדויק */}
      {hovered && !pickMode && (
        <Marker longitude={hovered.longitude} latitude={hovered.latitude} anchor="center" style={{ zIndex: 30, pointerEvents: "none" }}>
          <span className="relative block h-6 w-6">
            <span className="absolute inset-0 animate-ping rounded-full bg-amber-300/70" />
            <span className="absolute inset-1.5 rounded-full bg-amber-300 ring-2 ring-white" />
          </span>
        </Marker>
      )}

      {/* במובייל הכרטיסייה היא Drawer (מרונדר ב-page) */}
      {selected && !pickMode && isDesktop && <PhotoPopup photo={selected} onClose={() => select(null)} />}

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
          <svg width="34" height="44" viewBox="0 0 34 44" className="drop-shadow-lg" aria-label="מיקום התמונה החדשה">
            <path d="M17 43C17 43 33 27 33 17A16 16 0 001 17c0 10 16 26 16 26z" fill="#fcd34d" stroke="white" strokeWidth="2.5" />
            <circle cx="17" cy="17" r="6" fill="#171717" />
          </svg>
        </Marker>
      )}

      {pickMode && <PickModeBanner onCancel={cancelPick} />}
    </Map>
  );
}
