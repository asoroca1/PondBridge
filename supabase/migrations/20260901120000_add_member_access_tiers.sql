-- Tiered access: numbered visibility tiers a camp defines for its own network.
--
-- Rank 1 is the top tier and sees every tier beneath it; the highest rank is the
-- bottom tier and sees only itself. Nothing in this migration changes behaviour
-- on its own — enforcement is gated behind the `tieredAccess` module and the
-- `accessSettings.tiers.enabled` flag, both of which default to off.

BEGIN;

-- 1. The tiers a camp defines -----------------------------------------------

CREATE TABLE IF NOT EXISTS public.member_access_tiers (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  rank int NOT NULL CHECK (rank >= 1 AND rank <= 6),
  label text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, rank)
);

CREATE INDEX IF NOT EXISTS idx_member_access_tiers_tenant
  ON public.member_access_tiers (tenant_id, rank);

-- 2. The tag on the person ---------------------------------------------------
-- `access_tier_rank` is denormalized from the tier row so that filtering stays a
-- single indexed predicate instead of a join or a large IN list.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS access_tier_id text,
  ADD COLUMN IF NOT EXISTS access_tier_rank int;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_access_tier_id_fkey'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_access_tier_id_fkey
      FOREIGN KEY (access_tier_id)
      REFERENCES public.member_access_tiers(id)
      ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_profiles_tenant_tier
  ON public.profiles (tenant_id, access_tier_rank);

-- Deleting a tier clears the denormalized rank too. The FK above only nulls the
-- id, which would otherwise leave an orphaned rank behind.
CREATE OR REPLACE FUNCTION public.clear_profile_access_tier_rank()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.profiles
  SET access_tier_rank = NULL,
      updated_at = now()
  WHERE tenant_id = OLD.tenant_id
    AND access_tier_rank = OLD.rank
    AND access_tier_id IS NULL;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql
SET search_path = pg_catalog, public;

DROP TRIGGER IF EXISTS trigger_clear_profile_access_tier_rank ON public.member_access_tiers;
CREATE TRIGGER trigger_clear_profile_access_tier_rank
AFTER DELETE ON public.member_access_tiers
FOR EACH ROW EXECUTE FUNCTION public.clear_profile_access_tier_rank();

-- A tier must belong to the same tenant as the profile that points at it.
CREATE OR REPLACE FUNCTION public.enforce_profile_access_tier_tenant()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.access_tier_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.member_access_tiers
    WHERE id = NEW.access_tier_id AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Access tier must belong to the profile tenant';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = pg_catalog, public;

DROP TRIGGER IF EXISTS trigger_enforce_profile_access_tier_tenant ON public.profiles;
CREATE TRIGGER trigger_enforce_profile_access_tier_tenant
BEFORE INSERT OR UPDATE OF access_tier_id, tenant_id ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.enforce_profile_access_tier_tenant();

-- 3. Teach the search RPC about tiers ---------------------------------------
-- The two new parameters default to NULL, so existing six-argument callers keep
-- working unchanged. The old signature is dropped first: leaving it in place
-- would make a six-argument call ambiguous across two overloads.

DROP FUNCTION IF EXISTS public.search_profiles(text, text, text, text, text, integer);

