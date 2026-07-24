# PondBridge Deployment Guide

Last reviewed: 2026-07-17

For the launch checklist and rollback expectations, also see
`docs/PROD_LAUNCH.md`.

## Target services

- Web: static React/Vite deployment with SPA rewrites.
- API: Node.js service with `GET /health` checks.
- Database: Supabase PostgreSQL native relational tables and RLS.
- Identity: configured Clerk or legacy/hybrid transition mode.
- Email: Resend with signed webhooks in production.
- Billing: Stripe with signed webhooks in production.
- Media: Cloudflare R2.
- Domains: wildcard base domain plus optional Cloudflare provisioning.

## Required API configuration

Copy `apps/api/.env.example` and configure at minimum:

```env
NODE_ENV=production
PORT=4000
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_DB_URL=postgresql://...
JWT_SECRET=...
FRONTEND_ORIGIN=https://app.pondbridgealumni.com
FRONTEND_ORIGINS=https://app.pondbridgealumni.com
APP_BASE_DOMAIN=pondbridgealumni.com
TENANT_HOST_SUFFIXES=pondbridgealumni.com
AUTH_TOKEN_MODE=hybrid
AUTH_COOKIE_DOMAIN=.pondbridgealumni.com
AUTH_COOKIE_SECURE=true
PUBLIC_API_ORIGIN=https://api.pondbridgealumni.com
EMAIL_PREFERENCE_TOKEN_SECRET=use-a-dedicated-long-random-secret
```

Configure Clerk, Stripe, Resend, R2, and Cloudflare values from the example only
for integrations being enabled. `BILLING_MODE=mock` and `EMAIL_MODE=mock` must not
be treated as production delivery.

Keep destructive switches off by default:

```env
SUPER_TENANT_HARD_DELETE_ENABLED=false
SUPER_TENANT_PRODUCTION_WIPE_ENABLED=false
SUPER_TENANT_DEMO_RESET_ENABLED=false
SUPER_TENANT_DELETION_GRACE_HOURS=24
ALLOW_MOCK_BILLING_IN_PRODUCTION=false
```

## Database preflight and schema

Use a staging database first:

```bash
npm --workspace @pondbridge/api run db:preflight
npm --workspace @pondbridge/api run domains:audit
npm --workspace @pondbridge/api run supabase:apply-schema
npm --workspace @pondbridge/api run rls:audit
```

For the super-admin telemetry gate, apply and verify the narrow additive audit
migration before enabling the Operations Agent:

```bash
export PONDBRIDGE_TARGET_ENV=staging
export PONDBRIDGE_SCHEMA_APPLY_ACK=apply-platform-audit-staging
npm --workspace @pondbridge/api run supabase:apply-platform-audit
export PONDBRIDGE_SCHEMA_APPLY_ACK=apply-rollout-control-staging
npm --workspace @pondbridge/api run supabase:apply-rollout-control
npm --workspace @pondbridge/api run db:preflight -- --json
```

Use `PONDBRIDGE_SCHEMA_APPLY_ACK=apply-rollout-control-staging` for the rollout
control command. Apply and verify the audit migration first so every rollout
change can fail closed when its platform audit record cannot be written.

Before enabling `director_email_agent_v1`, deploying the marketing-email
readiness gate, or allowing directors to store pre-member alumni, apply the
additive communications schema in staging. This adds the service-only AI usage
ledger, recipient preference records, tenant-scoped alumni contacts, exact
usage aggregation, and additive broadcast metadata:

```bash
export PONDBRIDGE_TARGET_ENV=staging
export PONDBRIDGE_SCHEMA_APPLY_ACK=apply-communications-system-staging
npm --workspace @pondbridge/api run supabase:apply-communications-system
npm --workspace @pondbridge/api run db:preflight -- --json
```

Configure `PUBLIC_API_ORIGIN`, a dedicated
`EMAIL_PREFERENCE_TOKEN_SECRET`, `OPENAI_API_KEY`, the approved email-agent
model, and a tenant-safe monthly budget before a pilot. Deploy the schema before
the API because marketing recipient previews fail closed when recipient
preference storage is unavailable. Alumni Growth remains read-only when its
contact table is absent and states that storage setup is required.

Camp Search AI and Profile PDF Import use the same service-only generation
ledger and approved pricing schedule. Before enabling `camp_ai_search_v1` or
provider-backed LinkedIn/resume extraction, configure:

```env
OPENAI_SEARCH_MODEL=gpt-5.6-luna
OPENAI_SEARCH_MAX_OUTPUT_TOKENS=500
OPENAI_SEARCH_TIMEOUT_MS=20000
AI_SEARCH_MONTHLY_BUDGET_USD=15
OPENAI_PROFILE_IMPORT_MODEL=gpt-5.6-luna
OPENAI_PROFILE_IMPORT_MAX_OUTPUT_TOKENS=1600
OPENAI_PROFILE_IMPORT_TIMEOUT_MS=30000
PROFILE_IMPORT_MONTHLY_BUDGET_USD=15
```

Keep `camp_ai_search_v1` killed or disabled until the communications and rollout
schemas both pass preflight. Profile PDF Import safely degrades to local parsing
when provider metering is unavailable; do not describe a local fallback result
as AI-generated.

The multi-camp identity foundation is also an additive, staging-first migration.
Apply the schema, inspect the default dry-run backfill report, and only then
authorize the idempotent write pass:

```bash
export PONDBRIDGE_TARGET_ENV=staging
export PONDBRIDGE_SCHEMA_APPLY_ACK=apply-multi-camp-identity-staging
npm --workspace @pondbridge/api run supabase:apply-multi-camp-identity
npm --workspace @pondbridge/api run identity:backfill
export PONDBRIDGE_MULTI_CAMP_BACKFILL_ACK=apply-multi-camp-backfill-staging
npm --workspace @pondbridge/api run identity:backfill -- --apply
```

