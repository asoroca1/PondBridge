# PondBridge / Camp Alumni Network Software Teardown

Date: February 27, 2026
Repository: `pondbridge-platform`
Authoring mode: principal full-stack engineer + security engineer + product director + UI/UX reviewer + end-user simulation

## Audit Method (What was actually verified)
- Source scan across frontend, API, schema, middleware, and tests.
- Route and flow mapping from:
  - `apps/web/src/main.jsx`
  - `apps/web/src/App.jsx`
  - `apps/api/src/app.js`
  - `apps/api/src/routes/*`
- Tenant and auth boundary review from:
  - `apps/api/src/utils/tenantResolution.js`
  - `apps/api/src/middleware/tenantContext.js`
  - `apps/api/src/middleware/enforceTenantScope.js`
  - `apps/api/src/middleware/requireAuth.js`
  - `apps/api/src/middleware/requireRole.js`
- DB and RLS review from:
  - `apps/api/scripts/native_schema.sql`
  - `npm --workspace @pondbridge/api run rls:audit`
- Current reliability signal from lint/build/tests:
  - web lint: pass
  - web build: pass (with bundle size warnings)
  - API tests: partially green only when DB-reset guard override is provided; currently 4 suites still failing.

---

## Step 1: Repo Map
### High-level structure
```text
pondbridge-platform/
  apps/
    web/           # React + Vite frontend
    api/           # Express API + Supabase data access
  packages/
    shared/        # Shared constants/helpers/features
    ui/            # Shared UI components/theme
  docs/
  scripts/
  PLAN.md
  README.md
```

### Key entry points
- Frontend boot:
  - `apps/web/src/main.jsx`
- Frontend router and app shell:
  - `apps/web/src/App.jsx`
- Frontend auth providers:
  - `apps/web/src/context/AuthContext.jsx`
- Frontend tenant provider:
  - `apps/web/src/context/TenantContext.jsx`
- API boot/middleware/router mounting:
  - `apps/api/src/app.js`
- API auth middleware:
  - `apps/api/src/middleware/requireAuth.js`
- Tenant resolution/scope enforcement:
  - `apps/api/src/utils/tenantResolution.js`
  - `apps/api/src/middleware/tenantContext.js`
  - `apps/api/src/middleware/enforceTenantScope.js`
- DB schema source of truth:
  - `apps/api/scripts/native_schema.sql`

---

## Step 2: Primary Routes/Flows and State Storage
### Primary frontend surfaces
- Tenant-scoped app routes in `apps/web/src/App.jsx`:
  - Public/auth: `/t/:slug/login`, `/t/:slug/create-account`, `/t/:slug/director-claim`, `/t/:slug/director-create-account`
  - Member: `/t/:slug/home`, `/t/:slug/my-profile`, `/t/:slug/search`, `/t/:slug/profile/:id`
  - Community: `/t/:slug/photo-stream`, `/t/:slug/chat-rooms`, `/t/:slug/family-trees`
  - Admin: `/t/:slug/admin/*`
  - Director onboarding command center: `/t/:slug/onboarding`
- Super admin routes:
  - `/super/login`, `/super/dashboard`, `/super/tenants`, `/super/billing/tenants`, `/super/email/transactional`

### Primary API surfaces
- Health and webhooks:
  - `/health`
  - `/api/webhooks/stripe`
  - `/api/webhooks/resend`
- Tenant auth/access:
  - `/api/t/:slug/auth/*`
  - `/api/t/:slug/access/*`
- Tenant data:
  - `/api/t/:slug/profiles/*`, `/api/t/:slug/search/*`
  - `/api/t/:slug/admin/*`
  - `/api/tenants/me/*` (onboarding, billing, launch, import)
- Super console:
  - `/api/super/*`

### State storage currently used
- Local storage (sensitive):
  - Auth token and user object are still persisted in localStorage in `apps/web/src/lib/storage.js`.
- Cookies:
  - Cookie auth is supported server-side and CSRF middleware is present for cookie-authenticated mutating requests.
- Session storage:
  - Tab-scoped login intent/session markers in `apps/web/src/context/AuthContext.jsx`.

---

