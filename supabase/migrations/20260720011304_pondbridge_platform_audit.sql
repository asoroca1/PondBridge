BEGIN;

CREATE TABLE IF NOT EXISTS public.platform_admin_audit_logs (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  actor_user_id text REFERENCES public.users(id) ON DELETE SET NULL,
  event text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_audit_logs_created
  ON public.platform_admin_audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_audit_logs_event
  ON public.platform_admin_audit_logs (event, created_at DESC);

ALTER TABLE public.platform_admin_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_admin_audit_logs FORCE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_admin_audit_logs TO service_role;
REVOKE ALL ON public.platform_admin_audit_logs FROM anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'platform_admin_audit_logs'
      AND policyname = 'platform_admin_audit_logs_service_role_all'
  ) THEN
    CREATE POLICY platform_admin_audit_logs_service_role_all
      ON public.platform_admin_audit_logs
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END;
$$;

COMMIT;
