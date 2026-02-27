# README: A+ Execution Notes (2026-02-27)

## Purpose
Single source of truth for what was implemented from the A+ production plan, what was verified, and what remains.

## Completed Changes

### Security and Auth
- Removed durable bearer-token persistence from web local/session storage.
- Added in-memory token handling for web runtime-only auth token usage.
- Kept cookie-first session recovery path in auth context.
- Added/updated CSRF coverage for cookie-auth mutating endpoints.

### Multi-tenant and Authorization
- Hardened `/api/tenants/me/*` tenant-scope enforcement.
- Preserved canonical tenant resolution precedence (path/header/host/membership fallback).
- Added/kept cross-tenant deny tests for tenant member/admin flows.

### DB Governance and RLS
- Added DB preflight script and CI gate (`apps/api/scripts/dbPreflightCheck.js`).
- Applied native schema updates and fixed SQL compatibility issues.
- Enforced legacy `pb_mongo_mirror` RLS/policies when table exists.
- RLS audit now reports `missing_rls=0` and `missing_policy=0`.

### API Contract and Logging
- Standardized error payload augmentation with `error.requestId`.
- Added structured request logging with request/tenant/actor metadata.
- Kept canonical import endpoint contract (`/api/tenants/me/import-csv`) and explicit 410 response for deprecated path.

### Billing and Reliability
- Billing checkout, founders cap, webhook idempotency, and failure mapping tests are green.
- Added/used webhook ledger model and guards in tests.

### UX and Frontend
- Added route-level lazy loading for heavy admin/super/director pages.
- Converted Cedar route pages to lazy loading to keep initial route payload small.
- Improved onboarding UX details (palette preview and command-center duplication cleanup).
- Updated import/admin flow messaging and canonical links.
- Optimized heavy image assets (hero, cover, logo, background) and switched Cedar background to JPG.
- Added manual vendor chunking for map and clerk bundles.

### CI / Delivery Governance
- Added quality-gates workflow enforcing:
  - lint
  - build
  - env hygiene
  - DB preflight
  - RLS audit
  - API tests
  - web perf budget check

## Validation Evidence
- `npm run lint` -> pass
- `npm run security:check-env` -> pass
- `npm run db:preflight` -> pass
- `npm --workspace @pondbridge/api run supabase:apply-schema` -> pass
- `npm --workspace @pondbridge/api run rls:audit` -> pass (`covered=24 missing_rls=0 missing_policy=0`)
- `npm run build` -> pass
- `npm run perf:check-web` -> pass with strict budgets (`main_js_gzip<=350KB`, `largest_image_raw<=1MB`)
- `PONDBRIDGE_TEST_DB_MARKERS=<safe-test-markers> npm --workspace @pondbridge/api run test` -> pass (`14 suites`, `50 tests`)

## Current A+ Status
- `index` JS gzip is now about `104KB` (target `<350KB` satisfied).
- Largest image asset is about `0.76MB` raw (strict `1MB` budget satisfied).
- API/security/data/tenant checks are green and enforced in CI quality gates.

## Ongoing Maintenance (Post A+)
1. Keep image additions below the enforced image budget.
2. Keep route-level code splitting for new feature surfaces.
3. Keep test DB marker configuration explicit in local and CI environments.
