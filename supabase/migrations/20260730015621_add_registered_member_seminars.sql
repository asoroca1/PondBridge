-- Registered-member seminar support.
--
-- Public seminar metadata lives on events so it can be listed efficiently.
-- Meeting URLs live in a separate service-role-only table and are released
-- through the authenticated API only after membership and RSVP checks.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS event_type text NOT NULL DEFAULT 'community',
  ADD COLUMN IF NOT EXISTS delivery_mode text NOT NULL DEFAULT 'in_person',
  ADD COLUMN IF NOT EXISTS topic_category text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS topic_title text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'all_members',
  ADD COLUMN IF NOT EXISTS meeting_provider text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS host_profile_id text REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS capacity integer;

ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_event_type_check,
  DROP CONSTRAINT IF EXISTS events_delivery_mode_check,
  DROP CONSTRAINT IF EXISTS events_topic_category_check,
  DROP CONSTRAINT IF EXISTS events_audience_check,
  DROP CONSTRAINT IF EXISTS events_meeting_provider_check,
  DROP CONSTRAINT IF EXISTS events_capacity_check;

ALTER TABLE public.events
  ADD CONSTRAINT events_event_type_check
    CHECK (event_type IN ('community', 'seminar')),
  ADD CONSTRAINT events_delivery_mode_check
    CHECK (delivery_mode IN ('in_person', 'online', 'hybrid')),
  ADD CONSTRAINT events_topic_category_check
    CHECK (topic_category IN ('', 'career', 'college', 'financial_literacy', 'networking', 'other')),
  ADD CONSTRAINT events_audience_check
    CHECK (audience IN ('all_members', 'students', 'young_alumni', 'parents', 'college_applicants', 'career_explorers')),
  ADD CONSTRAINT events_meeting_provider_check
    CHECK (meeting_provider IN ('', 'zoom', 'microsoft_teams', 'google_meet', 'other')),
  ADD CONSTRAINT events_capacity_check
    CHECK (capacity IS NULL OR capacity > 0);

CREATE INDEX IF NOT EXISTS idx_events_tenant_type_start
  ON public.events (tenant_id, event_type, starts_at ASC);
CREATE INDEX IF NOT EXISTS idx_events_host_profile
  ON public.events (host_profile_id)
  WHERE host_profile_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.event_meeting_details (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id text NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  meeting_url text NOT NULL DEFAULT '',
  access_policy text NOT NULL DEFAULT 'registered_rsvp'
    CHECK (access_policy IN ('registered_rsvp')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id)
);

CREATE INDEX IF NOT EXISTS idx_event_meeting_details_tenant_event
  ON public.event_meeting_details (tenant_id, event_id);

