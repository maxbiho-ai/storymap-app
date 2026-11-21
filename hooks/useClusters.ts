"use client";

import { useMemo } from "react";
import Supercluster from "supercluster";
import type { Photo } from "@/types/photo";
import type { Bounds } from "@/store/mapStore";

/**
 * Photos at the same spot (≈1m) form one "stack" pin: supercluster never splits them,
 * even at max zoom. Moving one photo's GPS changes its key, so it leaves the stack.
 */
export function stackKey(p: Pick<Photo, "latitude" | "longitude">): string {
  return `${p.latitude.toFixed(5)},${p.longitude.toFixed(5)}`;
}

/** All photos sharing this photo's pin, in load order */
export function stackOf(photos: Photo[], photo: Photo): Photo[] {
  const key = stackKey(photo);
  const stack = photos.filter((p) => stackKey(p) === key);
  return stack.length ? stack : [photo];
}

/** Images in a pin: a Social Planner post can carry several images in one row */
export function imageCount(stack: Photo[]): number {
  return stack.reduce((n, p) => n + Math.max(1, p.image_urls?.length ?? 0), 0);
}

type PointProps = { key: string; n: number };
type ClusterProps = { n: number };

export type ClusterItem =
  | { kind: "photo"; photo: Photo; stack: Photo[]; longitude: number; latitude: number }
  | {
      kind: "cluster";
      id: number;
      count: number;
      longitude: number;
      latitude: number;
      /** Up to 3 photos for the "pile" look */
      preview: Photo[];
      /** Zoom at which the cluster breaks apart: zoom-on-click */
      expansionZoom: number;
    };

/**
 * Client-side clustering (supercluster) so markers can be free-form HTML,
 * which Mapbox's built-in clustering (WebGL circles only) cannot do.
 * Above zoom 15 nothing merges, except photos stacked on the very same point.
 */
export function useClusters(photos: Photo[], bounds: Bounds | null, zoom: number): ClusterItem[] {
  const { index, stacks } = useMemo(() => {
    const stacks = new Map<string, Photo[]>();
    for (const p of photos) {
      const k = stackKey(p);
      const s = stacks.get(k);
      if (s) s.push(p);
      else stacks.set(k, [p]);
    }
    const index = new Supercluster<PointProps, ClusterProps>({
      radius: 64,
      maxZoom: 15,
      minPoints: 2,
      map: (props) => ({ n: props.n }),
      reduce: (acc, props) => { acc.n += props.n; },
    });
    index.load(
      [...stacks.entries()].map(([key, s]) => ({
        type: "Feature" as const,
        properties: { key, n: s.length },
        geometry: { type: "Point" as const, coordinates: [s[0].longitude, s[0].latitude] },
      })),
    );
    return { index, stacks };
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
        const props = f.properties as Partial<Supercluster.ClusterProperties> & Partial<PointProps> & ClusterProps;
        if (props.cluster && props.cluster_id != null) {
          const id = props.cluster_id;
          const preview = index
            .getLeaves(id, 3)
            .flatMap((l) => stacks.get((l.properties as PointProps).key) ?? [])
            .slice(0, 3);
          return [{
            kind: "cluster",
            id,
            count: props.n,
            longitude,
            latitude,
            preview,
            expansionZoom: Math.min(index.getClusterExpansionZoom(id), 17),
          }];
        }
        const stack = props.key ? stacks.get(props.key) : undefined;
        return stack?.length ? [{ kind: "photo", photo: stack[0], stack, longitude, latitude }] : [];
      }),
    );
  }, [index, stacks, bounds, zoom]);
}