CREATE OR REPLACE FUNCTION public.search_profiles(
  p_tenant_id text,
  p_query text,
  p_role_at_camp text DEFAULT NULL,
  p_industry text DEFAULT NULL,
  p_city_state text DEFAULT NULL,
  p_limit integer DEFAULT 30,
  p_viewer_tier_rank integer DEFAULT NULL,
  p_untagged_tier_rank integer DEFAULT NULL
)
RETURNS SETOF public.profiles
LANGUAGE sql STABLE
SET search_path = pg_catalog, public, extensions
AS $$
  WITH normalized AS (
    SELECT
      trim(coalesce(p_query, '')) AS raw_query,
      lower(trim(coalesce(p_query, ''))) AS query_lc
  ),
  base AS (
    SELECT
      p.id,
      lower(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, ''))) AS full_name,
      lower(coalesce(p.city_state, '')) AS city_state_lc,
      lower(coalesce(p.role_at_camp, '')) AS role_lc,
      lower(coalesce(p.industry, '')) AS industry_lc,
      lower(array_to_string(coalesce(p.emails, '{}'::text[]), ' ')) AS emails_lc,
      lower(array_to_string(coalesce(p.colleges, '{}'::text[]), ' ')) AS colleges_lc,
      lower(coalesce(p.current_jobs::text, '')) AS jobs_lc
    FROM public.profiles p
    WHERE p.tenant_id = p_tenant_id
      AND p.status <> 'removed'
      AND (p_role_at_camp IS NULL OR p.role_at_camp ILIKE '%' || p_role_at_camp || '%')
      AND (p_industry IS NULL OR p.industry ILIKE '%' || p_industry || '%')
      AND (p_city_state IS NULL OR p.city_state ILIKE '%' || p_city_state || '%')
      -- Tier gate: a viewer at rank N sees rank N and every larger rank.
      AND (
        p_viewer_tier_rank IS NULL
        OR coalesce(p.access_tier_rank, p_untagged_tier_rank) IS NULL
        OR coalesce(p.access_tier_rank, p_untagged_tier_rank) >= p_viewer_tier_rank
      )
  ),
  scored AS (
    SELECT
      b.id,
      CASE WHEN n.query_lc <> '' AND b.full_name = n.query_lc THEN 1 ELSE 0 END AS exact_name_rank,
      CASE
        WHEN n.query_lc <> '' AND (
          b.full_name LIKE n.query_lc || '%'
          OR b.emails_lc LIKE n.query_lc || '%'
        ) THEN 1
        ELSE 0
      END AS prefix_rank,
      CASE
        WHEN n.query_lc <> '' AND (
          b.full_name ILIKE '%' || n.raw_query || '%'
          OR b.city_state_lc ILIKE '%' || n.query_lc || '%'
          OR b.role_lc ILIKE '%' || n.query_lc || '%'
          OR b.industry_lc ILIKE '%' || n.query_lc || '%'
          OR b.emails_lc ILIKE '%' || n.query_lc || '%'
          OR b.colleges_lc ILIKE '%' || n.query_lc || '%'
          OR b.jobs_lc ILIKE '%' || n.query_lc || '%'
        ) THEN 1
        ELSE 0
      END AS contains_rank,
      CASE
        WHEN n.query_lc = '' THEN 0::double precision
        ELSE GREATEST(
          similarity(b.full_name, n.query_lc),
          similarity(b.emails_lc, n.query_lc),
          similarity(b.city_state_lc, n.query_lc),
          similarity(b.role_lc, n.query_lc),
          similarity(b.industry_lc, n.query_lc),
          similarity(b.colleges_lc, n.query_lc),
          similarity(b.jobs_lc, n.query_lc)
        )
      END AS similarity_rank
    FROM base b
    CROSS JOIN normalized n
  )
  SELECT p.*
  FROM scored s
  JOIN public.profiles p ON p.id = s.id
  WHERE
    (SELECT query_lc FROM normalized) = ''
    OR s.exact_name_rank = 1
    OR s.prefix_rank = 1
    OR s.contains_rank = 1
    OR s.similarity_rank >= 0.22
  ORDER BY
    s.exact_name_rank DESC,
    s.prefix_rank DESC,
    s.contains_rank DESC,
    s.similarity_rank DESC,
    p.last_name ASC,
    p.first_name ASC
  LIMIT COALESCE(p_limit, 30);
$$;

-- 4. Privileges --------------------------------------------------------------
-- PondBridge never touches the Data API from the browser; mirror the hardening
-- migration so the new table is service-role only.

DO $$
BEGIN
  IF to_regclass('public.member_access_tiers') IS NOT NULL THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_access_tiers TO service_role;
    REVOKE ALL ON public.member_access_tiers FROM anon, authenticated;
  END IF;
END;
$$;

COMMIT;