## Step 3: Multi-tenancy Enforcement Review
### Where tenant is resolved
- Slug/domain/header resolution:
  - `apps/api/src/utils/tenantResolution.js`
- Enforcement hook:
  - `apps/api/src/middleware/tenantContext.js`

### Where tenant scope is enforced
- Auth + scope chain:
  - `requireTenantAuthScope` in `apps/api/src/middleware/tenantAccess.js`
  - `enforceTenantScope` in `apps/api/src/middleware/enforceTenantScope.js`
- `/api/tenants/me/*` routes use:
  - `router.use('/me', ...requireTenantAuthScope)` in `apps/api/src/routes/tenants.js`

### Current risk conclusion
- The core guard pattern is good and most tenancy tests pass in clean runs.
- But cross-surface consistency is not fully stable:
  - `api/tenants/me` calls return `404 TENANT_NOT_FOUND` when tenant context is not passed from non-browser clients/tests.
  - This causes launch and billing test regressions even when business logic is correct.
- Conclusion: tenant isolation controls are mostly in place, but API contract consistency (especially tenant context expectation) still needs hardening.

---

## Step 4: Roles and Permissions Review
### Role storage and normalization
- Roles are stored on users table (`roles text[]`) and normalized in:
  - `apps/api/src/middleware/requireAuth.js`
- Frontend route gating by role:
  - `apps/web/src/components/ProtectedRoute.jsx`

### Server-side enforcement
- Generic role middleware:
  - `apps/api/src/middleware/requireRole.js`
- Super allowlist policy:
  - enforced in role middleware and identity services
- Tenant admin resolution and scope checks:
  - `resolveTenantForAdmin` in `apps/api/src/routes/tenants.js`

### Current risk conclusion
- Backend role gates are generally stronger than frontend gates (correct direction).
- There is still policy/contract drift between legacy endpoints and new `/api/tenants/me/*` endpoints.
- Super and tenant role boundaries are mostly effective in current tests, but unresolved failing suites show route-contract mismatch and missing schema in test environments.

---

# 1) Executive Summary

## What is working well
- Route architecture separates tenant, admin, super, and public surfaces clearly.
- Tenant-scoped middleware exists and is used on critical paths.
- Security baseline includes helmet, CORS controls, auth throttling, CSRF middleware, and webhook raw-body handling.
- Billing domain model has moved toward canonical lifecycle states and event-driven updates.
- Director onboarding UX materially improved (draft restore, launch celebration, live preview, command-center launch guide).
- Super admin area is substantial and operationally useful (tenants, billing, analytics, email tooling).

## Biggest current risks
- Security:
  - Auth token still persisted in localStorage (`apps/web/src/lib/storage.js`) creating XSS token theft exposure.
  - Runtime DB appears out of sync with intended RLS baseline (`rls:audit` currently shows 21 tables missing RLS).
- Data integrity:
  - Schema/runtime drift is real (`stripe_webhook_events` missing in active test DB despite schema file defining it).
- Auth + multi-tenancy:
  - `/api/tenants/me/*` requires tenant context not consistently supplied by tests/clients; this produces 404s that mask true behavior.
- Billing:
  - Stripe webhook pipeline is richer but environment/schema mismatch prevents reliable confidence in idempotency coverage right now.

## Biggest UX friction points
- Sign-up and auth trust:
  - Mixed legacy/clerk paths increase edge-case confusion and recovery complexity.
- Onboarding:
  - Good progress, but there is still duplicate guidance in command center and incomplete color-tool implementation (palette strip gap).
- Search/profile:
  - Functional, but loading/empty-state and trust cues still vary between pages.
- Admin tools:
  - CSV import behavior is currently inconsistent between old and new endpoints; users can hit deprecated behavior unexpectedly.

## Biggest architectural bottlenecks
- Tenant context contract is split across path/host/header and not uniformly abstracted at transport edge.
- DB migration/application discipline is too loose: schema in repo does not match active environments.
- RLS intent is strong in SQL source but not enforced in the current connected runtime DB.
- API surface has legacy + new routes with overlap; this causes drift and test fragility.
- Observability still relies heavily on console logs; no robust tracing/error-correlation pipeline.

