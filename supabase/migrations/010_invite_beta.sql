-- StoryMap 010: Invite-only creator access + beta quotas + access requests + photo reports
-- Run in Supabase Dashboard -> SQL Editor. Safe to re-run.
--
-- Public stays open: SELECT on photos / profiles, browsing, registration, trip planning.
-- Gated: uploading photos (Storage + photos INSERT + the Gemini tag/translate routes).
-- The service role (scripts/import-trip.ts, /api/external-publish) bypasses RLS, so it is never limited by quotas.

-- ---------------------------------------------------------------------
-- 1. Profile columns
-- ---------------------------------------------------------------------
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_admin    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS can_upload  BOOLEAN NOT NULL DEFAULT FALSE,
  -- NULL or -1 = unlimited
  ADD COLUMN IF NOT EXISTS photo_quota INTEGER DEFAULT 15;

-- People who already uploaded keep their access (unlimited); everyone else must be invited.
UPDATE profiles p
   SET can_upload = TRUE, photo_quota = NULL
 WHERE NOT p.can_upload AND EXISTS (SELECT 1 FROM photos WHERE user_id = p.id);

-- ---------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_is_admin(uid UUID DEFAULT auth.uid())
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT is_admin FROM profiles WHERE id = uid), FALSE)
$$;

-- Admin, or can_upload with photos left in the quota (NULL / -1 = unlimited)
CREATE OR REPLACE FUNCTION public.can_upload_photo(uid UUID DEFAULT auth.uid())
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT p.is_admin
        OR (p.can_upload AND (p.photo_quota IS NULL OR p.photo_quota < 0
            OR (SELECT count(*) FROM photos WHERE user_id = uid) < p.photo_quota))
      FROM profiles p WHERE p.id = uid
  ), FALSE)
$$;

-- Turns upload access on. Never lowers an existing quota; unlimited wins.
CREATE OR REPLACE FUNCTION public.grant_upload(uid UUID, quota INTEGER)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cur profiles%ROWTYPE; new_quota INTEGER;
BEGIN
  SELECT * INTO cur FROM profiles WHERE id = uid;
  IF NOT FOUND THEN RETURN; END IF;
  IF (cur.can_upload AND (cur.photo_quota IS NULL OR cur.photo_quota < 0)) OR quota IS NULL OR quota < 0 THEN
    new_quota := NULL;
  ELSIF cur.can_upload THEN
    new_quota := GREATEST(COALESCE(cur.photo_quota, 0), quota);
  ELSE
    new_quota := quota;
  END IF;
  PERFORM set_config('app.privileged', '1', TRUE);
  UPDATE profiles SET can_upload = TRUE, photo_quota = new_quota WHERE id = uid;
END $$;

-- Users may edit their profile, but never their own access columns
CREATE OR REPLACE FUNCTION public.guard_profile_privileges()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR current_setting('app.privileged', TRUE) = '1' OR public.app_is_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;
  NEW.is_admin := OLD.is_admin;
  NEW.can_upload := OLD.can_upload;
  NEW.photo_quota := OLD.photo_quota;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_profile_privileges ON profiles;
CREATE TRIGGER trg_guard_profile_privileges
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_privileges();

DROP POLICY IF EXISTS "Admins can update any profile" ON profiles;
CREATE POLICY "Admins can update any profile"
  ON profiles FOR UPDATE USING (public.app_is_admin()) WITH CHECK (public.app_is_admin());

