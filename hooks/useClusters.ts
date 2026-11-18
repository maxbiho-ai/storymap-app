"use client";

import { useMemo } from "react";
import Supercluster from "supercluster";
import type { Photo } from "@/types/photo";
import type { Bounds } from "@/store/mapStore";

type PointProps = { photoId: string };

export type ClusterItem =
  | { kind: "photo"; photo: Photo; longitude: number; latitude: number }
  | {
      kind: "cluster";
      id: number;
      count: number;
      longitude: number;
      latitude: number;
      /** עד 3 תמונות לתצוגת "ערימה" */
      preview: Photo[];
      /** הזום שבו הקבוצה מתפרקת — לזום בלחיצה */
      expansionZoom: number;
    };

/**
 * Clustering בצד הלקוח (supercluster) — מאפשר Markers בעיצוב חופשי (HTML),
 * מה שלא אפשרי עם ה-clustering המובנה של Mapbox (שמצייר רק עיגולים ב-WebGL).
 * מעל זום 15 אין מיזוג בכלל — כל תמונה מופיעה בנפרד.
 */
export function useClusters(photos: Photo[], bounds: Bounds | null, zoom: number): ClusterItem[] {
  const { index, byId } = useMemo(() => {
    const byId = new Map(photos.map((p) => [p.id, p]));
    const index = new Supercluster<PointProps>({ radius: 64, maxZoom: 15, minPoints: 2 });
    index.load(
      photos.map((p) => ({
        type: "Feature" as const,
        properties: { photoId: p.id },
        geometry: { type: "Point" as const, coordinates: [p.longitude, p.latitude] },
      })),
    );
    return { index, byId };
  }, [photos]);

  return useMemo(() => {
    if (!bounds) return [];
    const z = Math.floor(zoom);
    const boxes: [number, number, number, number][] =
      bounds.west <= bounds.east
        ? [[bounds.west, bounds.south, bounds.east, bounds.north]]
        : [[bounds.west, bounds.south, 180, bounds.north], [-180, bounds.south, bounds.east, bounds.north]];

    return boxes.flatMap((bbox) =>
      index.getClusters(bbox, z).flatMap((f): ClusterItem[] => {
        const [longitude, latitude] = f.geometry.coordinates;
        if ("cluster" in f.properties && f.properties.cluster) {
          const id = f.properties.cluster_id;
          const preview = index
            .getLeaves(id, 3)
            .map((l) => byId.get((l.properties as PointProps).photoId))
            .filter((p): p is Photo => Boolean(p));
          return [{
            kind: "cluster",
            id,
            count: f.properties.point_count,
            longitude,
            latitude,
            preview,
            expansionZoom: Math.min(index.getClusterExpansionZoom(id), 17),
          }];
        }
        const photo = byId.get((f.properties as PointProps).photoId);
        return photo ? [{ kind: "photo", photo, longitude, latitude }] : [];
      }),
    );
  }, [index, byId, bounds, zoom]);
}
