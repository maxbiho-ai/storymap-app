-- =====================================================================
-- StoryMap 006 (v0.7.0): likes, saved lists (Favorites + trip lists),
-- comments / Q&A with pinned creator tips, and notifications.
-- Run in Supabase Dashboard -> SQL Editor. Safe to re-run.
--
-- Visibility rule used throughout: a row about a photo is readable only when
-- the reader can see that photo (the photos RLS applies inside the EXISTS),
-- so likes / comments on private photos never leak.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Owners delete their own photos (already in 001; recreated here so it's guaranteed).
--    Likes, list items, comments and notifications go with the photo (ON DELETE CASCADE below).
--    Files are removed by /api/photos/delete (Supabase Storage / R2) after the row.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can delete their own photos" ON photos;
CREATE POLICY "Users can delete their own photos"
  ON photos FOR DELETE
  USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- 1. Likes
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS photo_likes (
  photo_id    UUID NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (photo_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_photo_likes_user ON photo_likes (user_id);

ALTER TABLE photo_likes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Likes are readable with the photo" ON photo_likes;
CREATE POLICY "Likes are readable with the photo"
  ON photo_likes FOR SELECT
  USING (EXISTS (SELECT 1 FROM photos p WHERE p.id = photo_id));

DROP POLICY IF EXISTS "Users like as themselves" ON photo_likes;
CREATE POLICY "Users like as themselves"
  ON photo_likes FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND EXISTS (SELECT 1 FROM photos p WHERE p.id = photo_id));

DROP POLICY IF EXISTS "Users remove their own likes" ON photo_likes;
CREATE POLICY "Users remove their own likes"
  ON photo_likes FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- 2. Saved lists: Favorites (one per user) + custom trip lists
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_collections (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  is_default_favorites  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_collections_user ON user_collections (user_id, created_at);
-- At most one Favorites list per user
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_collections_favorites
  ON user_collections (user_id) WHERE is_default_favorites;

CREATE TABLE IF NOT EXISTS collection_items (
  collection_id  UUID NOT NULL REFERENCES user_collections(id) ON DELETE CASCADE,
  photo_id       UUID NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  sort_order     INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (collection_id, photo_id)
);
CREATE INDEX IF NOT EXISTS idx_collection_items_photo ON collection_items (photo_id);

ALTER TABLE user_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read their own lists" ON user_collections;
CREATE POLICY "Users read their own lists"
  ON user_collections FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users create their own lists" ON user_collections;
CREATE POLICY "Users create their own lists"
  ON user_collections FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users rename their own lists" ON user_collections;
CREATE POLICY "Users rename their own lists"
  ON user_collections FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Favorites can't be deleted (it is recreated on the next login anyway)
DROP POLICY IF EXISTS "Users delete their own trip lists" ON user_collections;
CREATE POLICY "Users delete their own trip lists"
  ON user_collections FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND NOT is_default_favorites);

DROP POLICY IF EXISTS "Users read items of their lists" ON collection_items;
CREATE POLICY "Users read items of their lists"
  ON collection_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM user_collections c WHERE c.id = collection_id AND c.user_id = auth.uid()));

DROP POLICY IF EXISTS "Users add to their lists" ON collection_items;
CREATE POLICY "Users add to their lists"
  ON collection_items FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM user_collections c WHERE c.id = collection_id AND c.user_id = auth.uid())
    AND EXISTS (SELECT 1 FROM photos p WHERE p.id = photo_id)
  );

DROP POLICY IF EXISTS "Users reorder their lists" ON collection_items;
CREATE POLICY "Users reorder their lists"
  ON collection_items FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM user_collections c WHERE c.id = collection_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM user_collections c WHERE c.id = collection_id AND c.user_id = auth.uid()));

DROP POLICY IF EXISTS "Users remove from their lists" ON collection_items;
CREATE POLICY "Users remove from their lists"
  ON collection_items FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM user_collections c WHERE c.id = collection_id AND c.user_id = auth.uid()));

-- New items go to the end of the list (route order = the order they were saved)
CREATE OR REPLACE FUNCTION public.collection_items_append()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.sort_order IS NULL OR NEW.sort_order = 0 THEN
    SELECT COALESCE(MAX(sort_order), 0) + 1 INTO NEW.sort_order
    FROM collection_items WHERE collection_id = NEW.collection_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_collection_items_append ON collection_items;
CREATE TRIGGER trg_collection_items_append
  BEFORE INSERT ON collection_items
  FOR EACH ROW EXECUTE FUNCTION public.collection_items_append();