-- ---------------------------------------------------------------------
-- 3. Invite codes, allowed emails, access requests, reports
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invite_codes (
  code          TEXT PRIMARY KEY CHECK (length(code) BETWEEN 4 AND 64),
  max_uses      INTEGER,                       -- NULL = unlimited uses
  used_count    INTEGER NOT NULL DEFAULT 0,
  quota_granted INTEGER DEFAULT 15,            -- NULL / -1 = unlimited
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invite_codes_upper ON invite_codes (upper(code));

CREATE TABLE IF NOT EXISTS invite_redemptions (
  code       TEXT NOT NULL REFERENCES invite_codes(code) ON DELETE CASCADE ON UPDATE CASCADE,
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (code, user_id)
);

-- Failed-code throttle (see redeem_invite_code)
CREATE TABLE IF NOT EXISTS invite_attempts (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID NOT NULL,
  ok         BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invite_attempts_user ON invite_attempts (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS allowed_emails (
  email         TEXT PRIMARY KEY CHECK (email = lower(email)),
  quota_granted INTEGER DEFAULT 15             -- NULL / -1 = unlimited
);

CREATE TABLE IF NOT EXISTS access_requests (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  full_name   TEXT,
  message     TEXT CHECK (message IS NULL OR length(message) <= 500),
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'dismissed')),
  notified_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One open request per user: no request spam
CREATE UNIQUE INDEX IF NOT EXISTS idx_access_requests_one_pending ON access_requests (user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_access_requests_status ON access_requests (status, created_at DESC);

CREATE TABLE IF NOT EXISTS photo_reports (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  photo_id    UUID NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  reporter_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reason      TEXT CHECK (reason IS NULL OR length(reason) <= 300),
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'hidden', 'dismissed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (photo_id, reporter_id)
);
CREATE INDEX IF NOT EXISTS idx_photo_reports_status ON photo_reports (status, created_at DESC);

ALTER TABLE invite_codes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE invite_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE invite_attempts    ENABLE ROW LEVEL SECURITY;   -- no policies: only the SECURITY DEFINER functions touch it
ALTER TABLE allowed_emails     ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_requests    ENABLE ROW LEVEL SECURITY;
ALTER TABLE photo_reports      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage invite codes" ON invite_codes;
CREATE POLICY "Admins manage invite codes" ON invite_codes FOR ALL
  USING (public.app_is_admin()) WITH CHECK (public.app_is_admin());

DROP POLICY IF EXISTS "Admins read redemptions" ON invite_redemptions;
CREATE POLICY "Admins read redemptions" ON invite_redemptions FOR SELECT USING (public.app_is_admin());

DROP POLICY IF EXISTS "Admins manage allowed emails" ON allowed_emails;
CREATE POLICY "Admins manage allowed emails" ON allowed_emails FOR ALL
  USING (public.app_is_admin()) WITH CHECK (public.app_is_admin());

DROP POLICY IF EXISTS "Users read their own access requests" ON access_requests;
CREATE POLICY "Users read their own access requests" ON access_requests FOR SELECT
  USING (user_id = auth.uid() OR public.app_is_admin());

DROP POLICY IF EXISTS "Users create their own access request" ON access_requests;
CREATE POLICY "Users create their own access request" ON access_requests FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND status = 'pending' AND notified_at IS NULL);

DROP POLICY IF EXISTS "Admins update access requests" ON access_requests;
CREATE POLICY "Admins update access requests" ON access_requests FOR UPDATE
  USING (public.app_is_admin()) WITH CHECK (public.app_is_admin());

DROP POLICY IF EXISTS "Users report photos" ON photo_reports;
CREATE POLICY "Users report photos" ON photo_reports FOR INSERT TO authenticated
  WITH CHECK (reporter_id = auth.uid() AND status = 'open');

DROP POLICY IF EXISTS "Reporters and admins read reports" ON photo_reports;
CREATE POLICY "Reporters and admins read reports" ON photo_reports FOR SELECT
  USING (reporter_id = auth.uid() OR public.app_is_admin());

DROP POLICY IF EXISTS "Admins update reports" ON photo_reports;
CREATE POLICY "Admins update reports" ON photo_reports FOR UPDATE
  USING (public.app_is_admin()) WITH CHECK (public.app_is_admin());

-- Admins can see and hide (is_private = true) any photo; the owner keeps seeing it
DROP POLICY IF EXISTS "Admins view all photos" ON photos;
CREATE POLICY "Admins view all photos" ON photos FOR SELECT USING (public.app_is_admin());
DROP POLICY IF EXISTS "Admins update any photo" ON photos;
CREATE POLICY "Admins update any photo" ON photos FOR UPDATE
  USING (public.app_is_admin()) WITH CHECK (public.app_is_admin());

-- ---------------------------------------------------------------------
-- 4. The gate: uploading needs can_upload + quota left (admins always pass)
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can insert their own photos" ON photos;
CREATE POLICY "Users can insert their own photos"
  ON photos FOR INSERT
  WITH CHECK (auth.uid() = user_id AND public.can_upload_photo(auth.uid()));

DROP POLICY IF EXISTS "Users upload into their own folder" ON storage.objects;
CREATE POLICY "Users upload into their own folder"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND public.can_upload_photo(auth.uid())
  );

-- ---------------------------------------------------------------------
-- 5. Redeem an invite code (called from the browser)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.redeem_invite_code(p_code TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid UUID := auth.uid();
  c invite_codes%ROWTYPE;
  fails INTEGER;
  prof profiles%ROWTYPE;
BEGIN
  IF uid IS NULL THEN RETURN jsonb_build_object('ok', FALSE, 'error', 'Sign in first'); END IF;

  DELETE FROM invite_attempts WHERE created_at < now() - interval '1 day';
  SELECT count(*) INTO fails FROM invite_attempts WHERE user_id = uid AND NOT ok AND created_at > now() - interval '1 hour';
  IF fails >= 8 THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Too many wrong codes. Try again in an hour.');
  END IF;

  SELECT * INTO c FROM invite_codes WHERE upper(code) = upper(trim(p_code)) FOR UPDATE;
  IF NOT FOUND
     OR (c.expires_at IS NOT NULL AND c.expires_at <= now())
     OR (c.max_uses IS NOT NULL AND c.used_count >= c.max_uses
         AND NOT EXISTS (SELECT 1 FROM invite_redemptions WHERE code = c.code AND user_id = uid)) THEN
    INSERT INTO invite_attempts (user_id, ok) VALUES (uid, FALSE);
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Invalid, expired or fully used invite code');
  END IF;

  -- Same user entering the same code again: no extra use is burned
  IF NOT EXISTS (SELECT 1 FROM invite_redemptions WHERE code = c.code AND user_id = uid) THEN
    INSERT INTO invite_redemptions (code, user_id) VALUES (c.code, uid);
    UPDATE invite_codes SET used_count = used_count + 1 WHERE code = c.code;
    PERFORM public.grant_upload(uid, c.quota_granted);
  END IF;
  INSERT INTO invite_attempts (user_id, ok) VALUES (uid, TRUE);

  SELECT * INTO prof FROM profiles WHERE id = uid;
  RETURN jsonb_build_object('ok', TRUE, 'can_upload', prof.can_upload, 'photo_quota', prof.photo_quota);
END $$;

-- ---------------------------------------------------------------------
-- 6. Pre-approved emails: applied once the address is confirmed (a sign-up alone proves nothing)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_allowed_email(uid UUID, mail TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE q INTEGER;
BEGIN
  SELECT quota_granted INTO q FROM allowed_emails WHERE email = lower(mail);
  IF FOUND THEN PERFORM public.grant_upload(uid, q); END IF;
END $$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, username, full_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1) || '_' || substr(NEW.id::text, 1, 6)),
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url'
  );
  IF NEW.email_confirmed_at IS NOT NULL THEN PERFORM public.apply_allowed_email(NEW.id, NEW.email); END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.handle_user_confirmed()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.apply_allowed_email(NEW.id, NEW.email);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_auth_user_confirmed ON auth.users;
