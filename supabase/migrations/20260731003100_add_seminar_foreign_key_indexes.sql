-- Cover seminar access-log foreign keys for deletes, joins, and audit queries.

CREATE INDEX IF NOT EXISTS idx_event_join_access_event
  ON public.event_join_access_logs (event_id, accessed_at DESC);

CREATE INDEX IF NOT EXISTS idx_event_join_access_profile
  ON public.event_join_access_logs (profile_id, accessed_at DESC);

CREATE INDEX IF NOT EXISTS idx_event_join_access_user
  ON public.event_join_access_logs (user_id, accessed_at DESC);
