# PondBridge Architecture (MVP)

## Monorepo Layout
```text
pondbridge-platform/
├── _import/cedar-original/    # read-only Cedar reference
├── apps/
│   ├── api/                   # Express + MongoDB tenant-first backend
│   └── web/                   # React + Vite tenant-first frontend
├── packages/
│   ├── shared/                # Zod schemas + plan feature flags
│   └── ui/                    # Shared UI primitives + theme tokens
└── docs/
```

## Data Model
- `Tenant`
  - `name`, `slug`, `status`
  - `planTier` (`base` | `premium`)
  - `onboardingStatus` (`not_started` | `in_progress` | `live`)
  - `onboardingFeeAmount`
  - `theme` (brand colors/logo/typography)
  - `accessSettings` (`signupMode`, `accessCode`)
  - billing fields (`stripeCustomerId`, `stripeSubscriptionId`, `stripePriceId`, `billingStatus`)
  - onboarding billing (`onboardingFeePaid`, `onboardingFeeInvoiceId`)
- `User`
  - `tenantId`
  - `email`, `passwordHash`
  - `roles` (`user`, `tenant_admin`, `super_admin`)
  - `profileId`
- `Profile`
  - `tenantId`, `userId`
  - profile fields (name, emails, phones, cityState, camp role, education/jobs/social/bio)
- `FamilyTree` (premium)
  - `tenantId`, `name`, `createdByUserId`
  - `members[]` with relationship edges

## Tenancy Strategy
- Tenant context is derived by `getTenantContext(req)` in priority order:
  1. Path param `/t/:slug`
  2. URL prefix parsing fallback
  3. Subdomain (`camp-slug.pondbridge.co`)
  4. Header fallback `x-tenant-slug` (local/testing)
- `requireTenant` resolves tenant and attaches:
  - `req.tenant`
  - `req.tenantContext = { tenantId, slug, source }`
- Non-super users are denied if JWT tenant does not match route tenant.

## RBAC
- `user`
  - can read directory (tenant scoped)
  - can read/write own profile
- `tenant_admin`
  - all `user` permissions
  - admin dashboard, export, access settings, onboarding publish
  - manage profiles only within own tenant
- `super_admin`
  - cross-tenant controls (create/disable tenants, global counts)

## API Surface (MVP)
- Public:
  - `GET /api/public/tenant-config?slug=...`
- Tenant Auth:
  - `POST /api/t/:slug/auth/register`
  - `POST /api/t/:slug/auth/login`
- Profiles:
  - `GET /api/t/:slug/profiles/me`
  - `PUT /api/t/:slug/profiles/me`
  - `GET /api/t/:slug/profiles`
  - `GET /api/t/:slug/profiles/:profileId`
- Tenant Admin:
  - `GET /api/t/:slug/admin/overview`
  - `GET /api/t/:slug/admin/profiles`
  - `DELETE /api/t/:slug/admin/profiles/:profileId`
  - `GET /api/t/:slug/admin/export/csv`
  - `GET /api/t/:slug/admin/export/pdf` (premium)
  - `PUT /api/t/:slug/admin/access-settings`
  - `PUT /api/t/:slug/admin/branding`
  - `PUT /api/t/:slug/admin/onboarding/publish`
- Resume Parsing:
  - `POST /api/t/:slug/resume/parse` (premium)
- Super Admin:
  - `POST /api/auth/super/login`
  - `GET /api/super/dashboard`
  - `GET /api/super/tenants`
  - `POST /api/super/tenants`
  - `PATCH /api/super/tenants/:tenantId`
  - `POST /api/super/tenants/:id/create-checkout`
- Billing:
  - `GET /api/tenants/me/billing`
  - `POST /api/webhooks/stripe`

## Frontend Structure
- Tenant-scoped app routes under `/t/:slug/*`.
- `TenantProvider` fetches tenant config and applies CSS variables globally.
- Auth storage keys are standardized:
  - `pondbridgeToken`
  - `pondbridgeUser`
- Core pages:
  - tenant landing/login/create-account
  - my profile
  - profile view (read-only)
  - directory search
  - tenant admin dashboard
  - super admin login/dashboard

## Security Baseline
- JWT auth with expiry (`JWT_EXPIRES_IN`).
- Password hashing via bcrypt algorithm (`bcryptjs`).
- Rate limit on auth routes.
- Standardized API error envelope.
- Tenant scope checks in middleware + query filters.
