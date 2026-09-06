-- Let the database group the alumni map's cities instead of shipping every row.
--
-- `aggregateCityCounts` paged every active profile that has a city out of
-- PostgREST -- three round trips and roughly 3,000 rows for a camp Cedar's size
-- -- to arrive at about sixty pins. The source carried a TODO asking for a
-- GROUP BY.
--
-- This function does only the grouping. The map's pin key is derived from the
-- free-text `city_state` column by a parser the API runs in JS, and an earlier
-- draft of this migration reimplemented that parser in SQL so the whole tally
-- could happen here. Measured against the read it replaced, that version cost
-- 162ms of server time versus 2.4ms -- the regex work per row swamped everything
-- the grouping saved, and it introduced a second copy of a parser that had to
-- stay bug-for-bug identical to the first.
--
-- Grouping on the column alone measures 3.9ms and leaves the parser where it
-- already is, applied to sixty distinct strings instead of three thousand rows.
--
-- Hidden members are excluded with NOT EXISTS over unnest rather than
-- `<> ANY(array)`: with 500 hidden ids the array form measured 56.2ms against
-- 4.4ms for the anti-join, for identical output.
CREATE OR REPLACE FUNCTION public.city_state_counts(
  p_tenant_id text,
  p_hidden_user_ids text[] DEFAULT '{}'
)
RETURNS TABLE (city_state text, count bigint)
LANGUAGE sql STABLE PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
  SELECT p.city_state, count(*)::bigint
  FROM public.profiles p
  WHERE p.tenant_id = p_tenant_id
    AND p.status = 'active'
    AND p.city_state IS NOT NULL
    AND btrim(p.city_state) <> ''
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(coalesce(p_hidden_user_ids, '{}')) AS hidden(id)
      WHERE hidden.id = p.user_id
    )
  GROUP BY p.city_state;
$$;

-- Same posture as every other RPC here: service_role only.
DO $$
DECLARE
  function_oid regprocedure := to_regprocedure('public.city_state_counts(text,text[])');
BEGIN
  IF function_oid IS NOT NULL THEN
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', function_oid);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', function_oid);
  END IF;
END
$$;

-- The map reads active profiles that have a city, per tenant.
CREATE INDEX IF NOT EXISTS profiles_tenant_active_city_idx
  ON public.profiles (tenant_id, status)
  WHERE city_state IS NOT NULL AND city_state <> '';
