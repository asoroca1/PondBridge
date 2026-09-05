# Hosted staging environment

Created 2026-09-04, after the Supabase organization moved to the Pro plan.

## What exists

| | Production | Staging |
|---|---|---|
| Supabase project | `PondBridge` | `PondBridge Staging` |
| Project ref | `wkyjhmggkujsepafbplv` | `pvmabzjotcpvdpffsrgp` |
| API URL | `https://wkyjhmggkujsepafbplv.supabase.co` | `https://pvmabzjotcpvdpffsrgp.supabase.co` |
| Region | `us-west-2` | `us-west-1` |
| Cost | $10/mo Micro (covered by the Pro compute credit) | $10/mo Micro |

Staging is a **separate project**, not a Supabase branch. It has its own
Postgres, PostgREST, Auth and Storage, its own keys, and a stable URL that can be
wired into a Render service or a Cloudflare Pages preview without changing every
time it is rebuilt.

There are now three environments. Pick the cheapest one that can answer your question:

| | `staging:local:*` | `staging:remote:*` | production |
|---|---|---|---|
| Backed by | Docker on your laptop | hosted Supabase | hosted Supabase |
| Cost | free | $10/mo | $10/mo |
| Data | throwaway | synthetic seed | real alumni |
| Use it for | UI work, fast iteration | migration rehearsal, real PostgREST/Auth behaviour, load checks | nothing but production |

## One-time setup

The Supabase CLI needs to authenticate to your account, and it needs the staging
database password. Neither is stored in the repo.

1. Authenticate the CLI (opens a browser, once per machine):

   ```bash
   ./node_modules/.bin/supabase login
   ```

2. Set a staging database password. It was generated at project-creation time and
   never displayed, so reset it:
   <https://supabase.com/dashboard/project/pvmabzjotcpvdpffsrgp/settings/database>
   → **Database password** → **Reset database password**.

3. Copy the env template and fill in the password plus the service-role key:

   ```bash
   cp .env.staging.example .env.staging
   ```

   `.env.staging` is gitignored; `.env.staging.example` is not.

4. Build the schema and seed it:

   ```bash
   export STAGING_SUPABASE_DB_PASSWORD='...'
   npm run staging:remote:setup
   ```

   That runs link → `db push` → seed → verify. `db push` replays
   `supabase/migrations/*.sql` **verbatim** and records each one in
   `supabase_migrations.schema_migrations`, so staging's schema history is
   auditable and future pushes are incremental.

## Day-to-day

```bash
npm run staging:remote:status   # what is configured, and is the password set
npm run staging:remote:push     # apply new migrations
npm run staging:remote:seed     # re-seed from supabase/seed.sql
npm run staging:remote:verify   # assert every local migration is applied
```

Point the API at staging by running it with `.env.staging` instead of
`apps/api/.env`. Remember that plain `npm run dev` reads `apps/api/.env`, which is
**production** — see `docs/LOCAL_DEV.md`.

## Rules

- **`scripts/remoteStaging.mjs` refuses to run against the production ref.** The
  production ref is hardcoded as a denylist entry; setting
  `STAGING_SUPABASE_PROJECT_REF` to it exits non-zero.
- **Production DDL never goes through `db push`.** It goes through the Supabase
  migration API (`apply_migration`), and it is applied *before* the branch merges
  to `main`, because `main` deploys immediately. See
  `docs/DB_GOVERNANCE_AND_PREFLIGHT.md`.
- **Staging holds no real alumni data.** The seed is synthetic. Do not copy
  production rows here; the member records are real people's contact details.
- **Staging cannot reach live providers.** `.env.staging.example` pins
  `EMAIL_MODE=mock` and `BILLING_MODE=mock` and leaves Resend/Stripe/OpenAI/Clerk/
  Cloudflare/R2/APNs keys empty, so a staging bug cannot email a member or charge
  a card.

## Schema drift: the 41 adopted tables

A parity check on 2026-09-04 found production carrying **88** public tables while
`supabase/migrations/` described only **47**. The other 41 -- the ops/CRM stack
(`clients`, `vendors`, `tasks`, `outreach_*`, `knowledge_*`, ...), the
email-marketing subsystem (`email_campaigns`, `email_segments`, `email_templates`,
...), and legacy leftovers (`pb_mongo_mirror`, `audit_logs`, `web_vital_events`) --
were created out of band. Their DDL was in no repo, so staging could not reproduce
them and no migration could safely touch them.

`20260904220000_adopt_untracked_production_tables.sql` closes that gap. It was
generated directly from the production catalog (`pg_get_constraintdef`,
`pg_get_indexdef`, `pg_get_functiondef`, `pg_get_triggerdef`) rather than written
by hand, and verified by applying it to a throwaway database:

- 41 tables, 119 constraints, 122 indexes, 33 triggers, 9 enum types -- each count
  matching production exactly
- an md5 over all 551 column signatures (name, type, nullability, default) is
  **identical** to production's
- applying it twice produces zero errors, so it is safe to replay

It creates structure only and carries no data. Because every statement is guarded,
applying it to production would be a no-op that merely records the existing shape --
worth doing so production's migration history matches the repo, but it has not been
done yet.

## The second gap: RLS, policies and RPC functions

Structure was only half the drift. Comparing production against a database built
purely from `supabase/migrations` showed access control had not come across:

|                    | production | from-repo |
|--------------------|-----------:|----------:|
| functions          |         24 |        20 |
| RLS policies       |        181 |        77 |
| RLS-enabled tables |         87 |        46 |

`20260904230000_adopt_untracked_rls_and_functions.sql` closes it: 41 `enable row
level security` (20 of them `force`), 104 policies, and 4 functions.

The functions are the serious half. `claim_due_mobile_notification_schedules`,
`list_admin_profiles`, `purge_pre_member_person` and `search_city_prefix` are RPCs
the API calls, created by six migrations that were applied to production but whose
files were never committed: `performance_correctness_hardening`,
`database_advisor_hardening`, `tier_search_privileges`, `notification_claim_safety`,
`admin_profile_pagination`, `atomic_pre_member_purge`. Until now a from-scratch
environment came up missing them.

Verified by replaying all 19 migrations into an empty database: zero errors, and
88 tables / 181 policies / 87 RLS tables / 82 triggers / 24 non-extension functions,
with a function-signature md5 identical to production.

Two cosmetic differences remain in a from-scratch build and are expected:

- `extensions.gen_random_uuid()` renders instead of `gen_random_uuid()` when
  pgcrypto sits ahead of `pg_catalog` in the search path.
- Physical column order differs where production gained a column through a later
  `ALTER TABLE` (`city_geo.country`/`population`) that a fresh build creates inline.

Neither affects behaviour. Compare schemas with an **order-insensitive** hash --
sort the column signatures, do not order by `attnum` -- or these will show as
false differences.

## Intended workflow for a schema change

1. Write the migration file in `supabase/migrations/`.
2. `npm run staging:remote:push` — rehearse it against real Supabase.
3. Exercise the affected endpoints against staging.
4. Apply the same file to production via the Supabase migration API.
5. Merge to `main`.
