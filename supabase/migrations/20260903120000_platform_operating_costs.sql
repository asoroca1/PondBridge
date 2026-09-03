BEGIN;

-- Operational finances: the recurring vendor and service costs of running the
-- platform. Platform-wide by nature (no tenant_id) — these are PondBridge's
-- own bills, not a camp's.
CREATE TABLE IF NOT EXISTS public.platform_operating_costs (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  name text NOT NULL CHECK (btrim(name) <> '' AND length(name) <= 120),
  vendor text NOT NULL DEFAULT '' CHECK (length(vendor) <= 120),
  category text NOT NULL DEFAULT 'other'
    CHECK (category IN ('infrastructure', 'email', 'ai', 'payments', 'domains', 'software', 'people', 'other')),
  -- Stored in cents so totals never drift through floating point.
  amount_cents integer NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  currency text NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  billing_cycle text NOT NULL DEFAULT 'monthly'
    CHECK (billing_cycle IN ('monthly', 'quarterly', 'annual', 'one_time')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'canceled')),
  started_on date,
  renews_on date,
  url text NOT NULL DEFAULT '' CHECK (length(url) <= 500),
  notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 2000),
  created_by_user_id text REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by_user_id text REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_operating_costs_status
  ON public.platform_operating_costs (status, category, name);

ALTER TABLE public.platform_operating_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_operating_costs FORCE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_operating_costs TO service_role;
REVOKE ALL ON public.platform_operating_costs FROM anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'platform_operating_costs'
      AND policyname = 'platform_operating_costs_service_role_all'
  ) THEN
    CREATE POLICY platform_operating_costs_service_role_all
      ON public.platform_operating_costs
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END;
$$;

COMMIT;
