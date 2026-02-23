# Director Onboarding

## Purpose

The director onboarding flow configures `TenantConfig` for each camp while preserving the fixed Camp Cedar shell.

No layout variants are introduced. All camps use the same pages and components.

## Canonical Routes

- Super admin:
  - `/super/dashboard`
- Director claim:
  - `/t/:slug/director-claim?token=...`
- Onboarding:
  - `/t/:slug/onboarding` (Command Center)
  - `/t/:slug/onboarding/wizard` (step editor)
- Billing:
  - `/t/:slug/admin/billing`

## End-to-End Flow

1. Super admin creates tenant with minimal fields and optional director email.
2. API returns director claim link.
3. Director opens claim link and continues to create account with invite token.
4. Director is forced into onboarding until tenant is launched.
5. Wizard updates draft `TenantConfig` only:
   - Step 1: `name_branding`
   - Step 2: `welcome_message`
   - Step 3: `signup_controls`
   - Step 4: `import_alumni`
   - Step 5: `modules`
   - Step 6: `review_launch`
6. Launch is blocked until required checks pass, including billing readiness.
7. Super admin can bypass billing gate by launching with override.

## Billing Gate Rules

Billing is considered ready when:

- `billingStatus` is `active` or `trialing`
- and onboarding fee is paid (or fee amount is `0`)

In `mock` billing mode (or as super admin), billing state can be updated via:

- `PATCH /api/tenants/me/billing`

## APIs Used

Public:

- `GET /api/public/tenant-config?slug=...`

Super admin:

- `POST /api/super/tenants`

Director auth:

- `POST /api/t/:slug/auth/invite/verify`
- `POST /api/t/:slug/auth/register`

Director onboarding:

- `GET /api/tenants/me/onboarding`
- `PATCH /api/tenants/me/onboarding`
- `PATCH /api/tenants/me/theme`
- `PATCH /api/tenants/me/content`
- `PATCH /api/tenants/me/settings`
- `PATCH /api/tenants/me/modules`
- `POST /api/tenants/me/import/csv`
- `GET /api/tenants/me/billing`
- `PATCH /api/tenants/me/billing`
- `POST /api/tenants/me/launch`

## Local Test Steps

1. From repo root:
   - `cd "/Users/asoroca/Desktop/PondBridge System/pondbridge-platform"`
2. Install dependencies:
   - `npm install`
3. Seed data:
   - `npm --workspace @pondbridge/api run seed`
4. Start apps:
   - `npm run dev`

### Seeded Tenants

- Live Cedar tenant:
  - URL: `http://localhost:5173/t/camp-cedar`
  - Admin: `admin@campcedar.local` / `Pondbridge123!`
- Draft tenant:
  - Create from super admin at `http://localhost:5173/super/dashboard`.
  - Use generated director claim link from the create-tenant workflow.

### Verify Flow

1. Sign in to draft tenant admin.
2. Confirm redirect to `/t/:slug/onboarding`.
3. Open wizard and complete/save each step.
4. Validate autosave state shows `Saving...` then `Saved`.
5. Import CSV and review summary.
6. Configure billing readiness from command center/billing page.
7. Launch from review step.
8. Confirm tenant status becomes live and admin dashboard is accessible.
9. Confirm non-admin signup is blocked before launch and enabled per configured signup mode after launch.
