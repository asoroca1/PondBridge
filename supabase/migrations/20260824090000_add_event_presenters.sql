-- Multi-presenter support for events and info sessions.
--
-- Until now an event carried a single host in events.host_profile_id. Directors
-- run sessions with panels, co-hosts, and guest speakers, so presenters now live
-- in their own table. host_profile_id is kept as a denormalized mirror of the
-- first presenter so existing publish checks, emails, and indexes keep working.

CREATE TABLE IF NOT EXISTS public.event_presenters (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id text NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  profile_id text NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  -- True when adding the presenter also created their "attending" RSVP, so
  -- removing them again does not wipe an RSVP the member made themselves.
  rsvp_created boolean NOT NULL DEFAULT false,
  added_by_user_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_event_presenters_tenant_event
  ON public.event_presenters (tenant_id, event_id, sort_order ASC);
CREATE INDEX IF NOT EXISTS idx_event_presenters_profile_fk
  ON public.event_presenters (profile_id);
CREATE INDEX IF NOT EXISTS idx_event_presenters_user_fk
  ON public.event_presenters (user_id);

-- Same guarantee the RSVP trigger gives: a presenter is always an active,
-- registered member of the event's own tenant.
CREATE OR REPLACE FUNCTION public.enforce_event_presenter_registration()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  event_tenant_id text;
  profile_tenant_id text;
  profile_user_id text;
  profile_status text;
  user_tenant_id text;
  user_status text;
BEGIN
  SELECT e.tenant_id INTO event_tenant_id
  FROM public.events e
  WHERE e.id = NEW.event_id
  LIMIT 1;

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
      MESSAGE = 'event presenter must be an active registered member of the event tenant';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_enforce_event_presenter_registration ON public.event_presenters;
CREATE TRIGGER trigger_enforce_event_presenter_registration
BEFORE INSERT OR UPDATE OF tenant_id, event_id, profile_id, user_id ON public.event_presenters
FOR EACH ROW
EXECUTE FUNCTION public.enforce_event_presenter_registration();

DO $$
BEGIN
  IF to_regprocedure('public.trigger_set_updated_at()') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS set_updated_at ON public.event_presenters';
    EXECUTE 'CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.event_presenters FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at()';
  END IF;
END;
$$;

-- Existing hosts become the first presenter on their event.
INSERT INTO public.event_presenters (tenant_id, event_id, profile_id, user_id, sort_order, rsvp_created)
SELECT e.tenant_id, e.id, p.id, p.user_id, 0, false
FROM public.events e
JOIN public.profiles p ON p.id = e.host_profile_id
JOIN public.users u ON u.id = p.user_id
WHERE e.host_profile_id IS NOT NULL
  AND btrim(e.host_profile_id) <> ''
  AND p.tenant_id = e.tenant_id
  AND u.tenant_id = e.tenant_id
  AND p.status = 'active'
  AND u.status = 'active'
ON CONFLICT (event_id, profile_id) DO NOTHING;

REVOKE ALL ON FUNCTION public.enforce_event_presenter_registration()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_event_presenter_registration()
  TO service_role;

ALTER TABLE public.event_presenters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_presenters FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS event_presenters_service_role_all ON public.event_presenters;
CREATE POLICY event_presenters_service_role_all
ON public.event_presenters
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_presenters TO service_role;
REVOKE ALL ON public.event_presenters FROM anon, authenticated;
