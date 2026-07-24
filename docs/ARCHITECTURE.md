# PondBridge Architecture

Last reviewed: 2026-07-14

## Runtime overview

PondBridge is a multi-tenant camp-community platform in one npm monorepo:

```text
pondbridge-platform/
├── apps/
│   ├── api/       # Node.js + Express API
│   ├── web/       # React + Vite web application
│   └── ios/       # Capacitor wrapper
├── packages/
│   ├── shared/    # schemas, plan features, shared domain rules
│   └── ui/        # shared UI primitives and theme tokens
└── docs/
```

The API persists native relational tables in Supabase PostgreSQL. MongoDB and
the historical `pb_mongo_mirror` document table are not the current runtime
architecture.

Primary integrations are Clerk or legacy/hybrid authentication, Stripe billing,
Resend transactional email and webhooks, Cloudflare R2 media storage, and
optional Cloudflare domain provisioning.

## Tenant boundary

Tenant context is resolved in this order:

1. `/api/t/:slug/*` path slug.
2. `X-Tenant-Slug` header for controlled local/testing use.
3. Subdomain or normalized custom-domain mapping.
4. Authenticated membership fallback for `/api/tenants/me/*`.

Tenant middleware attaches the resolved tenant and denies a non-global identity
whose membership does not match it. Data access must also include `tenant_id`,
and RLS policies provide a second boundary in PostgreSQL. Server module guards
enforce disabled features even when a caller bypasses navigation.

The current user schema still permits only one active camp membership per
identity. The backward-compatible multi-membership migration is specified in
`docs/adr/0001-multi-camp-identity-memberships.md` and must be rehearsed before
production use.

## Core records

- `tenants`: branding, content, access policy, modules, launch state, billing,
  custom domain, and onboarding draft.
- `users`: tenant membership, identity-provider ID, email, roles, and status.
- `profiles`: tenant-scoped member profile and per-field contact privacy.
- `invites` and `access_requests`: invite-first and approval-based onboarding.
- Community records: conversations, messages, forums, photos, family trees,
  newsletters, events, and RSVPs.
- Operational records: analytics events, import reports, audit logs, Resend and
  Stripe webhook events, email broadcasts, suppressions, and notification data.

## Authentication and authorization

- Tenant roles: `user` and `tenant_admin`.
- Global console roles: `support_admin`, `finance_admin`, and `super_admin`.
- Global mutations require an unscoped `super_admin` membership.
- `AUTH_PROVIDER` supports the configured legacy, Clerk, or hybrid transition.
- Browser sessions can use bearer, HTTP-only cookie, or hybrid token mode.
- Consequential admin changes are server-authorized and audit logged.

## Director launch contract

The conversation-led launch workspace at `/t/:slug/onboarding` is the canonical
director flow. It renders a deterministic live plan from the server readiness
contract and links to existing action screens. The former dense Command Center
is preserved at `/t/:slug/onboarding/details`. Branding, content, access policy,
modules, billing, legal acceptance, and launch state are saved server-side. The
API owns readiness evaluation; the conversation cannot bypass it. A launch
override is limited to an explicit, audited global super-admin action.

Member CSV activation is retired. Directors preview a recipient CSV, review
invalid/duplicate/existing rows, and explicitly send invitations. Invitees create
their own accounts.

## Integration truth rules

- Stripe webhooks are authoritative for subscription lifecycle state.
- Resend webhooks are authoritative for delivery, bounce, and complaint health.
- Scheduled email is accepted only when provider-backed scheduling is available.
- R2 stores media; the database stores object metadata and URLs.
- Unsupported global jobs, retries, lifecycle automation, and feature-flag
  controls return `OPERATION_NOT_AVAILABLE` instead of simulating success.

## Safety and recovery

- API errors and audit metadata carry request IDs.
- Webhook signatures and idempotency records protect provider updates.
- Hard tenant deletion is disabled by default and requires explicit switches,
  a tenant request, a waiting period, and typed confirmation.
- Database schema/RLS preflight is documented in
  `docs/DB_GOVERNANCE_AND_PREFLIGHT.md`.
- Git-history remediation for historical member exports is documented in
  `docs/SECURITY_GIT_HISTORY_REMEDIATION.md`.
