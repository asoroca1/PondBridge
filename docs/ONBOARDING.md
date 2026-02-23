# Tenant Admin Onboarding Wizard

The onboarding wizard guides a tenant admin from initial setup to launch.

## Route
- UI: `/t/:slug/admin/onboarding`
- Access: tenant admin (or super admin acting on tenant context)

## Wizard Steps
1. Branding
- Upload logo (stored as `theme.logoUrl`)
- Set brand colors and typography
- Persists via `PATCH /api/tenants/me/theme`

2. Signup Settings
- Select `open` or `code` mode (`invite_only` reserved for v2)
- Set access code if mode is `code`
- Persists via `PATCH /api/tenants/me/settings`

3. Data Import
- Upload CSV of initial alumni list
- Supports skip mode to continue without importing
- Persists via `POST /api/tenants/me/import-csv`

4. Preview
- Displays theme preview and sample page cards
- Uses saved tenant theme and settings

5. Launch
- Marks tenant live
- Persists via `POST /api/tenants/me/launch`

## Resume / Interruption Recovery
Wizard state persists on the Tenant document in `onboardingProgress`:
- `currentStep`
- `completedSteps[]`
- `lastSavedAt`
- `launchedAt`
- `lastImportStats`

The UI restores progress using:
- `GET /api/tenants/me/onboarding`

If the browser closes mid-flow, reopening `/t/:slug/admin/onboarding` resumes from persisted step.

## Backend Endpoints
- `GET /api/tenants/me/onboarding`
- `PATCH /api/tenants/me/theme`
- `PATCH /api/tenants/me/settings`
- `POST /api/tenants/me/import-csv`
- `POST /api/tenants/me/launch`

## CSV Import Notes
Expected columns (case-insensitive variants supported):
- `firstName`, `lastName`, or `name`
- `email` (required)
- optional: `phone`, `cityState`, `roleAtCamp`, `industry`, `highSchool`, `bio`

Behavior:
- Duplicate emails inside tenant are skipped.
- New users are created with generated passwords and `user` role.
- Profiles are created with tenant-scoped `tenantId`.