## Top 10 prioritized fixes
1. **P0** Remove localStorage bearer token persistence and move to cookie-only session mode.
2. **P0** Apply schema to all active DBs and verify `stripe_webhook_events` exists everywhere.
3. **P0** Enforce RLS baseline in active Supabase DB; fail deployment when `rls:audit` reports missing tables.
4. **P0** Normalize `/api/tenants/me/*` tenant context contract (header/path/host fallback) and fix related 404s.
5. **P1** Stabilize billing and launch tests by aligning test harness with current `/api/tenants/me` contract.
6. **P1** Remove or hard-redirect deprecated admin CSV import endpoints to the new import pipeline.
7. **P1** Implement missing design-step palette preview strip to complete onboarding feature set.
8. **P1** Add CI gates for lint + targeted API tests + web build (current CI only checks tracked env files).
9. **P2** Consolidate duplicated onboarding post-launch guidance in command center.
10. **P2** Add error-reporting/tracing standard (request ID propagation, structured logs, external sink).

---

# 2) Role-based Walkthrough

## A) End User Journey
### Flow: tenant home -> sign up -> verify email -> create profile -> search -> view/edit profile -> logout
- What works:
  - Core route coverage exists for every step.
  - Profile CRUD and search endpoints are tenant-scoped.
- Friction and trust issues:
  - Auth mode transitions (legacy/hybrid/clerk) can create unclear "why am I logged out/unauthorized" moments.
  - Error feedback is inconsistent across pages (some return clean domain errors, others generic request failures).
  - LocalStorage token persistence creates hidden trust risk if the browser is compromised.
  - Some older route aliases and redirects add mental overhead.

## B) Director Journey
### Flow: invite/claim -> director account -> tenant setup -> branding/settings -> invite users/admins -> member management
- What works:
  - End-to-end path exists with substantial UI support.
  - Wizard now includes draft restore, launch celebration, and command-center guidance.
- Needs wizarding/automation/guards:
  - Billing and launch contract still fragile due `/api/tenants/me` tenant-context assumptions.
  - A few onboarding polish tasks still open (palette preview strip, duplicate guidance cleanup).
  - Environment drift can break key confidence moments (launch/billing behavior differs by DB state).

## C) Admin Journey
### Flow: manage users/profiles -> export CSV/PDF -> moderation -> permissions
- What works:
  - Deep admin feature set exists (`apps/api/src/routes/admin.js`, admin UI pages).
  - Bulk actions and exports are present.
- Friction points:
  - CSV import endpoint behavior diverges (`/admin/import-csv` deprecated with 410 while new import exists under `/api/tenants/me`).
  - Permission behavior is mostly good but needs stricter consistency testing between legacy and modern routes.

## D) Super Admin Journey
### Flow: all tenants -> provisioning -> billing status -> support tooling -> analytics
- What works:
  - Super surface is strong and operationally rich.
  - Role gating and allowlist model are in place.
- Gaps:
  - No explicit impersonation flow found as first-class feature.
  - Operational confidence still undermined by schema/runtime drift and test harness fragility.

---

# 3) System Audit

## A) Security & Privacy
### Auth boundaries
- Strengths:
  - `requireAuth` + role middleware + tenant scope middleware layered correctly.
  - Legacy token checks include tenant mismatch checks.
- Gaps:
  - localStorage token persistence remains a medium/high practical risk.

### Supabase RLS
- Intended SQL has broad RLS setup and authenticated policies in `native_schema.sql`.
- Actual runtime check via `rls:audit` (2026-02-27) reports:
  - `covered=2`, `missing_rls=21`.
- This is a critical deployment-control gap.

### File upload security (R2)
- Strengths:
  - Signed PUT uploads, size and content-type validation, origin checks on public/private presign routes.
  - Tenant key-prefix checks for object reads.
- Gaps:
  - Still supports public URL resolution when `R2_PUBLIC_BASE_URL` is configured.

### Secrets management
- Strengths:
  - env templates exist; CI blocks tracked `.env` files.
- Gaps:
  - CI scope currently too narrow (no lint/test/build gates).

### OWASP baseline
- Present:
  - Helmet, CORS policy, auth rate limiting, CSRF checks for cookie-mutating calls.
