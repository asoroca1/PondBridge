# PondBridge Production Launch Guide

Last reviewed: 2026-07-21

## Launch architecture

- Web: Vite SPA on the selected static host.
- API: Node.js/Express on Render, Fly, or an equivalent service.
- Database: Supabase PostgreSQL native tables with RLS.
- Tenant URLs:
  - `https://{tenant-slug}.pondbridgealumni.com`
  - temporary fallback `https://app.pondbridgealumni.com/t/{tenant-slug}`
- Optional unique custom domains are database constrained and must pass the
  domain preflight.

MongoDB Atlas and the historical `pb_mongo_mirror` table are not part of the
current production runtime.

## Production gates

Do not broaden a camp cohort until all of these are evidenced:

1. Web build, safe API tests, lint, and `git diff --check` pass on Node 22.12+.
2. `npm --workspace @pondbridge/api run copilot:eval` passes. If either
   assistant will be enabled, the guarded staging evaluation and every
   promotion criterion in `docs/COPILOT_EVALUATION_RUNBOOK.md` also pass.
3. `db:preflight`, `domains:audit`, schema application, and `rls:audit` pass in
   staging.
4. Backup/PITR status and a restore rehearsal are recorded.
5. API `/health`, logs, request IDs, and alerts are visible.
6. Clerk/legacy auth mode, cookies, CORS, and tenant scope work on base,
   subdomain, custom-domain, and fallback path routes.
7. Stripe and Resend signed webhooks are verified with staging provider events.
8. R2 upload and retrieval work from an allowed tenant origin.
9. A new director completes the guided launch workspace, recipient preview, invitation,
   billing, legal, and server-gated launch flow.
10. A normal member can join only through the camp's configured server-enforced
   access policy.
11. Control camps retain their prior behavior.
12. Director marketing email proves preference-aware preview, postal-address
    enforcement, manage-preferences, one-click unsubscribe, resubscribe, signed
    provider webhooks, and sensitive-token log redaction.
13. If the Communications Agent is enabled, its durable generation ledger,
    approved price version, tenant budget, provider staging run, draft-only
    approval boundary, and rollout kill switch are verified for one target camp.
14. If Camp Search AI is enabled, the target/control/kill-switch rehearsal proves
    that no profile records leave PondBridge, blocked members remain excluded,
    usage is camp-metered, and provider failure is labelled guided fallback.
15. LinkedIn/resume PDF import proves real-PDF/page validation, no file or raw
    text retention, protected account email, selective field review, discard,
    and explicit profile save on desktop and mobile.
16. If multi-camp identity reads are enabled, dual-write/backfill counts match,
    one identity can use two target camps with independent roles and profiles,
    inactive membership and cross-camp socket access fail closed, deleting one
    membership preserves the other, and the kill switch restores legacy reads.
17. Member block/report storage passes its dedicated schema verification and
    same/cross-tenant moderation tests.
18. Supabase preflight reports pinned function search paths, no public
    `SECURITY DEFINER` PondBridge functions, and no browser execution privilege
    on server-only RPCs; Supabase security and performance advisors have been
    reviewed after the final staging migration, with every PondBridge
    foreign-key index warning resolved or explicitly accepted.
19. Supabase migration history contains the reviewed additive migrations in the
    same order rehearsed in staging; production is not the first environment to
    record or execute them.
20. Before promoting a native release, iOS and Android each pass a signed
    physical-device rehearsal for login, camp switching, resume/reconnect, deep
    links, APNs/FCM foreground/background/tap delivery, notification preferences,
    safe areas/rotation, and VoiceOver/TalkBack. Android additionally requires
    Play signing, hosted `assetlinks.json`, a completed data-safety declaration,
    and an internal Play test-track pass.

## Authentication and cookies

Production browser auth should use secure cookies or the configured hybrid mode:

```env
AUTH_TOKEN_MODE=hybrid
AUTH_COOKIE_NAME=pondbridge_auth
AUTH_COOKIE_DOMAIN=.pondbridgealumni.com
AUTH_COOKIE_SAMESITE=lax
AUTH_COOKIE_SECURE=true
```

Configure exact frontend origins and authorized Clerk parties. Header-based
tenant selection is for controlled local/testing use, not a public trust signal.

## DNS

1. Point `api.pondbridgealumni.com` to the API provider.
2. Point `app.pondbridgealumni.com` and `*.pondbridgealumni.com` to the web app.
3. Verify managed TLS for API, app, wildcard, and each approved custom domain.
4. Keep `/t/:slug` fallback routing while subdomain/custom-domain coverage is
   validated.

For local wildcard testing, use `lvh.me` with explicit origins such as
`http://app.lvh.me:5173` and `http://cedar.lvh.me:5173`.

## Rollout and rollback

- Roll out by immutable tenant ID and server-owned settings, never camp-name or
  hostname substring.
- Cedar remains a control camp unless explicitly included.
- Keep every new behavior independently reversible.
- Do not apply destructive schema changes in the same release that begins a camp
  rollout.
- Preserve provider drafts and scheduled-message IDs when disabling assisted
  workflows.
- If tenant-scope errors, auth failures, provider failures, or launch blockers
  regress, disable the target feature/cohort and return to the last compatible API
  and web deployment before attempting data repair.

The detailed remediation state is tracked in
`docs/FALL_ROLLOUT_REMEDIATION_TRACKER.md`.
