-- StoryMap 011: 🗺️ Ready Routes, a curated library of multi-day photography itineraries
-- Run in Supabase Dashboard -> SQL Editor. Safe to re-run. Needs 010 (public.app_is_admin).
-- Public read (published routes only), admin write. Deep link: https://my-storymap.netlify.app/?route=<slug>

CREATE TABLE IF NOT EXISTS curated_routes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 80),
  title        TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 140),
  country      TEXT,
  description  TEXT CHECK (description IS NULL OR length(description) <= 2000),
  days         INTEGER NOT NULL DEFAULT 1 CHECK (days BETWEEN 1 AND 60),
  stops_count  INTEGER NOT NULL DEFAULT 0,
  cover_url    TEXT,
  -- { "days": [ { "title": "...", "stops": [ { name, latitude, longitude, thumb, light, description, logistics, durationMinutes, photo_id } ] } ] }
  plan         JSONB NOT NULL,
  -- [ { "kind": "photo" | "parking" | "drone", "text": "...", "stop": "optional stop name" } ]
  tips         JSONB NOT NULL DEFAULT '[]'::jsonb,
  published    BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_by   UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_curated_routes_list ON curated_routes (published, sort_order, created_at DESC);

ALTER TABLE curated_routes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone reads published routes" ON curated_routes;
CREATE POLICY "Anyone reads published routes"
  ON curated_routes FOR SELECT
  USING (published OR public.app_is_admin());

DROP POLICY IF EXISTS "Admins write routes" ON curated_routes;
CREATE POLICY "Admins write routes"
  ON curated_routes FOR ALL TO authenticated
  USING (public.app_is_admin()) WITH CHECK (public.app_is_admin());

GRANT SELECT ON curated_routes TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON curated_routes TO authenticated;
