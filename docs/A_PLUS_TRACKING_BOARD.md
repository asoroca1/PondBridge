# A+ Tracking Board (Execution Checklist)

## Epic 1: Security Foundations
- [ ] Remove durable token storage from web session flow.
- [ ] Verify CSRF protections on cookie-authenticated mutating routes.
- [ ] Confirm security suites pass (`csrfProtection`, `authModeHybrid`, `superAuthBoundary`).

## Epic 2: DB and RLS Governance
- [ ] Apply native schema in staging/prod target DBs.
- [ ] Run `npm run db:preflight` and capture output.
- [ ] Run `npm --workspace @pondbridge/api run rls:audit` and capture output.
- [ ] Reach `missing_rls=0` and `missing_policy=0`.

## Epic 3: Tenant Contract and API Canonicalization
- [ ] Verify tenant context precedence and `/api/tenants/me/*` fallback behavior.
- [ ] Keep non-super-admin `tenantId` override denied.
- [ ] Ensure import UI/API usage is canonical (`/api/tenants/me/import-csv`).

## Epic 4: UX and Accessibility
- [ ] Standardize loading/empty/error/success states on critical flows.
- [ ] Complete onboarding brand palette preview and validation clarity.
- [ ] Remove duplicate post-launch guidance.
- [ ] Run manual role walkthroughs: user/director/admin/super.

## Epic 5: Performance and Observability
- [ ] Enable route-level code splitting for heavy surfaces.
- [ ] Pass `npm run perf:check-web` budget gate.
- [ ] Verify structured request/error logs include required correlation fields.

## Epic 6: CI/Release Enforcement
- [ ] Ensure `quality-gates.yml` is required on PRs.
- [ ] Verify dedicated CI DB config with marker guard (no bypass).
- [ ] Adopt release checklist for schema parity, tests, audit, and rollback.