-- The caller's Favorites list, created on first use. Returns its id.
CREATE OR REPLACE FUNCTION public.ensure_favorites_list()
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  fav UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT id INTO fav FROM user_collections WHERE user_id = auth.uid() AND is_default_favorites;
  IF fav IS NULL THEN
    INSERT INTO user_collections (user_id, name, is_default_favorites)
    VALUES (auth.uid(), 'Favorites', TRUE)
    ON CONFLICT DO NOTHING
    RETURNING id INTO fav;
    IF fav IS NULL THEN -- lost a race with another tab
      SELECT id INTO fav FROM user_collections WHERE user_id = auth.uid() AND is_default_favorites;
    END IF;
  END IF;
  RETURN fav;
END;
$$;
GRANT EXECUTE ON FUNCTION public.ensure_favorites_list() TO authenticated;

-- Backfill: every existing user gets a Favorites list
INSERT INTO user_collections (user_id, name, is_default_favorites)
SELECT p.id, 'Favorites', TRUE FROM profiles p
WHERE NOT EXISTS (SELECT 1 FROM user_collections c WHERE c.user_id = p.id AND c.is_default_favorites)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------
-- 3. Comments, questions and pinned creator tips
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS photo_comments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  photo_id       UUID NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  author_name    TEXT,
  parent_id      UUID REFERENCES photo_comments(id) ON DELETE CASCADE,
  body           TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 2000),
  is_question    BOOLEAN NOT NULL DEFAULT FALSE,
  is_pinned_tip  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_photo_comments_photo ON photo_comments (photo_id, created_at);
CREATE INDEX IF NOT EXISTS idx_photo_comments_parent ON photo_comments (parent_id);

ALTER TABLE photo_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Comments are readable with the photo" ON photo_comments;
CREATE POLICY "Comments are readable with the photo"
  ON photo_comments FOR SELECT
  USING (EXISTS (SELECT 1 FROM photos p WHERE p.id = photo_id));

DROP POLICY IF EXISTS "Users comment as themselves" ON photo_comments;
CREATE POLICY "Users comment as themselves"
  ON photo_comments FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND EXISTS (SELECT 1 FROM photos p WHERE p.id = photo_id));

