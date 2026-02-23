# Director Create Account V1

## Scope
Implemented a dedicated Director Create Account step for the claim flow only, with the same product shell (`ProductHeader` + `ProductFooter`) and Cedar form styling patterns.

## Step 1 Audit: Cedar Form References Reused

### Directory focus
- `apps/web/src/pages`
- `apps/web/src/components`
- `apps/web/src/styles.css`
- `apps/web/src/styles/productOnboarding.css`
- `apps/web/src/cedar/pages/CreateProfileWizard.jsx`

### Cedar source page + classes
Reference page:
- `apps/web/src/cedar/pages/CreateProfileWizard.jsx`

Reference style definitions:
- `apps/web/src/styles.css:711-728`
  - `.wizard1-card`
  - `.wizard1-grid`, `.wizard1-gap`, `.wizard1-span-*`
  - `.wizard1-field`, `.wizard1-label`, `.wizard1-input`, `.wizard1-error`, `.wizard1-hint`
- `apps/web/src/styles.css:1023-1028`
  - `.wizard1-actions`, `.wizard1-actions-right`
  - `.wizard1-btn-primary`, `.wizard1-btn-secondary`
- `apps/web/src/styles.css:1882-2004`
  - `.pb-cedar-page` typography + form baseline
  - `.pb-cedar-page .form-grid`, label tone, error/success text patterns

Evidence of class usage in Cedar create flow:
- `apps/web/src/cedar/pages/CreateProfileWizard.jsx:1090-1183`
- `apps/web/src/cedar/pages/CreateProfileWizard.jsx:2226-2239`

## What was implemented

### New route + page
- New page file:
  - `apps/web/src/pages/DirectorCreateAccountPage.jsx`
- New route:
  - `/t/:slug/director-create-account`
  - wired in `apps/web/src/App.jsx`

### Landing CTA wiring
- Director claim CTA now routes to the new page and preserves invite token:
  - `apps/web/src/pages/DirectorClaimPage.jsx`
  - `/t/:slug/director-create-account?inviteToken=...`

### Product shell usage
- Product-only layout now applies to this new page too:
  - `apps/web/src/components/AppShell.jsx`
  - added matcher: `"/director-create-account"`

## Form behavior implemented

Fields:
1. First name
2. Last name
3. Email
4. Password
5. Confirm password
6. Camp name

Behavior:
- Invite token is read from `inviteToken` or `token` query param.
- Invite is verified via `POST /api/t/:slug/auth/invite/verify`.
- If invite email exists:
  - email is prefilled
  - email input is disabled
  - helper note shown: “This invite is tied to ...”
- Camp name:
  - prefilled from tenant name when present
  - disabled when tenant name already exists
  - editable only when missing
- Inline validation errors shown per field using Cedar error class style.
- Submit button disables while saving and shows loading text.
- Secondary actions:
  - `Back` returns to claim page with token context
  - “Already have an account? Log in” routes to login with token context

Success behavior:
- On successful account creation, auth token/user are stored via existing auth context
- Redirect to `/t/:slug/onboarding`

## Backend integration (minimal, real)

Endpoint reused:
- `POST /api/t/:slug/auth/register`
- file: `apps/api/src/routes/tenantAuth.js`

Enhancements added for director invite flow:
- Detects director claim via invite role (`tenant_admin`)
- If tenant name is missing and `campName` provided, updates tenant name
- If onboarding is not live, sets `onboardingStatus` to `in_progress`
- Response now includes a `tenant` object (`id`, `slug`, `name`, `onboardingStatus`) in addition to token/user/profile

## Styling updates
- `apps/web/src/styles/productOnboarding.css`
  - Added `product-director-create-*` classes for card spacing/width and responsive tuning
  - Kept existing landing page visual system (background, typography, shell)
  - Form internals use Cedar classes from `styles.css` (`wizard1-*` + `pb-cedar-page`)

## Verification
- `npm run -s lint --workspace @pondbridge/web` passed
- `npm run -s lint --workspace @pondbridge/api` passed
- `npm run -s build --workspace @pondbridge/web` passed
