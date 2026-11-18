export interface Photo {
  id: string;
  user_id: string;
  title: string | null;
  description: string | null;
  storage_path: string;
  photo_url: string;
  /** תמונה ממוזערת (480px) לפינים ולגלריה; null בתמונות ישנות */
  thumb_url: string | null;
  latitude: number;
  longitude: number;
  is_manual_location: boolean;
  location_name: string | null;
  taken_at: string | null;
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
  created_at: string;
}

export type PhotoInsert = Omit<Photo, "id" | "created_at">;

/** מה שחולץ מה-EXIF — הכל אופציונלי, כי הרבה קבצים חסרים חלק מהשדות */
export interface ExtractedExif {
  latitude: number | null;
  longitude: number | null;
  taken_at: string | null;
  camera_make: string | null;
  camera_model: string | null;
  lens: string | null;
  focal_length: number | null;
  aperture: number | null;
  shutter_speed: string | null;
  iso: number | null;
}

export interface PhotoFilters {
  query: string;   // טקסט חופשי — מחפש בשם מיקום ובכותרת
  tags: string[];  // כל התגיות חייבות להופיע (AND)
  bounds?: { north: number; south: number; east: number; west: number };
}
