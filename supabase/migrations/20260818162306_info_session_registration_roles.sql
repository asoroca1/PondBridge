-- Info sessions that can be scheduled later, and registration as a presenter.
--
-- A camp wants to open a session for sign-ups before a date exists, so it can
-- pick a time that suits whoever volunteers. That means starts_at can no longer
-- be required, and a registration has to say whether the person is presenting
-- or attending.

-- 1. A session may be created, published and registered for before it is dated.
ALTER TABLE public.events
  ALTER COLUMN starts_at DROP NOT NULL;

-- 2. Registrations carry the role the member signed up for.
ALTER TABLE public.event_rsvps
  ADD COLUMN IF NOT EXISTS registration_role text NOT NULL DEFAULT 'attendee';

ALTER TABLE public.event_rsvps
  DROP CONSTRAINT IF EXISTS event_rsvps_registration_role_check;

ALTER TABLE public.event_rsvps
  ADD CONSTRAINT event_rsvps_registration_role_check
    CHECK (registration_role IN ('attendee', 'presenter'));

-- The roster is read per event and ordered by who registered first, and the
-- presenter counts are read the same way.
CREATE INDEX IF NOT EXISTS idx_event_rsvps_event_role
  ON public.event_rsvps (tenant_id, event_id, registration_role, responded_at ASC);

-- Undated sessions sort after dated ones rather than being dropped by the
-- existing (tenant_id, status, starts_at) index scans.
CREATE INDEX IF NOT EXISTS idx_events_tenant_status_undated
  ON public.events (tenant_id, status, created_at DESC)
  WHERE starts_at IS NULL;