CREATE TRIGGER on_auth_user_confirmed
  AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW WHEN (OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL)
  EXECUTE FUNCTION public.handle_user_confirmed();

-- An email added to allowed_emails later also unlocks an already-confirmed account
CREATE OR REPLACE FUNCTION public.handle_allowed_email_added()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM auth.users WHERE lower(email) = NEW.email AND email_confirmed_at IS NOT NULL LOOP
    PERFORM public.grant_upload(r.id, NEW.quota_granted);
  END LOOP;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_allowed_email_added ON allowed_emails;
CREATE TRIGGER trg_allowed_email_added
  AFTER INSERT ON allowed_emails
  FOR EACH ROW EXECUTE FUNCTION public.handle_allowed_email_added();

-- ---------------------------------------------------------------------
-- 7. Admin RPCs + notification de-duplication
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_approve_request(p_id UUID, p_quota INTEGER)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid UUID;
BEGIN
  IF NOT public.app_is_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
  UPDATE access_requests SET status = 'approved' WHERE id = p_id AND status = 'pending' RETURNING user_id INTO uid;
  IF uid IS NULL THEN RAISE EXCEPTION 'Request is not pending'; END IF;
  PERFORM public.grant_upload(uid, p_quota);
END $$;

CREATE OR REPLACE FUNCTION public.admin_list_creators()
RETURNS TABLE (id UUID, email TEXT, full_name TEXT, username TEXT, is_admin BOOLEAN, can_upload BOOLEAN,
               photo_quota INTEGER, photo_count BIGINT, created_at TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.app_is_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
  RETURN QUERY
    SELECT p.id, u.email::TEXT, p.full_name, p.username, p.is_admin, p.can_upload, p.photo_quota,
           (SELECT count(*) FROM photos ph WHERE ph.user_id = p.id), p.created_at
      FROM profiles p JOIN auth.users u ON u.id = p.id
     ORDER BY p.can_upload DESC, p.created_at DESC
     LIMIT 300;
END $$;

-- True only the first time (the server then sends the admin notification once per request)
CREATE OR REPLACE FUNCTION public.mark_request_notified(p_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE done BOOLEAN;
BEGIN
  UPDATE access_requests SET notified_at = now()
   WHERE id = p_id AND user_id = auth.uid() AND notified_at IS NULL AND status = 'pending'
  RETURNING TRUE INTO done;
  RETURN COALESCE(done, FALSE);
END $$;

REVOKE EXECUTE ON FUNCTION public.grant_upload(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_allowed_email(UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- 8. Make yourself admin (replace the email, run once):
--
--   UPDATE profiles SET is_admin = TRUE, can_upload = TRUE, photo_quota = NULL
--    WHERE id = (SELECT id FROM auth.users WHERE email = 'YOUR-ADMIN-EMAIL');
--
-- Pre-approve friends / create codes without the panel:
--   INSERT INTO allowed_emails (email, quota_granted) VALUES ('friend@example.com', 15);
--   INSERT INTO invite_codes (code, max_uses, quota_granted) VALUES ('BETA-2026', 20, 15);
-- ---------------------------------------------------------------------
