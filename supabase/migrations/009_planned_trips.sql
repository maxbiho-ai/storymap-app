-- StoryMap 009: saved "Plan a Photo Trip" itineraries
-- Run in Supabase Dashboard -> SQL Editor. Safe to re-run.
-- Each trip is private to its owner (days, stops and coordinates live in the `plan` JSON).

CREATE TABLE IF NOT EXISTS planned_trips (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  start_date  DATE NOT NULL,
  end_date    DATE NOT NULL,
  plan        JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_planned_trips_user ON planned_trips (user_id, updated_at DESC);

ALTER TABLE planned_trips ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read their own planned trips" ON planned_trips;
CREATE POLICY "Users read their own planned trips"
  ON planned_trips FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users create their own planned trips" ON planned_trips;
CREATE POLICY "Users create their own planned trips"
  ON planned_trips FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users update their own planned trips" ON planned_trips;
CREATE POLICY "Users update their own planned trips"
  ON planned_trips FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users delete their own planned trips" ON planned_trips;
CREATE POLICY "Users delete their own planned trips"
  ON planned_trips FOR DELETE TO authenticated
  USING (user_id = auth.uid());
