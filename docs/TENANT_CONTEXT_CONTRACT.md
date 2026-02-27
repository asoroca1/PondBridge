# Tenant Context Contract

## Purpose
Define one canonical tenant-resolution policy for API callers and internal middleware.

## Resolution precedence
1. Path slug (tenant-scoped endpoints): `/api/t/:slug/*`
2. Header slug: `X-Tenant-Slug`
3. Host/domain mapping (subdomain or custom domain)
4. Authenticated membership fallback (only for `/api/tenants/me/*`)

## Scope enforcement rules
- Non-super-admin identities must always match the resolved tenant.
- Super admins may target a tenant explicitly via `tenantId` for `/api/tenants/me/*`.
- Non-super-admin `tenantId` override attempts must fail with `TENANT_SCOPE_DENIED`.

## Error contract
All tenancy-related failures should include:
- `error.code`
- `error.message`
- `error.requestId`

Recommended codes:
- `TENANT_REQUIRED`
- `TENANT_NOT_FOUND`
- `TENANT_SCOPE_DENIED`
- `TENANT_CONTEXT_REQUIRED`

## Canonical import route
- Preferred: `POST /api/tenants/me/import-csv`
- Legacy admin endpoint `/api/t/:slug/admin/import-csv` should not be used for new UI/client paths.
