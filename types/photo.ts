export interface Photo {
  id: string;
  user_id: string;
  title: string | null;
  description: string | null;
  storage_path: string;
  photo_url: string;
  /** 480px thumbnail for pins and gallery; null on older photos */
  thumb_url: string | null;
  latitude: number;
  longitude: number;
  is_manual_location: boolean;
  location_name: string | null;
  taken_at: string | null;
  /** IANA timezone of the capture location (e.g. "Europe/Berlin"); null on older photos */
  taken_tz: string | null;
  camera_make: string | null;
  camera_model: string | null;
  lens: string | null;
  focal_length: number | null;
  aperture: number | null;
  shutter_speed: string | null;
  iso: number | null;
  width: number | null;
  height: number | null;
  tags: string[];
  is_private: boolean;
  photographer_name: string | null;
  created_at: string;

  /** Post text (pins from the Social Planner) */
  story: string | null;
  /** All images of the pin, in order; empty for app uploads (use photo_url) */
  image_urls: string[];
  storage_provider: "supabase" | "r2";
  storage_keys: string[];
  /** 'app' | 'maxbi-planner' */
  source: string;
  external_id: string | null;

  /** Field notes: parking, walking distance, trail access (migration 007) */
  access_info: string | null;
  /** Archive importer: canonical "<trip>/<subfolder>/<name>" key (migration 008) */
  source_key?: string | null;
  /** Field notes: permit, drone rules, tickets */
  permit_info: string | null;
  /** Canonical English country (migration 012) */
  country?: string | null;
  /** exif | phone | folder_exif_match | folder | ai_geocoded | manual (migration 012) */
  gps_source?: string | null;
  /**
   * Archive importer: the original folder name (migration 012). Owner / admin only: not in
   * PUBLIC_PHOTO_COLUMNS: owner / admin read it via the photo_source_folders RPC (migration 013).
   */
  source_folder?: string | null;
}

type DbDefaulted = "story" | "image_urls" | "storage_provider" | "storage_keys" | "source" | "external_id" | "access_info" | "permit_info";
export type PhotoInsert = Omit<Photo, "id" | "created_at" | DbDefaulted> & Partial<Pick<Photo, DbDefaulted>>;

/** Everything read from EXIF. All optional: many files miss some fields */
export interface ExtractedExif {
  latitude: number | null;
  longitude: number | null;
  /**
   * Capture time as written by the camera (wall clock, no timezone): "2024-03-22T19:08:00".
   * Resolved to a real instant at upload time, using the final location's timezone.
   */
  taken_wall: string | null;
  /** OffsetTimeOriginal if the camera wrote one ("+01:00") */
  taken_offset: string | null;
  camera_make: string | null;
  camera_model: string | null;
  lens: string | null;
  focal_length: number | null;
  aperture: number | null;
  shutter_speed: string | null;
  iso: number | null;
}

export interface PhotoFilters {
  /** Plain text: matches location name and title */
  query: string;
  /** #tags: a photo must have all of them (AND) */
  tags: string[];
  /** @photographer: exact, case-insensitive */
  photographer: string | null;
  /** Geographic area picked in the search (country / region / city): pins inside its bbox */
  area: GeoArea | null;
  bounds?: { north: number; south: number; east: number; west: number };
}

export const EMPTY_FILTERS: PhotoFilters = { query: "", tags: [], photographer: null, area: null };

/** A geocoded place used as a search area */
export interface GeoArea {
  id: string;
  /** "Germany", "Frankfurt, Germany" */
  name: string;
  /** "country" | "region" | "place" | ... */
  kind: string;
  center: [number, number];
  /** [west, south, east, north] */
  bbox: [number, number, number, number];
}
