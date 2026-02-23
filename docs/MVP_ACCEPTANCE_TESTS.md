# PondBridge MVP Acceptance Tests

This checklist verifies multi-tenant behavior and core MVP flows.

## Test Data Setup
1. Start local services:
```bash
npm run dev
```
2. Seed baseline data:
```bash
npm --workspace @pondbridge/api run seed
```
3. Log in as super admin (`superadmin@pondbridge.local` / `SuperAdmin123!`) at `/super/login`.
4. Create a second tenant in super admin dashboard:
- Name: `Camp North`
- Slug: `camp-north`
- Plan: `Premium`
5. Create at least 1 user/profile in each tenant (`camp-cedar` and `camp-north`).

## 1. Tenant Routing Works (`/t/:slug`)
1. Open `/t/camp-cedar`.
2. Open `/t/camp-north`.
3. Open an invalid slug `/t/not-a-real-camp`.

Expected:
- Cedar and North both render tenant app pages.
- Invalid slug shows tenant not found error.
- URL structure remains tenant-scoped for all internal routes.

## 2. Tenant Config Loads (Theme + Name)
1. On `/t/camp-cedar`, verify camp name and theme colors.
2. On `/t/camp-north`, verify name/theme are different after branding change.
3. In tenant admin for `camp-north`, change primary color and save branding.
4. Refresh `/t/camp-north`.

Expected:
- Name and theme values are loaded from `/api/public/tenant-config?slug=...`.
- Theme updates apply without code changes.
- No Cedar hardcoded branding appears on non-Cedar tenants.

## 3. Signup/Login Works for Tenant A
1. Visit `/t/camp-cedar/create-account`.
2. Create a new user.
3. Log out.
4. Log back in at `/t/camp-cedar/login`.

Expected:
- Registration succeeds and signs in user.
- Login succeeds only within the same tenant slug.
- Token/user are stored under `pondbridgeToken` and `pondbridgeUser`.

## 4. Creating Profiles Always Writes `tenantId`
1. Create a new account in `camp-cedar`.
2. In API/DB, inspect the created profile document.

Expected:
- `profile.tenantId` exists.
- `profile.tenantId` matches `camp-cedar` tenant ID.
- `user.tenantId` and `profile.tenantId` match.

## 5. Search Shows Only Tenant A Profiles
1. Log in to `/t/camp-cedar`.
2. Search by a broad query (e.g., `Alex`) in directory/search.
3. Confirm one matching profile exists in `camp-north` with same name fragment.

Expected:
- Results only include `camp-cedar` profiles.
- No `camp-north` profiles appear.

## 6. Tenant Admin Dashboard Shows Only Tenant A Profiles
1. Log in as Cedar tenant admin.
2. Open `/t/camp-cedar/admin`.
3. Review listed profiles and counts.

Expected:
- Only Cedar users/profiles are listed.
- Deleting a profile affects only Cedar data.
- Accessing `/t/camp-north/admin` with Cedar admin token is denied (403).

## 7. Super Admin Can View Tenant A and Tenant B
1. Log in at `/super/login` as super admin.
2. Open super dashboard and view tenant list.
3. Verify both `camp-cedar` and `camp-north` exist.
4. Use API calls to fetch both admin overviews with super admin token:
- `GET /api/t/camp-cedar/admin/overview`
- `GET /api/t/camp-north/admin/overview`

Expected:
- Super dashboard lists all tenants.
- Super admin can access both tenant overviews.

## 8. Export CSV/PDF Includes Only Tenant A Data
1. Log in as Cedar tenant admin.
2. Export CSV from `/t/camp-cedar/admin`.
3. Export PDF from `/t/camp-cedar/admin`.
4. Inspect outputs and compare against known North-only users.

Expected:
- CSV/PDF include Cedar profiles only.
- No North tenant records are present.
- File names include active tenant slug.

## Tenant Isolation Audit Checklist
- [ ] Every tenant-scoped query includes `tenantId`.
- [ ] Tenant-scoped routes use tenant guardrail helpers from `apps/api/src/db/tenantQuery.js`.
- [ ] Non-super users are denied when JWT tenant and route tenant mismatch.
- [ ] `super_admin` can cross tenant boundaries only through authorized endpoints.
- [ ] Exports and search endpoints are tenant-scoped.
- [ ] New tenant-scoped code passes lint rules that block raw model queries in tenant routes.
- [ ] Automated tenancy tests pass.