Stop if the dry run reports identity collisions or duplicate memberships. New
membership creation dual-writes the additive identity tables when they are
available. Target camps switch HTTP and socket authorization to membership
reads only through `multi_camp_identity_v1`; control camps continue using the
legacy user contract. Keep the flag killed until the backfill and same-person /
two-camp role, revocation, profile isolation, socket isolation, and one-camp
deletion rehearsals all pass.

Member blocking, content reporting, and the director moderation queue require
their own additive safety schema. Apply it independently before exposing those
controls to a target camp:

```bash
export PONDBRIDGE_TARGET_ENV=staging
export PONDBRIDGE_SCHEMA_APPLY_ACK=apply-member-safety-staging
npm --workspace @pondbridge/api run supabase:apply-member-safety
npm --workspace @pondbridge/api run db:preflight -- --json
```

The installer verifies both tables, tenant-consistency triggers, required
indexes, service-role-only policies, and forced RLS. The preflight report now
includes an ordered `migrationPlan` so a missing gated table cannot be mistaken
for an application failure.

After the feature schemas are installed, add the missing foreign-key indexes,
then pin function resolution and remove browser-role execution from server-only
RPC and trigger helpers:

```bash
export PONDBRIDGE_TARGET_ENV=staging
export PONDBRIDGE_SCHEMA_APPLY_ACK=apply-database-performance-hardening-staging
npm --workspace @pondbridge/api run supabase:apply-database-performance-hardening
export PONDBRIDGE_SCHEMA_APPLY_ACK=apply-database-security-hardening-staging
npm --workspace @pondbridge/api run supabase:apply-database-security-hardening
npm --workspace @pondbridge/api run db:preflight -- --json
```

The preflight must report no missing indexes and `functionSecurity.ok=true`.
These steps address the PondBridge foreign-key and function-search-path advisor
findings without changing objects owned by other applications in a shared
project.

PondBridge does not call Supabase directly from the browser. Every SQL-created
table must explicitly grant CRUD to `service_role` and revoke table privileges
from `anon` and `authenticated`; RLS remains forced as defense in depth. This is
required for projects using Supabase's 2026 Data API exposure defaults.

For signed staging-device push delivery, configure the API runtime with an
Apple Push Notification service key and a Firebase service account authorized
for the FCM HTTP v1 API:

```env
APNS_KEY_ID=
APNS_TEAM_ID=
APNS_BUNDLE_ID=com.pondbridge.ios
APNS_PRIVATE_KEY=
APNS_USE_SANDBOX=true
FCM_PROJECT_ID=
FCM_CLIENT_EMAIL=
FCM_PRIVATE_KEY=
FCM_ANDROID_APP_ID=com.pondbridge.android
```

Keep `APNS_USE_SANDBOX=true` for locally signed development builds. TestFlight
and App Store builds use the production APNs environment. Put the Firebase
client `google-services.json` in `apps/ios/android/app/` only through the release
secret workflow; it is intentionally ignored by Git. The FCM service-account
private key belongs only in the API secret store. Never put APNs or FCM server
credentials in a `VITE_` variable or either mobile bundle.

The narrow migration rejects production and unlabeled remote targets. The full
schema command remains reserved for a separately reviewed, backed-up migration
window.

Run the full fresh-camp onboarding rehearsal only against local or explicitly
reviewed staging data. The rehearsal forces mock email, exercises signed invite
preview/send, verifies launch blocking and override behavior, and never prints
generated passwords:

```bash
export PONDBRIDGE_TARGET_ENV=staging
export PONDBRIDGE_FRESH_CAMP_REHEARSAL_ACK=run-fresh-camp-rehearsal-staging
npm --workspace @pondbridge/api run dev:provision-test-camp
```

`domains:audit` exits non-zero when normalized custom domains conflict. Resolve
those assignments before applying the unique index. Do not use reset or seed
commands against production.

Before a production schema change, record a backup/PITR checkpoint, confirm the
rollback plan, and rehearse the change against a recent sanitized staging copy.

## Deploy order

1. Run tests, lint, build, schema/RLS preflight, and tracked-secret checks.
2. Apply backward-compatible database changes.
3. Deploy the API and verify `/health`, request IDs, auth, and provider webhook
   endpoints.
4. Deploy the web app and verify SPA rewrites.
5. Validate base, wildcard, custom-domain, and `/t/:slug` routing.
6. Run one target-camp director flow and one control-camp regression flow.
7. Enable new behavior only for the approved camp cohort.

## DNS and CORS

- `api.pondbridgealumni.com` points to the API host.
- `app.pondbridgealumni.com` and `*.pondbridgealumni.com` point to the web host.
- Custom domains must be normalized, unique, provisioned, and added to the
  production CORS allowlist/resolver.
- Run `domains:audit` before domain-related schema changes.

## Provider validation

- Stripe: signed test webhook, checkout, portal, renewal state, and cancellation
  state are reflected through webhook-confirmed data.
- Resend: signed sent/delivered/bounced/complained events appear in operational
  telemetry without exposing full recipient addresses. Also validate inbox
  preheader, physical address, preference page, one-click unsubscribe,
  resubscribe, suppression/preference counts, test send, schedule, and cancel.
- OpenAI Communications Agent: a synthetic staging brief creates an editable
  draft, writes model/token/cost metadata without raw copy, respects the monthly
  budget and rollout kill switch, and never sends or schedules.
- R2: presigned upload, public retrieval, content type, size limit, and tenant
  object cleanup are verified.
- Clerk: authorized parties, tenant claim/membership behavior, logout, and
  invitation/approval paths are verified.
