# A+ Baseline and Current Snapshot (2026-02-27)

## Baseline (start of execution)
- Lint: pass
- Security env hygiene: pass
- Web build: pass (chunk warning present)
- API tests: pass (`14 suites`, `49 tests`) under previous configuration
- RLS audit: fail (`covered=2`, `missing_rls=21`, `missing_policy=0`)
- Main JS gzip: `~532KB`

## Current (post-implementation)
- Lint: pass
- Security env hygiene: pass
- DB preflight: pass (`missingTables=0`, `missingIndexes=0`, required RLS covered)
- Schema apply: pass
- RLS audit: pass (`covered=24`, `missing_rls=0`, `missing_policy=0`)
- API tests: pass (`14 suites`, `50 tests`) with explicit safe DB marker configuration
- Main JS gzip (`index`): `~104KB`
- Largest image raw: `~0.76MB`
- Largest JS chunk gzip (route-isolated map vendor): `~269KB`

## Top API Error Codes Seen in Validation Runs
1. `FOUNDERS_CAP_REACHED` (expected billing cap guard path)
2. `BILLING_TENANT_NOT_FOUND` (expected webhook mapping failure path)
3. `TENANT_SCOPE_DENIED` (expected cross-tenant denial path)
4. `FILE_TOO_LARGE` (expected upload limit path)
5. `UPLOAD_ORIGIN_FORBIDDEN` (expected origin/CORS hardening path)

## A+ Gap Status
1. Critical-route JS target `<350KB`: complete.
2. First-load image optimization target: complete.
3. Explicit test DB marker safety configuration: complete in CI and documented for local runs.