-- Author edits the text; the photo owner pins / unpins. The trigger below enforces which column.
DROP POLICY IF EXISTS "Author or photo owner can update" ON photo_comments;
CREATE POLICY "Author or photo owner can update"
  ON photo_comments FOR UPDATE TO authenticated
  USING (
    auth.uid() = user_id
    OR EXISTS (SELECT 1 FROM photos p WHERE p.id = photo_id AND p.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Author or photo owner can delete" ON photo_comments;
CREATE POLICY "Author or photo owner can delete"
  ON photo_comments FOR DELETE TO authenticated
  USING (
    auth.uid() = user_id
    OR EXISTS (SELECT 1 FROM photos p WHERE p.id = photo_id AND p.user_id = auth.uid())
  );

-- Insert: author name from the profile, replies stay on the parent's photo and one level deep
CREATE OR REPLACE FUNCTION public.photo_comments_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  parent photo_comments%ROWTYPE;
BEGIN
  IF NEW.author_name IS NULL OR trim(NEW.author_name) = '' THEN
    SELECT COALESCE(NULLIF(trim(full_name), ''), username) INTO NEW.author_name
    FROM profiles WHERE id = NEW.user_id;
  END IF;
  IF NEW.parent_id IS NOT NULL THEN
    SELECT * INTO parent FROM photo_comments WHERE id = NEW.parent_id;
    IF NOT FOUND OR parent.photo_id <> NEW.photo_id THEN
      RAISE EXCEPTION 'Reply must belong to a comment on the same photo';
    END IF;
    -- Replies to a reply attach to the top-level comment
    IF parent.parent_id IS NOT NULL THEN
      NEW.parent_id := parent.parent_id;
    END IF;
  END IF;
  -- Only the photo owner pins tips (via update)
  NEW.is_pinned_tip := FALSE;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_photo_comments_before_insert ON photo_comments;
CREATE TRIGGER trg_photo_comments_before_insert
  BEFORE INSERT ON photo_comments
  FOR EACH ROW EXECUTE FUNCTION public.photo_comments_before_insert();

-- Update: the author may change body / is_question; only the photo owner may change is_pinned_tip
CREATE OR REPLACE FUNCTION public.photo_comments_before_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  photo_owner UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW; -- service role / SQL editor
  END IF;
  IF NEW.photo_id <> OLD.photo_id OR NEW.user_id <> OLD.user_id
     OR NEW.parent_id IS DISTINCT FROM OLD.parent_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'These comment fields cannot be changed';
  END IF;
  SELECT user_id INTO photo_owner FROM photos WHERE id = OLD.photo_id;
  IF NEW.is_pinned_tip IS DISTINCT FROM OLD.is_pinned_tip AND auth.uid() IS DISTINCT FROM photo_owner THEN
    RAISE EXCEPTION 'Only the photo owner can pin a tip';
  END IF;
  IF (NEW.body IS DISTINCT FROM OLD.body OR NEW.is_question IS DISTINCT FROM OLD.is_question
      OR NEW.author_name IS DISTINCT FROM OLD.author_name)
     AND auth.uid() <> OLD.user_id THEN
    RAISE EXCEPTION 'Only the author can edit a comment';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_photo_comments_before_update ON photo_comments;
CREATE TRIGGER trg_photo_comments_before_update
  BEFORE UPDATE ON photo_comments
  FOR EACH ROW EXECUTE FUNCTION public.photo_comments_before_update();

-- ---------------------------------------------------------------------
-- 4. Notifications (written only by the triggers below)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_notifications (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  actor_user_id      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  actor_name         TEXT,
  photo_id           UUID REFERENCES photos(id) ON DELETE CASCADE,
  comment_id         UUID REFERENCES photo_comments(id) ON DELETE CASCADE,
  type               TEXT NOT NULL CHECK (type IN ('comment', 'question', 'reply', 'like')),
  is_read            BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_notifications_recipient
  ON user_notifications (recipient_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_notifications_unread
  ON user_notifications (recipient_user_id) WHERE NOT is_read;

ALTER TABLE user_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read their notifications" ON user_notifications;
CREATE POLICY "Users read their notifications"
  ON user_notifications FOR SELECT TO authenticated
  USING (auth.uid() = recipient_user_id);

DROP POLICY IF EXISTS "Users mark their notifications read" ON user_notifications;
CREATE POLICY "Users mark their notifications read"
  ON user_notifications FOR UPDATE TO authenticated
  USING (auth.uid() = recipient_user_id)
  WITH CHECK (auth.uid() = recipient_user_id);

DROP POLICY IF EXISTS "Users clear their notifications" ON user_notifications;
CREATE POLICY "Users clear their notifications"
  ON user_notifications FOR DELETE TO authenticated
  USING (auth.uid() = recipient_user_id);
-- No INSERT policy: clients can't forge notifications; the SECURITY DEFINER triggers write them.

-- New comment → photo owner ('comment' / 'question'); reply → the thread's author ('reply')
CREATE OR REPLACE FUNCTION public.notify_on_comment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  photo_owner UUID;
  thread_author UUID;
BEGIN
  SELECT user_id INTO photo_owner FROM photos WHERE id = NEW.photo_id;

  IF NEW.parent_id IS NOT NULL THEN
    SELECT user_id INTO thread_author FROM photo_comments WHERE id = NEW.parent_id;
    IF thread_author IS NOT NULL AND thread_author <> NEW.user_id THEN
      INSERT INTO user_notifications (recipient_user_id, actor_user_id, actor_name, photo_id, comment_id, type)
      VALUES (thread_author, NEW.user_id, NEW.author_name, NEW.photo_id, NEW.id, 'reply');
    END IF;
  END IF;

  IF photo_owner IS NOT NULL AND photo_owner <> NEW.user_id
     AND photo_owner IS DISTINCT FROM thread_author THEN
    INSERT INTO user_notifications (recipient_user_id, actor_user_id, actor_name, photo_id, comment_id, type)
    VALUES (photo_owner, NEW.user_id, NEW.author_name, NEW.photo_id, NEW.id,
            CASE WHEN NEW.is_question THEN 'question' ELSE 'comment' END);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_on_comment ON photo_comments;
CREATE TRIGGER trg_notify_on_comment
  AFTER INSERT ON photo_comments
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_comment();

-- Like → photo owner (one unread 'like' per actor + photo, so like/unlike spam doesn't pile up)
CREATE OR REPLACE FUNCTION public.notify_on_like()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  photo_owner UUID;
  actor TEXT;
BEGIN
  SELECT user_id INTO photo_owner FROM photos WHERE id = NEW.photo_id;
  IF photo_owner IS NULL OR photo_owner = NEW.user_id THEN
    RETURN NEW;
  END IF;
  SELECT COALESCE(NULLIF(trim(full_name), ''), username) INTO actor FROM profiles WHERE id = NEW.user_id;
  DELETE FROM user_notifications
  WHERE recipient_user_id = photo_owner AND actor_user_id = NEW.user_id
    AND photo_id = NEW.photo_id AND type = 'like';
  INSERT INTO user_notifications (recipient_user_id, actor_user_id, actor_name, photo_id, type)
  VALUES (photo_owner, NEW.user_id, actor, NEW.photo_id, 'like');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_on_like ON photo_likes;
CREATE TRIGGER trg_notify_on_like
  AFTER INSERT ON photo_likes
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_like();

-- ---------------------------------------------------------------------
-- 5. Realtime: the notifications bell subscribes to new rows (RLS applies)
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'user_notifications'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_notifications;
  END IF;
END;
$$;