- Gaps:
  - Need centralized brute-force/abuse observability with alerts.

### Email verification/password reset/account takeover
- Strengths:
  - Invite lock and token consumption logic improved historically.
- Gaps:
  - Mixed auth providers and legacy fallback create broader attack surface unless fully converged.

### Data privacy
- Strengths:
  - Tenant-scoped models and admin audit logs exist.
- Gaps:
  - RLS runtime drift weakens defense-in-depth posture.

## B) Data Model & DB
- Good:
  - Tenant-bound constraints and consistency triggers (users/profiles).
  - Billing/event tables defined in schema file.
- Risks:
  - Runtime schema drift (`stripe_webhook_events` missing in test DB).
  - Email uniqueness semantics are nuanced (global-only uniqueness for `tenant_id IS NULL`); document this clearly for operator expectations.

## C) Backend/API
- Good:
  - Express route decomposition is clear; middleware stack is explicit.
  - Billing/onboarding domains have separated services.
- Risks:
  - Overlapping legacy and new routes increase drift.
  - `/api/tenants/me` context expectations are brittle for non-browser callers.
  - Logging mostly console-based; limited structured telemetry.

## D) Frontend
- Good:
  - Strong route map and role-aware guards.
  - Onboarding UX quality improved significantly.
- Risks:
  - Auth state spread across localStorage/sessionStorage/cookie patterns.
  - Bundle size is high; build warns on large chunks.
  - UX consistency still varies across old/new surfaces.

## E) Billing & Entitlements
- Good:
  - Billing catalog and lifecycle modeling are substantially improved.
  - Stripe webhook event ledger model exists in code.
- Risks:
  - Environment not fully migrated to required schema table(s).
  - Billing and launch tests currently failing due tenant-context contract and schema drift.

---

# 4) UI/UX Design Review

## Current design system state
- There is an established style language (`styles.css`, product onboarding CSS, shared UI package).
- Admin/super shells are cohesive but still show legacy seams.

## Where users feel lost
- Mixed route aliases and redirects can hide canonical navigation paths.
- Billing/import actions are split across old and new endpoint assumptions.
- In onboarding command center, guidance is helpful but partially duplicated.

## Concrete design changes
### Home/landing
- Before:
  - Public home clarity depends heavily on tenant status and auth state.
- After:
  - Add a clear top state ribbon: `Network status`, `Access mode`, `Need help?`.

### Onboarding forms
- Before:
  - Stronger than before, but one planned visual support (palette strip) is absent.
- After:
  - Implement palette preview strip directly below main color input with nav/button/card mini examples.

### Search/results
- Before:
  - Core search works, but load/empty-state messaging varies.
- After:
  - Standardize `loading`, `no results`, and `suggested next filters` templates across search endpoints.

### Profile view/edit
- Before:
  - Functional, but data-completeness cues can be subtle.
- After:
  - Add profile completion rail and section-level save feedback consistency.

### Admin dashboards
- Before:
  - Feature-rich, but import flow messaging conflicts with deprecated endpoint behavior.
- After:
  - Move all import affordances to canonical invite/import flow and remove dead-end CTA paths.

---

# 5) Prioritized Roadmap + Implementation Plan

## P0 / P1 / P2 / P3 Backlog

