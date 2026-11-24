import type { Photo } from "@/types/photo";
import { getSolarPhase, solarPhaseLabel } from "@/lib/timeOfDay";
import { resolveCountry } from "@/lib/countryGeo";

export const CONTENT_LAB_URL = "https://content-lab-app.netlify.app/";

export interface ContentLabPayload {
  import_source: "storymap";
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
export function contentLabPayload(photo: Photo, imageUrl: string): ContentLabPayload {
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

/** https://content-lab-app.netlify.app/?import_source=storymap&image_url=…&location=…&credit=… (empty values are left out) */
export function contentLabUrl(p: ContentLabPayload): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) {
    if (v === null || v === undefined || v === "") continue;
    q.set(k, Array.isArray(v) ? v.join(",") : String(v));
  }
  return `${CONTENT_LAB_URL}?${q.toString()}`;
}
