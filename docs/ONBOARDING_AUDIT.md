# Director Onboarding Audit

## Repo Snapshot (Focused)

### `apps/web`
- `src/App.jsx`
- `src/context/TenantContext.jsx`
- `src/context/AuthContext.jsx`
- `src/components/NavBar.jsx`
- `src/components/ProtectedRoute.jsx`
- `src/pages/TenantAdminPage.jsx`
- `src/pages/TenantOnboardingWizardPage.jsx`
- `src/pages/TenantImportPage.jsx`
- `src/pages/TenantInvitesPage.jsx`
- `src/pages/TenantBillingPage.jsx`
- `src/pages/TenantAnalyticsPage.jsx`
- `src/pages/TenantLanding.jsx`
- `src/pages/RegisterPage.jsx`
- `src/pages/LoginPage.jsx`
- `src/styles.css`

### `apps/api`
- `src/middleware/tenantContext.js`
- `src/middleware/requireAuth.js`
- `src/middleware/requireRole.js`
- `src/models/Tenant.js`
- `src/models/User.js`
- `src/models/Profile.js`
- `src/models/ImportReport.js`
- `src/routes/public.js`
- `src/routes/tenants.js`
- `src/routes/admin.js`
- `src/routes/tenantAuth.js`
- `src/services/csvImport.js`
- `src/services/analytics.js`

### `packages`
- `packages/ui/src/primitives.jsx`
- `packages/ui/src/theme.css`
- `packages/shared/src/index.js`
- `packages/shared/src/features.js`

## Existing Capabilities We Will Reuse

- Tenant resolution:
  - Subdomain, `/t/:slug`, and `x-tenant-slug` fallback are already supported in `apps/api/src/middleware/tenantContext.js`.
  - Frontend reads `/api/public/tenant-config?slug=...` in `apps/web/src/context/TenantContext.jsx`.
- Auth + roles:
  - Roles already in `User` model: `user`, `tenant_admin`, `super_admin`.
  - JWT auth with tenant scoping middleware.
- Admin tooling:
  - Tenant admin dashboard, profile management, CSV/PDF export in `apps/api/src/routes/admin.js` and `apps/web/src/pages/TenantAdminPage.jsx`.
- Onboarding foundation:
  - Existing onboarding wizard page + API (`/api/tenants/me/onboarding`, `/me/theme`, `/me/settings`, `/me/import-csv`, `/me/launch`) in `apps/api/src/routes/tenants.js` and `apps/web/src/pages/TenantOnboardingWizardPage.jsx`.
- Import pipeline:
  - Robust CSV import service with duplicate handling and reporting in `apps/api/src/services/csvImport.js`.
- Theme system:
  - Theme tokens are loaded from tenant config and applied as CSS vars in `apps/web/src/context/TenantContext.jsx`.
- Invite system base:
  - Invite model, invite sending, invite-aware signup already present in `apps/api/src/models/Invite.js`, `apps/api/src/routes/admin.js`, and `apps/api/src/routes/tenantAuth.js`.

## Missing Capabilities We Will Add

- Director-first command center route (`/onboarding`) separate from admin dashboard.
- Strong onboarding domain model:
  - checklist items with statuses
  - explicit current step id
  - onboarding drafts (theme/content/settings) for preview-before-launch
  - richer content/settings model
- Access code security:
  - hash access code, never return raw value.
- Tenant admin activity auditing:
  - add `TenantAdminAuditLog` collection + writes on onboarding events.
- Full onboarding API coverage:
  - PATCH onboarding state
  - PATCH content
  - add/manage tenant admins
  - import history endpoint
  - public tenant status endpoint
- Launch gating:
  - block launch until required checklist items pass.
- UX polish:
  - autosave indicator
  - onboarding redirect enforcement for tenant admins until live
  - preview panel with draft values
  - post-launch settings routes that reuse onboarding forms.

## Files To Modify

- `apps/api/src/models/Tenant.js`
- `apps/api/src/routes/tenants.js`
- `apps/api/src/routes/public.js`
- `apps/api/src/routes/tenantAuth.js`
- `apps/api/src/routes/admin.js`
- `apps/api/src/scripts/seed.js`
- `apps/web/src/App.jsx`
- `apps/web/src/components/ProtectedRoute.jsx`
- `apps/web/src/components/NavBar.jsx`
- `apps/web/src/context/TenantContext.jsx`
- `apps/web/src/pages/TenantAdminPage.jsx`
- `apps/web/src/pages/TenantOnboardingWizardPage.jsx`
- `apps/web/src/pages/LoginPage.jsx`
- `apps/web/src/pages/RegisterPage.jsx`
- `apps/web/src/styles.css`
- `packages/shared/src/index.js`

## New Files To Create

- `apps/api/src/models/TenantAdminAuditLog.js`
- `apps/api/src/services/onboarding.js`
- `apps/web/src/components/OnboardingLayout.jsx`
- `apps/web/src/pages/DirectorOnboardingCommandCenterPage.jsx`
- `apps/web/src/pages/DirectorOnboardingWizardPage.jsx`
- `apps/web/src/pages/settings/BrandingSettingsPage.jsx`
- `apps/web/src/pages/settings/SignupSettingsPage.jsx`
- `apps/web/src/pages/settings/ContentSettingsPage.jsx`
- `apps/web/src/pages/settings/AdminsSettingsPage.jsx`
- `apps/web/src/pages/settings/ImportsSettingsPage.jsx`
- `docs/DIRECTOR_ONBOARDING.md`

## Customization Inventory (Camp-Level)

### Branding
- Logo (`logoUrl`)
- Primary/secondary/accent colors
- Typography token/font family
- Hero image

### Network Naming
- Camp network heading and title text based on camp name
- Welcome headline/body content blocks

### Signup Mode
- Open signup
- Access code (hashed storage)
- Invite-only (already partially implemented; polished in onboarding UX)

### Directory Settings
- `allowSearchByDefault`
- `allowDirectoryBrowse`
- `requireProfileCompletion`
- Basic required profile fields selection (v1 basic controls)

### Content Blocks
- Welcome headline
- Welcome body
- Contact email
- Support URL

### Roles / Admin Access
- Add additional camp admins by email
- Assign tenant admin role safely within same tenant

### Plan Features
- Base:
  - profiles, directory/search, admin CSV export, onboarding core
- Premium:
  - resume parsing, family trees, PDF export, advanced analytics, onboarding-call CTA, custom domain path

## Generalization Notes

- UI copy should use “Your Camp” and “Your Network”, not “tenant”.
- Cedar-specific branding must remain fixture-only via seed data, not hardcoded UI strings.
- All onboarding operations remain tenant-scoped and role-restricted (`tenant_admin` / `super_admin`).