CREATE TABLE IF NOT EXISTS public.event_join_access_logs (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id text NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  profile_id text NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  access_type text NOT NULL DEFAULT 'meeting_link_opened'
    CHECK (access_type IN ('meeting_link_opened')),
  accessed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_join_access_tenant_event
  ON public.event_join_access_logs (tenant_id, event_id, accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_join_access_tenant_profile
  ON public.event_join_access_logs (tenant_id, profile_id, accessed_at DESC);

CREATE OR REPLACE FUNCTION public.enforce_event_host_tenant_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  host_tenant_id text;
  host_profile_status text;
  host_user_status text;
BEGIN
  IF NEW.host_profile_id IS NULL OR btrim(NEW.host_profile_id) = '' THEN
    RETURN NEW;
  END IF;

  SELECT p.tenant_id, p.status, u.status
  INTO host_tenant_id, host_profile_status, host_user_status
  FROM public.profiles p
  JOIN public.users u ON u.id = p.user_id
  WHERE p.id = NEW.host_profile_id
  LIMIT 1;

  IF host_tenant_id IS NULL
     OR host_tenant_id <> NEW.tenant_id
     OR host_profile_status <> 'active'
     OR host_user_status <> 'active' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'seminar host must be an active registered member of the event tenant';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_enforce_event_host_tenant_consistency ON public.events;
CREATE TRIGGER trigger_enforce_event_host_tenant_consistency
BEFORE INSERT OR UPDATE OF tenant_id, host_profile_id ON public.events
FOR EACH ROW
EXECUTE FUNCTION public.enforce_event_host_tenant_consistency();

CREATE OR REPLACE FUNCTION public.enforce_event_private_record_tenant_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  event_tenant_id text;
  profile_tenant_id text;
  profile_user_id text;
  user_tenant_id text;
BEGIN
  SELECT e.tenant_id INTO event_tenant_id
  FROM public.events e
  WHERE e.id = NEW.event_id
  LIMIT 1;

  IF event_tenant_id IS NULL OR event_tenant_id <> NEW.tenant_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'event private record must match the event tenant';
  END IF;

  IF TG_TABLE_NAME = 'event_join_access_logs' THEN
    SELECT p.tenant_id, p.user_id INTO profile_tenant_id, profile_user_id
    FROM public.profiles p
    WHERE p.id = NEW.profile_id
    LIMIT 1;

    SELECT u.tenant_id INTO user_tenant_id
    FROM public.users u
    WHERE u.id = NEW.user_id
    LIMIT 1;

    IF profile_tenant_id IS NULL
       OR profile_tenant_id <> NEW.tenant_id
       OR profile_user_id <> NEW.user_id
       OR user_tenant_id <> NEW.tenant_id THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'event access actor must be a registered member of the event tenant';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_enforce_event_meeting_tenant_consistency ON public.event_meeting_details;
CREATE TRIGGER trigger_enforce_event_meeting_tenant_consistency
BEFORE INSERT OR UPDATE OF tenant_id, event_id ON public.event_meeting_details
FOR EACH ROW
EXECUTE FUNCTION public.enforce_event_private_record_tenant_consistency();

DROP TRIGGER IF EXISTS trigger_enforce_event_join_tenant_consistency ON public.event_join_access_logs;
CREATE TRIGGER trigger_enforce_event_join_tenant_consistency
BEFORE INSERT OR UPDATE OF tenant_id, event_id, profile_id, user_id ON public.event_join_access_logs
FOR EACH ROW
EXECUTE FUNCTION public.enforce_event_private_record_tenant_consistency();

CREATE OR REPLACE FUNCTION public.enforce_event_rsvp_registration_and_capacity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  event_tenant_id text;
  event_capacity integer;
  profile_tenant_id text;
  profile_user_id text;
  profile_status text;
  user_tenant_id text;
  user_status text;
  attending_count integer;
  should_check_capacity boolean := false;
BEGIN
  SELECT e.tenant_id, e.capacity
  INTO event_tenant_id, event_capacity
  FROM public.events e
  WHERE e.id = NEW.event_id
  FOR UPDATE;

  SELECT p.tenant_id, p.user_id, p.status, u.tenant_id, u.status
  INTO profile_tenant_id, profile_user_id, profile_status, user_tenant_id, user_status
  FROM public.profiles p
  JOIN public.users u ON u.id = p.user_id
  WHERE p.id = NEW.profile_id
  LIMIT 1;

  IF event_tenant_id IS NULL
     OR event_tenant_id <> NEW.tenant_id
     OR profile_tenant_id <> NEW.tenant_id
     OR profile_user_id <> NEW.user_id
     OR user_tenant_id <> NEW.tenant_id
     OR profile_status <> 'active'
     OR user_status <> 'active' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'event RSVP must belong to an active registered member of the event tenant';
  END IF;

  IF NEW.status = 'attending' AND event_capacity IS NOT NULL THEN
    IF TG_OP = 'INSERT' THEN
      should_check_capacity := true;
    ELSE
      should_check_capacity := OLD.status <> 'attending' OR OLD.event_id <> NEW.event_id;
    END IF;
  END IF;

  IF should_check_capacity THEN
    SELECT count(*)::integer
    INTO attending_count
    FROM public.event_rsvps r
    WHERE r.event_id = NEW.event_id
      AND r.status = 'attending'
      AND r.id <> NEW.id;

    IF attending_count >= event_capacity THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'event has reached registration capacity';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_enforce_event_rsvp_registration_and_capacity ON public.event_rsvps;
CREATE TRIGGER trigger_enforce_event_rsvp_registration_and_capacity
BEFORE INSERT OR UPDATE OF tenant_id, event_id, profile_id, user_id, status ON public.event_rsvps
FOR EACH ROW
EXECUTE FUNCTION public.enforce_event_rsvp_registration_and_capacity();

DO $$
BEGIN
  IF to_regprocedure('public.trigger_set_updated_at()') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS set_updated_at ON public.event_meeting_details';
    EXECUTE 'CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.event_meeting_details FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at()';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_event_host_tenant_consistency()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_event_private_record_tenant_consistency()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_event_rsvp_registration_and_capacity()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_event_host_tenant_consistency()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_event_private_record_tenant_consistency()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_event_rsvp_registration_and_capacity()
  TO service_role;

ALTER TABLE public.event_meeting_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_meeting_details FORCE ROW LEVEL SECURITY;
ALTER TABLE public.event_join_access_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_join_access_logs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS event_meeting_details_service_role_all ON public.event_meeting_details;
CREATE POLICY event_meeting_details_service_role_all
ON public.event_meeting_details
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS event_join_access_logs_service_role_all ON public.event_join_access_logs;
CREATE POLICY event_join_access_logs_service_role_all
ON public.event_join_access_logs
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_meeting_details TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_join_access_logs TO service_role;
REVOKE ALL ON public.event_meeting_details FROM anon, authenticated;
REVOKE ALL ON public.event_join_access_logs FROM anon, authenticated;