| Priority | Problem | Proposed solution | Impact | Effort | Dependencies | Acceptance criteria |
|---|---|---|---|---|---|---|
| P0 | Auth token in localStorage | Migrate to HttpOnly cookie auth; remove `writeAuthToStorage` token persistence | High security risk reduction | M | API + web auth refactor | No bearer token stored in local/session storage; login/logout tests pass |
| P0 | Runtime DB schema drift | Run schema apply in all envs; verify `stripe_webhook_events` presence | Billing reliability + data integrity | M | Supabase migration access | `billingFlow` webhook tests stop failing on missing table |
| P0 | Runtime RLS drift | Enforce `rls:audit` gate in CI/CD; apply missing RLS in DB | Defense-in-depth restored | M | Supabase permissions | `rls:audit` shows no tenant table with `missing_rls` |
| P0 | `/api/tenants/me` 404 contract drift | Introduce consistent tenant inference fallback and explicit API contract docs | Launch/billing path stability | S | API middleware | `onboardingLaunchGate` and `billingFlow` me-routes return expected statuses |
| P1 | Billing test instability | Update tests to send `X-Tenant-Slug` where required and/or normalize middleware fallback | Faster delivery confidence | S | Above me-route fix | `billingFlow.test.js` green end-to-end |
| P1 | Deprecated admin import endpoint still reachable | Hard redirect or remove `/api/t/:slug/admin/import-csv` UI affordance and API route usage | Admin UX consistency | S | Admin UI and route cleanup | CSV import tests align to canonical flow; no 410 in expected happy path |
| P1 | Missing onboarding palette preview | Implement planned swatch strip on design step | UX trust and design confidence | S | Web onboarding page/styles | Palette preview visible and responsive; lint/build pass |
| P1 | CI too narrow | Add workflow for lint + selected API tests + web build + `rls:audit` | Prevent regressions | M | GitHub Actions updates | PR fails on lint/test/build/RLS regressions |
| P2 | Duplicate post-launch guidance | Keep one launch guide source; remove or fold "First 3 Things" duplicate | Cleaner director UX | S | Command center page | Only one first-run guidance pattern shown |
| P2 | Large web bundle | Split heavy routes/components and media strategy | Better page perf | M | Web bundling pass | Main chunk reduced and route-level lazy loading measured |
| P2 | Observability gaps | Add structured logger + request IDs + error sink integration | Better ops/debugging | M | Infra target selection | Error traces searchable by requestId and tenant |
| P3 | Super impersonation workflow | Add controlled, audited impersonation utility | Support efficiency | L | Security policy + audit logs | Explicit impersonation events recorded with reason and actor |

## Realistic 4-week solo sprint plan

### Sprint 1 (Week 1) - Risk containment
- P0 auth token storage migration.
- P0 schema sync (`stripe_webhook_events`) across active environments.
- P0 RLS enforcement and baseline verification.
- Add migration/runbook notes in docs.

### Sprint 2 (Week 2) - Contract and test stabilization
- Fix `/api/tenants/me` tenant-context contract.
- Update failing suites (`billingFlow`, `onboardingLaunchGate`) and test helpers.
- Align import API behavior/tests to canonical route.

### Sprint 3 (Week 3) - UX and admin clarity
- Implement missing palette preview strip.
- Remove duplicate launch guidance patterns.
- Normalize admin import copy and CTA destinations.

### Sprint 4 (Week 4) - Platform confidence
- Add CI: lint, focused API tests, web build, RLS audit.
- Bundle splitting/performance pass.
- Structured logging and error reporting baseline.

---

# 6) Quick Wins (10-20)
1. Add `X-Tenant-Slug` injection helper for all `/api/tenants/me/*` API test calls.
2. Update API test script/docs to include DB marker-guard config for local test DBs.
3. Add explicit 400 error payload when `/api/tenants/me/*` is called without tenant context.
4. Remove/redirect stale admin import CTA routes pointing to deprecated endpoint.
5. Implement design-step palette preview strip in director wizard.
6. Add one-line status helper under billing CTA explaining current lifecycle state.
7. Standardize loading skeletons across search/profile/admin tables.
8. Add empty-state actions on search results (invite alumni, adjust filter, clear query).
9. Add consistent form-level error summary at top for onboarding/admin forms.
10. Replace any generic "Request failed" user copy with domain-specific guidance.
11. Add route-level lazy loading for super pages.
12. Compress or defer heavy static assets used by first-load tenant pages.
13. Add explicit test for deprecated import endpoint behavior (if intentionally retained).
14. Add integration test asserting tenant-specific object proxy denies cross-tenant keys.
15. Add simple release script check that fails if `rls:audit` reports `missing_rls > 0`.

---

# 7) Stop Doing / Start Doing Engineering Practices

## Stop doing
- Stop shipping schema changes without runtime verification in every active DB.
- Stop relying on localStorage for durable auth tokens.
- Stop keeping overlapping legacy/new endpoint behavior undocumented.
- Stop merging without CI signals for lint/test/build/RLS.

## Start doing
- Start environment parity checks before each release:
  - schema version, RLS coverage, required tables.
