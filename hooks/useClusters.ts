"use client";

import { useMemo } from "react";
import Supercluster from "supercluster";
import type { Bounds } from "@/store/mapStore";
import type { Pin, PinGroup } from "@/lib/pins";

type PointProps = { key: string; n: number };
type ClusterProps = { n: number };

export type ClusterItem =
  | { kind: "group"; group: PinGroup; longitude: number; latitude: number }
  | {
      kind: "cluster";
      id: number;
      /** Photos inside (not groups) */
      count: number;
      longitude: number;
      latitude: number;
      /** Up to 3 pins for the "pile" look */
      preview: Pin[];
      /** Zoom at which the cluster breaks apart */
      expansionZoom: number;
    };

/**
 * Client-side clustering (supercluster) of the pin GROUPS, so markers can be free-form HTML.
 * A group is one point and never splits; groups only merge visually at low zoom.
 */
export function useClusters(groups: PinGroup[], bounds: Bounds | null, zoom: number) {
  const { index, byKey } = useMemo(() => {
    const byKey = new Map(groups.map((g) => [g.key, g]));
    const index = new Supercluster<PointProps, ClusterProps>({
      radius: 64,
      maxZoom: 15,
      minPoints: 2,
      map: (props) => ({ n: props.n }),
      reduce: (acc, props) => { acc.n += props.n; },
    });
    index.load(
      groups.map((g) => ({
        type: "Feature" as const,
        properties: { key: g.key, n: g.members.length },
        geometry: { type: "Point" as const, coordinates: [g.longitude, g.latitude] },
      })),
    );
    return { index, byKey };
  }, [groups]);

  const items = useMemo<ClusterItem[]>(() => {
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
            .flatMap((l) => byKey.get((l.properties as PointProps).key)?.members[0] ?? [])
            .slice(0, 3);
          return [{ kind: "cluster", id, count: props.n, longitude, latitude, preview, expansionZoom: Math.min(index.getClusterExpansionZoom(id), 17) }];
        }
        const group = props.key ? byKey.get(props.key) : undefined;
        return group ? [{ kind: "group", group, longitude, latitude }] : [];
      }),
    );
  }, [index, byKey, bounds, zoom]);

  /** The groups inside a cluster (for the carousel) */
  const leaves = (clusterId: number): PinGroup[] =>
    index.getLeaves(clusterId, Infinity).flatMap((l) => byKey.get((l.properties as PointProps).key) ?? []);

  return { items, leaves };
}
