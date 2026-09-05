-- Applied to production 2026-09-04 as `city_geo_trigram_and_operating_cost_fk_indexes`.
--
-- The most expensive application query in pg_stat_statements was the city
-- autocomplete behind GET /geo (apps/api/src/routes/geo.js), which PostgREST
-- renders as:
--     city ILIKE $1 ORDER BY population DESC LIMIT n
--
-- ILIKE cannot use the btree on lower(city), so the planner walked
-- idx_city_geo_population and filtered row by row. On a prefix that matches
-- nothing that reads the entire table:
--
--   before: 'zurz%' -> 142,911 rows removed by filter, 141,584 buffers, 1,220 ms
--   after:  'zurz%' -> bitmap index scan, 15 buffers, 0.29 ms
--
-- pg_trgm is already installed by the native baseline. A GIN trigram index
-- serves ILIKE directly, and the planner still prefers the population index for
-- very common prefixes, so both cases stay fast. Index size: 5 MB.
create index if not exists idx_city_geo_city_trgm
  on public.city_geo using gin (city extensions.gin_trgm_ops);

-- Advisor: unindexed_foreign_keys on public.platform_operating_costs.
create index if not exists idx_platform_operating_costs_created_by_user_id
  on public.platform_operating_costs (created_by_user_id);

create index if not exists idx_platform_operating_costs_updated_by_user_id
  on public.platform_operating_costs (updated_by_user_id);