- Start strict API contract docs for tenant context requirements.
- Start adding acceptance tests when deprecating endpoints.
- Start keeping one canonical flow per domain (import, onboarding, billing) and hard-redirect legacy entry points.

## Minimal CI checks (recommended)
- `npm run lint`
- `npm --workspace @pondbridge/web run build`
- `npx cross-env ... jest --runInBand` for critical API suites
- `npm --workspace @pondbridge/api run rls:audit` with fail condition on missing RLS

## Release checklist (minimum)
1. Apply DB schema and confirm required tables exist (`stripe_webhook_events`, `tenant_admin_audit_logs`, etc.).
2. Run RLS audit and verify no tenant table is missing RLS.
3. Run lint, web build, and critical API tests.
4. Validate tenant onboarding + launch + billing checkout in staging with a fresh tenant.
5. Confirm rollback plan:
   - DB migration rollback path
   - API deploy rollback tag
   - feature-flag fallback for auth/billing critical paths

---

## Current Open Items Snapshot (as of 2026-02-27)
- Open critical:
  - localStorage auth token persistence
  - runtime RLS drift
  - runtime schema drift for billing webhook ledger table
- Open high:
  - `/api/tenants/me` tenant-context contract instability
  - test suite failures around billing/launch/import/chat status expectations
  - deprecated CSV import endpoint still present with 410 behavior
- Open medium:
  - missing palette preview strip in onboarding
  - duplicate post-launch guidance pattern in command center
  - incomplete CI gate coverage

---

## Execution Update (Implemented Pass - 2026-02-27)

### Completed in code
- Tenant middleware contract hardening:
  - Updated tenant scope middleware chain ordering to `requireAuth -> requireTenant -> enforceTenantScope`.
  - Added tenant fallback resolution from authenticated membership and super-admin `tenantId` targeting when no slug/host tenant can be resolved.
  - Files:
    - `apps/api/src/middleware/tenantAccess.js`
    - `apps/api/src/middleware/tenantContext.js`

- `/api/tenants/me` admin scope enforcement fix:
  - Non-super-admin requests that include a different `tenantId` are now explicitly denied (`TENANT_SCOPE_DENIED`), preventing cross-tenant management by override.
  - File:
    - `apps/api/src/routes/tenants.js`

- Chat DM status correctness:
  - DM creation now returns:
    - `400 INVALID_INPUT` for malformed/missing `userId`
    - `404 USER_NOT_FOUND` for valid IDs outside current tenant
  - File:
    - `apps/api/src/routes/legacyCedarCompat.js`

- CSV import contract alignment:
  - Tests moved to canonical route `/api/tenants/me/import-csv`.
  - Tenant import UI moved to canonical route and updated to support both legacy and canonical response shapes.
  - Files:
    - `apps/api/tests/csvImport.test.js`
    - `apps/web/src/pages/TenantImportPage.jsx`

- Billing test reliability improvement:
  - Stripe webhook ledger detection in tests now probes `findByStripeEventId` directly, reducing false positives when ledger table is unavailable.
  - File:
    - `apps/api/tests/billingFlow.test.js`

### Validation run results
- Lint:
  - `npm --workspace @pondbridge/api run lint -- ...` (targeted changed files) passed.
  - `npm --workspace @pondbridge/web run lint -- src/pages/TenantImportPage.jsx` passed.

- Targeted API suites:
  - With explicit dedicated test DB markers (`PONDBRIDGE_TEST_DB_MARKERS=<safe-markers>`):
    - `tests/tenancy.test.js` passed
    - `tests/csvImport.test.js` passed
    - `tests/chatForumsCompat.test.js` passed
    - `tests/billingFlow.test.js` passed
  - Combined run of all 4 suites passed: 23/23 tests.

### Current follow-up priorities after latest execution
- Performance budget tightening:
  - Reduce critical route JS gzip from ~476KB to `<350KB`.
  - Reduce first-load media payload on primary routes.
- CI/environment consistency:
  - Ensure every CI/runtime environment defines `PONDBRIDGE_TEST_DB_MARKERS` for safe reset checks.
- UX polish:
  - Complete remaining loading/empty/error state unification across core web journeys.
