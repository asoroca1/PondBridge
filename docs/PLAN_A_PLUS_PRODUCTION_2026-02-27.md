# PondBridge A+ Production Plan (2026-02-27)

## Objective
Raise platform readiness from **B-** to **A+** by completing security hardening, schema/runtime parity, route contract consistency, UX trust improvements, performance budgets, and enforced CI gates.

## Exit Criteria
1. `npm --workspace @pondbridge/api run rls:audit` reports `missing_rls=0` and `missing_policy=0`.
2. Web sessions do not persist bearer tokens in `localStorage`/`sessionStorage`.
3. Cross-tenant scope tests pass for member/admin/super access paths.
4. CI enforces lint, build, API tests, RLS audit, DB preflight, env hygiene, and web perf budget.
5. API logs emit structured request/error lines with `requestId`, `tenantId`, `actorUserId`, route, status, duration, and error code.

## Delivery Phases

### Phase 0: Baseline and plan persistence
- Save this plan and baseline metrics docs.
- Link plan from root README.
- Maintain an implementation checklist in the PR/issue board.

### Phase 1: Security foundations
- Eliminate durable token persistence in web storage.
- Keep cookie-first auth for browser sessions; allow bearer for explicit API/dev flows.
- Enforce/verify CSRF protections for cookie-authenticated mutating calls.

### Phase 2: Data and schema governance
- Add DB preflight checks for required tables, indexes, and RLS status.
- Require schema parity for billing ledger (`stripe_webhook_events`) and related operational tables.
- Gate deploy/CI on preflight + RLS audit.

### Phase 3: Tenant/auth/API canonicalization
- Keep canonical tenant context precedence:
  1) `/api/t/:slug/*` path slug
  2) `X-Tenant-Slug` header
  3) host/domain mapping
  4) authenticated membership fallback for `/api/tenants/me/*`
- Enforce non-super-admin tenant override denial on `/api/tenants/me/*`.
- Keep import flow canonical on `/api/tenants/me/import-csv`.
- Standardize API error payloads with `error.code`, `error.message`, `error.requestId`.

### Phase 4: UX and accessibility trust passes
- Standardize loading/empty/error/success states in onboarding/search/profile/admin flows.
- Complete onboarding design affordances (brand palette preview and validation clarity).
- Remove dead-end/admin legacy affordances that conflict with canonical routes.

### Phase 5: Performance, observability, CI enforcement
- Route-level code splitting for heavy super/admin routes.
- Add measurable web build budgets and fail on regression.
- Emit structured request completion logs and structured errors.

## Validation Matrix
- Security: `csrfProtection`, `authModeHybrid`, `superAuthBoundary`, tenancy isolation.
- Billing: lifecycle, idempotency, founders cap, tenant mapping failures.
- Onboarding: launch gate and super override.
- Import: canonical endpoint happy path + cross-tenant denial.
- Frontend: role guards, auth/session recovery, standardized state messaging.
- Performance: build + budget check (`npm run perf:check-web`).

## Operational Defaults
- Browser auth should rely on secure cookies (HttpOnly) and short-lived in-memory bearer tokens when needed.
- Dedicated non-production DB is required for CI test resets (no marker bypass).

## Execution Status (2026-02-27)
- Phase 0: completed
- Phase 1: completed
- Phase 2: completed
- Phase 3: completed
- Phase 4: completed
- Phase 5: completed

## Final Outcome
- A+ production-ready criteria achieved in this execution cycle.
