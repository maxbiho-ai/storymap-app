import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/server/auth";
import { errorResponse, unauthorized } from "@/lib/server/respond";
import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";
import { HttpError } from "@/lib/server/externalPins";
import { getSolarPhase } from "@/lib/timeOfDay";
import { countryFromLocation } from "@/lib/countries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const COLUMNS =
  "id, title, description, story, location_name, tags, source_key, photo_url, image_urls, latitude, longitude, camera_make, camera_model, lens, aperture, shutter_speed, iso, taken_at, taken_tz, photographer_name";

/** Escapes LIKE wildcards and the characters that break PostgREST's or() syntax */
const likeSafe = (s: string) => s.replace(/[%_\]/g, (c) => `\${c}`).replace(/[,()"]/g, " ").trim();

/** "waterfalls" → "waterfall": tags are usually singular */
const stem = (t: string) => (t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t);

/** Trip folder = first segment of the archive importer's source_key ("<trip>/<subfolder>/<name>") */
const tripOf = (sourceKey: string | null) => (sourceKey ? sourceKey.split("/")[0] || null : null);

interface Row {
  id: string;
  title: string | null;
  description: string | null;
  story: string | null;
  location_name: string | null;
  tags: string[] | null;
  source_key: string | null;
  photo_url: string;
  image_urls: string[] | null;
  latitude: number;
  longitude: number;
  camera_make: string | null;
  camera_model: string | null;
  lens: string | null;
  aperture: number | null;
  shutter_speed: string | null;
  iso: number | null;
  taken_at: string | null;
  taken_tz: string | null;
  photographer_name: string | null;
}

/**
 * GET /api/external-search?q=iceland%20waterfalls&tripId=<trip folder>&limit=50
 * Authorization: Bearer <EXTERNAL_PUBLISH_SECRET>   (same secret as /api/external-publish)
 *
 * Public photos only. Every word of `q` must match the place, title, description / story, trip name
 * or a tag (country names live in the location name). `tripId` narrows to one imported trip folder.
 * → 200 { items: [{ id, title, location_name, country, tags, trip_name, image_url, lat, lon,
 *                   camera, lens, aperture, shutter_speed, iso, solar_phase, taken_at }] }
 */
export async function GET(req: Request) {
  if (!isAuthorized(req)) return unauthorized();
  try {
    const params = new URL(req.url).searchParams;
    const q = (params.get("q") ?? "").trim().slice(0, 200);
    const tripId = (params.get("tripId") ?? "").trim().slice(0, 200);
    const rawLimit = params.get("limit");
    const limit = rawLimit == null || rawLimit === "" ? DEFAULT_LIMIT : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1) throw new HttpError(400, "limit must be a positive integer");

    let query = getSupabaseAdmin()
      .from("photos")
      .select(COLUMNS)
      .eq("is_private", false) // the service role bypasses RLS: never leak private photos
      .order("taken_at", { ascending: false, nullsFirst: false })
      .limit(Math.min(limit, MAX_LIMIT));

    if (tripId) query = query.ilike("source_key", `${likeSafe(tripId).toLowerCase()}/%`);

    for (const word of q.split(/\s+/).filter(Boolean).slice(0, 8)) {
      const w = likeSafe(word);
      if (!w) continue;
      const tag = word.toLowerCase().replace(/[^\p{L}\p{N}_]/gu, "");
      const tagConds = tag ? [`tags.cs.{${tag}}`, stem(tag) !== tag ? `tags.cs.{${stem(tag)}}` : ""] : [];
      // each word is an AND of: it appears in any of these fields
      query = query.or(
        [
          `location_name.ilike.%${w}%`,
          `title.ilike.%${w}%`,
          `description.ilike.%${w}%`,
          `story.ilike.%${w}%`,
          `source_key.ilike.%${w}%`,
          ...tagConds,
        ]
          .filter(Boolean)
          .join(","),
      );
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const items = ((data ?? []) as Row[]).map((p) => {
      const solar = getSolarPhase(p.taken_at, p.latitude, p.longitude);
      return {
        id: p.id,
        title: p.title,
        location_name: p.location_name,
        country: countryFromLocation(p.location_name),
        tags: p.tags ?? [],
        trip_name: tripOf(p.source_key),
        image_url: p.image_urls?.[0] ?? p.photo_url,
        lat: p.latitude,
        lon: p.longitude,
        camera: [p.camera_make, p.camera_model].filter(Boolean).join(" ").replace(/^(\w+)( CORPORATION)? \1 /i, "$1 ") || null,
        lens: p.lens,
        aperture: p.aperture == null ? null : Number(p.aperture),
        shutter_speed: p.shutter_speed,
        iso: p.iso,
        solar_phase: solar ? (solar.blueHour ? `blue_hour_${solar.phase}` : solar.phase) : null,
        taken_at: p.taken_at,
      };
    });
    return NextResponse.json({ items });
  } catch (err) {
    return errorResponse(err);
  }
}
