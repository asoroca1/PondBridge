# Production Release — 2026-07-24

## Release identity

- GitHub PR: `#1` — Prepare PondBridge fall rollout overhaul
- Merge commit: `1b35885528b63bf6ae95029a2a75a6a50235ce0d`
- Cloudflare Pages deployment:
  `a64c4c10-c8c1-4cc5-8114-025fc6ed20c9`
- Render API deployment: `dep-d9hcs4cs728c73buj430`
- Supabase project: `wkyjhmggkujsepafbplv` (`us-west-2`)

## Rollback checkpoint

- Encrypted logical backup:
  `~/PondBridge-Backups/20260724T021950Z/pondbridge-production-20260724T021950Z.dump.enc`
- Schema-only checkpoint:
  `~/PondBridge-Backups/20260724T021950Z/public-schema-before-rollout-20260724T021950Z.sql`
- Encryption key: macOS Keychain service
  `PondBridge Production Backup 20260724T021950Z`
- Encrypted dump SHA-256:
  `1884d0fabd9c660e1c7f34746c48472e7f051cdd8b8f05270145ff0685da8a35`
- Schema checkpoint SHA-256:
  `958fa5927466dbd4eab03e3e6aa93ce487d2448473a8d7c3c725ef8f76a129c2`
- Decrypt plus `pg_restore` catalog verification passed with 364 entries.

## Database evidence

- Eight local and remote migration versions match.
- Database preflight reports no migration plan, missing tables, or missing
  indexes.
- All 36 PondBridge tables have RLS and at least one policy.
- PondBridge function search paths and server-only execution privileges pass.
- PondBridge table privileges are service-role-only.
- All 11 camp domains pass the uniqueness audit.
- `feature_rollouts`, `ai_generations`, `identities`, and
  `tenant_memberships` contain zero rows at release time.

## Runtime evidence

- No invitation, campaign, transactional, or provider test email was sent
  during this release. Cedar email delivery was not exercised.
- Render started the new API against the intended database and found 11
  tenants.
- No API warning/error logs were emitted after the new instance started.
- `/health` returns `200` with Resend and R2 configured.
- Cedar tenant configuration resolves on both
  `cedar.pondbridgealumni.com` and the `app.pondbridgealumni.com/t/cedar`
  fallback.
- Production CORS accepts Cedar, the app host, and the reviewed preview host;
  an unrelated origin receives no allow-origin header.
- Cedar landing/login and the super-admin login render in the browser without
  a visible API/network failure or horizontal page overflow.

## Deliberately still gated

- Production email tests must not use Cedar alumni recipients. Any future test
  send requires an owner-confirmed PondBridge test address.
- No camp AI, agent, or multi-camp identity cohort is enabled.
- `SUPER_COPILOT_ENABLED=false`.
- Mock production billing and destructive tenant switches are disabled.
- Identity backfill remains unrun.
- APNs credentials and signed physical-device validation remain incomplete.
- Hosted provider rehearsals, a fresh-camp production-shaped onboarding run,
  and VoiceOver/NVDA testing remain required before widening any tenant cohort.
