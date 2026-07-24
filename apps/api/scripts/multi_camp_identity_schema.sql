BEGIN;

CREATE TABLE IF NOT EXISTS public.identities (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  clerk_user_id text,
  primary_email text NOT NULL,
  verified_emails text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  platform_roles text[] NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_identities_clerk_user_unique
  ON public.identities (clerk_user_id)
  WHERE clerk_user_id IS NOT NULL AND clerk_user_id <> '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_identities_primary_email_unique
  ON public.identities (public.lower_immutable(primary_email));

CREATE TABLE IF NOT EXISTS public.tenant_memberships (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  identity_id text NOT NULL REFERENCES public.identities(id) ON DELETE CASCADE,
  legacy_user_id text REFERENCES public.users(id) ON DELETE SET NULL,
  roles text[] NOT NULL DEFAULT '{user}',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  join_method text NOT NULL DEFAULT 'legacy_backfill'
    CHECK (join_method IN ('legacy_backfill', 'invite', 'approval', 'open_signup', 'admin_created')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, identity_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_memberships_legacy_user_unique
  ON public.tenant_memberships (legacy_user_id)
  WHERE legacy_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tenant_memberships_identity
  ON public.tenant_memberships (identity_id, status, tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_memberships_tenant
  ON public.tenant_memberships (tenant_id, status, created_at DESC);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS tenant_membership_id text REFERENCES public.tenant_memberships(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_tenant_membership_unique
  ON public.profiles (tenant_membership_id)
  WHERE tenant_membership_id IS NOT NULL;

-- Replace the legacy global one-camp trigger with a rollout-aware guard. A
-- target tenant may create an additional legacy compatibility row only while
-- its durable multi-camp feature flag is enabled and the kill switch is off.
-- Control tenants retain the original database-level rejection.
CREATE OR REPLACE FUNCTION public.enforce_single_tenant_membership()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  conflicting_tenant_id text;
  multi_camp_allowed boolean := false;
BEGIN
  IF NEW.tenant_id IS NULL OR NEW.status IS DISTINCT FROM 'active' THEN
    RETURN NEW;
  END IF;

  IF to_regclass('public.feature_rollouts') IS NOT NULL THEN
    SELECT coalesce(
      fr.kill_switch = false
      AND NOT (NEW.tenant_id = ANY(coalesce(fr.excluded_tenant_ids, '{}'::text[])))
      AND (
        fr.state = 'enabled'
        OR (
          fr.state = 'pilot'
          AND NEW.tenant_id = ANY(coalesce(fr.tenant_ids, '{}'::text[]))
        )
      ),
      false
    )
    INTO multi_camp_allowed
    FROM public.feature_rollouts fr
    WHERE fr.feature_key = 'multi_camp_identity_v1'
    LIMIT 1;
  END IF;

  IF multi_camp_allowed THEN
    RETURN NEW;
  END IF;

  SELECT u.tenant_id
  INTO conflicting_tenant_id
  FROM public.users u
  WHERE u.id <> COALESCE(NEW.id, '')
    AND u.tenant_id IS NOT NULL
    AND u.status = 'active'
    AND (
      (NEW.clerk_user_id IS NOT NULL AND NEW.clerk_user_id <> '' AND u.clerk_user_id = NEW.clerk_user_id)
      OR lower(u.email) = lower(NEW.email)
    )
    AND u.tenant_id <> NEW.tenant_id
  LIMIT 1;

  IF conflicting_tenant_id IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'identity is already bound to a different tenant',
      DETAIL = format('existing_tenant_id=%s new_tenant_id=%s', conflicting_tenant_id, NEW.tenant_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_enforce_single_tenant_membership ON public.users;
CREATE TRIGGER trigger_enforce_single_tenant_membership
BEFORE INSERT OR UPDATE ON public.users
FOR EACH ROW
EXECUTE FUNCTION public.enforce_single_tenant_membership();

ALTER TABLE public.identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.identities FORCE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_memberships FORCE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.identities, public.tenant_memberships
  TO service_role;
REVOKE ALL
  ON public.identities, public.tenant_memberships
  FROM anon, authenticated;

DO $$
DECLARE
  table_name text;
  policy_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['identities', 'tenant_memberships']
  LOOP
    policy_name := format('%s_service_role_all', table_name);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = table_name
        AND policyname = policy_name
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
        policy_name,
        table_name
      );
    END IF;
  END LOOP;
END;
$$;

COMMIT;
