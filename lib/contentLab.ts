import type { Photo } from "@/types/photo";
import { getSolarPhase, solarPhaseLabel } from "@/lib/timeOfDay";
import { resolveCountry } from "@/lib/countryGeo";

export const CONTENT_LAB_URL = "https://content-lab-app.netlify.app/";

export type ContentLabFolder = "past" | "evergreen" | "playbook";

export interface ContentLabPayload {
  import_source: "storymap";
  /** past / evergreen (owner only) or playbook (the Idea Bank, anyone) */
  target_folder: ContentLabFolder;
  /** Caption / description of the photo */
  description: string | null;
  /** Idea Bank: the user's own concept note */
  idea_note: string | null;
  photo_id: string;
  image_url: string;
  title: string | null;
  location: string | null;
  country: string | null;
  lat: number;
  lng: number;
  /** Lighting phase at capture: "Golden hour (sunrise)", "Blue hour", "Daytime"… */
  light: string | null;
  camera: string | null;
  lens: string | null;
  /** "35mm · f/8 · 1/250 · ISO 100" */
  exif: string | null;
  tags: string[];
  /** Original photographer, so Content Lab can credit them */
  credit: string | null;
  storymap_url: string;
}

const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

/** Everything Content Lab's Content Playbook needs to ingest a photo and credit its photographer */
export function contentLabPayload(photo: Photo, imageUrl: string, folder: ContentLabFolder, ideaNote?: string): ContentLabPayload {
  const solar = getSolarPhase(photo.taken_at, photo.latitude, photo.longitude);
  const camera = [photo.camera_make, photo.camera_model].filter(Boolean).join(" ").replace(/^(\w+)( CORPORATION| Corporation)? \1 /i, "$1 ");
  const exif = [
    photo.focal_length && `${Number(photo.focal_length)}mm`,
    photo.aperture && `f/${Number(photo.aperture)}`,
    photo.shutter_speed,
    photo.iso && `ISO ${photo.iso}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    import_source: "storymap",
    target_folder: folder,
    description: clean(photo.description ?? photo.story)?.slice(0, 1500) ?? null,
    idea_note: clean(ideaNote),
    photo_id: photo.id,
    image_url: imageUrl,
    title: clean(photo.title),
    location: clean(photo.location_name),
    country: resolveCountry(photo),
    lat: Number(photo.latitude.toFixed(6)),
    lng: Number(photo.longitude.toFixed(6)),
    light: solar ? solarPhaseLabel(solar) : null,
    camera: clean(camera),
    lens: clean(photo.lens),
    exif: clean(exif),
    tags: photo.tags ?? [],
    credit: clean(photo.photographer_name),
    storymap_url: "https://my-storymap.netlify.app/",
  };
}

export interface CollageContentLabInfo {
  imageUrl: string | null;
  title: string;
  /** Places in the collage, in order */
  locations: string[];
  country: string | null;
  tags: string[];
  credit: string | null;
  photoIds: string[];
  ideaNote?: string;
}

/** Content Lab import for a Collage Studio image (same query-string contract as a single photo) */
export function collageContentLabUrl(c: CollageContentLabInfo, folder: ContentLabFolder): { url: string; payload: Record<string, unknown> } {
  const payload = {
    import_source: "storymap",
    import_kind: "collage",
    target_folder: folder,
    title: clean(c.title),
    description: c.locations.length ? `Collage: ${c.locations.slice(0, 10).join(" · ")}` : null,
    idea_note: clean(c.ideaNote),
    image_url: c.imageUrl,
    location: c.locations[0] ?? null,
    country: c.country,
    tags: [...new Set(c.tags)].slice(0, 20),
    credit: clean(c.credit),
    photo_ids: c.photoIds,
    storymap_url: "https://my-storymap.netlify.app/",
  };
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(payload)) {
    if (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length)) continue;
    q.set(k, Array.isArray(v) ? v.join(",") : String(v));
  }
  return { url: `${CONTENT_LAB_URL}?${q.toString()}`, payload };
}

/** https://content-lab-app.netlify.app/?import_source=storymap&image_url=…&location=…&credit=… (empty values are left out) */
export function contentLabUrl(p: ContentLabPayload): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) {
    if (v === null || v === undefined || v === "") continue;
    q.set(k, Array.isArray(v) ? v.join(",") : String(v));
  }
  return `${CONTENT_LAB_URL}?${q.toString()}`;
}
