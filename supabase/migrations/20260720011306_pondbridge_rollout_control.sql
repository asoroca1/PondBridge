BEGIN;

CREATE TABLE IF NOT EXISTS public.feature_rollouts (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  feature_key text NOT NULL UNIQUE
    CHECK (feature_key ~ '^[a-z][a-z0-9_]{2,80}$'),
  state text NOT NULL DEFAULT 'disabled'
    CHECK (state IN ('disabled', 'pilot', 'enabled')),
  kill_switch boolean NOT NULL DEFAULT true,
  tenant_ids text[] NOT NULL DEFAULT '{}',
  excluded_tenant_ids text[] NOT NULL DEFAULT '{}',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by_user_id text REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feature_rollouts_state
  ON public.feature_rollouts (state, kill_switch, updated_at DESC);

ALTER TABLE public.feature_rollouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_rollouts FORCE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.feature_rollouts TO service_role;
REVOKE ALL ON public.feature_rollouts FROM anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'feature_rollouts'
      AND policyname = 'feature_rollouts_service_role_all'
  ) THEN
    CREATE POLICY feature_rollouts_service_role_all
      ON public.feature_rollouts
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END;
$$;

COMMIT;
