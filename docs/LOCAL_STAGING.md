# PondBridge Local Staging

## Purpose

This is the zero-cost, isolated rehearsal environment for PondBridge. It runs a
complete Supabase stack in the dedicated `pondbridge` Colima profile on the Mac
and never links to either hosted Supabase project.

The environment contains only synthetic records:

- Target camp: `cedar` (`tenant_local_cedar`)
- Control camp: `pine-control` (`tenant_local_control`)
- Fresh onboarding rehearsal: `fresh-camp` (`tenant_local_fresh`)

## First run

Install Node.js 22, the Docker CLI, and Colima once. From the repository root:

```bash
npm ci
npm run staging:local:reset
```

The reset command automatically starts the isolated Colima profile, starts the
local Supabase services, rebuilds the database
from all migrations, loads the synthetic seed, and runs the security and
tenant-isolation verification suite.

Before invoking the Supabase CLI, the launcher materializes `config.toml`, the
seed, and every migration under `~/.cache/pondbridge-local-staging`. This keeps
database resets independent of Desktop/iCloud placeholder and symlink behavior.

## Daily workflow

Start Supabase and both PondBridge applications with safe local overrides:

```bash
npm run staging:local:dev
```

Other commands:

```bash
npm run staging:local:start
npm run staging:local:status
npm run staging:local:verify
npm run staging:local:rehearse
npm run staging:local:test
npm run staging:local:reset
npm run staging:local:stop
```

`staging:local:rehearse` executes the complete synthetic camp lifecycle: super
admin provisioning, director claim, onboarding configuration, reviewed mock
invitations, launch blocking and override, sample-member registration,
cross-tenant isolation, and the Camp Search AI target/control/kill-switch
sequence. It then restores the canonical three-camp seed and reruns every local
database safety check.

`staging:local:test` runs the complete API suite, including destructive
database-backed isolation, auth, billing, provisioning, and tenancy tests. It
is hard-wired to the local database, supplies the required wipe
acknowledgements only to the test process, and restores/verifies the canonical
seed afterward. Jest arguments can be passed through for a focused database
run, for example `npm run staging:local:test -- --runTestsByPath
tests/onboardingLaunchGate.test.js`.

`staging:local:reset` destroys only the local staging database. None of these
commands authenticate to, link to, push to, or reset a hosted project.

## Local URLs

- Cedar tenant: [http://127.0.0.1:5174/t/cedar](http://127.0.0.1:5174/t/cedar)
- Control tenant: [http://127.0.0.1:5174/t/pine-control](http://127.0.0.1:5174/t/pine-control)
- Fresh-camp onboarding: [http://127.0.0.1:5174/t/fresh-camp](http://127.0.0.1:5174/t/fresh-camp)
- Super admin: [http://127.0.0.1:5174/super/login](http://127.0.0.1:5174/super/login)
- Supabase Studio: [http://127.0.0.1:54323](http://127.0.0.1:54323)
- Supabase local email inbox: [http://127.0.0.1:54324](http://127.0.0.1:54324)
- API health: [http://127.0.0.1:4000/health](http://127.0.0.1:4000/health)

## Synthetic logins

| Role | Email | Password |
| --- | --- | --- |
| Super admin | `superadmin@pondbridge.example.test` | `SuperAdmin123!` |
| Cedar director | `director@cedar.example.test` | `Pondbridge123!` |
| Cedar member | `alex.rivera@cedar.example.test` | `Pondbridge123!` |
| Cedar member | `sam.chen@cedar.example.test` | `Pondbridge123!` |
| Control director | `director@pine-control.example.test` | `Pondbridge123!` |
| Control member | `member@pine-control.example.test` | `Pondbridge123!` |
| Fresh-camp director | `director@fresh-camp.example.test` | `Pondbridge123!` |

The reserved `example.test` domain cannot deliver real mail.

## Safety contract

`scripts/localStaging.mjs` launches the API and web app with an isolated
environment. Local staging does not load repository or app `.env` files and
does not inherit provider credentials or authorization allowlists from the
host shell:

- Email mode is `mock`; Resend and SMTP credentials are empty.
- APNS and FCM credentials are empty; tenant and member push preferences are
  disabled and no device token is seeded.
- OpenAI credentials are empty, AI budgets are zero, and all durable AI
  rollout records are disabled with their kill switches on.
- Billing mode is `mock`; Stripe credentials and price IDs are empty.
- Cloudflare, R2, and custom-domain credentials are empty.
- The web application uses only the local API and local Supabase URLs,
  including its native/mobile fallback URL; host `.env` Supabase values are
  explicitly overridden.
- Browser sessions exercise the production tab-close login policy so auth and
  onboarding hydration races are visible during local QA.
- The container network binds published services to `127.0.0.1`.

## Database workflow

The canonical migration sequence lives in `supabase/migrations/`:

1. Native relational baseline
2. Platform audit telemetry
3. Tenant rollout controls
4. Communications and AI usage ledger
5. Multi-camp identity foundation
6. Member safety
7. Foreign-key performance indexes
8. Database function and grant hardening

Future changes must be created with the pinned CLI and verified from a clean
reset:

```bash
npx supabase migration new descriptive_change_name
npm run staging:local:reset
```

Never run `supabase link`, `supabase db push`, or `supabase db reset --linked`
as part of the local staging workflow.

## Verification contract

`npm run staging:local:verify` requires all of the following:

- All eight migrations appear in authoritative migration history.
- Every PondBridge table exists with RLS enabled and forced.
- `anon` and `authenticated` have no direct table CRUD privileges.
- `service_role` has explicit CRUD privileges and RLS policies.
- Public functions are invoker-safe and pin `search_path`.
- Cedar, the control camp, and the fresh-camp tenant contain only synthetic
  data.
- The synthetic global administrator remains active with its `super_admin`
  role intact.
- Every rollout is disabled with the kill switch on.
- Cross-tenant profile writes and duplicate active identities are rejected.
- Member-facing synthetic IDs use the same 24-character shape required by
  production messaging, forum, profile, and event routes.
- Multi-camp target, control, and kill-switch behavior is transactionally
  probed and rolled back without changing the seed.
- Service-role Data API reads succeed and anonymous reads fail.
- No push token or real email address is present.

## When remote staging becomes necessary

Move the same migration and seed workflow to a paid, isolated Supabase staging
environment before testing real provider webhooks, mobile push delivery,
custom domains, or director acceptance outside the local machine. Keep the
remote seed synthetic and do not copy production alumni data.
