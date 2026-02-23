# Director Landing Page Dial-In

## Step 1 Audit

### Relevant File Paths

- Claim page:
  - `apps/web/src/pages/DirectorClaimPage.jsx`
- Global tenant shell:
  - `apps/web/src/components/AppShell.jsx`
- Existing global header/footer (camp shell):
  - `apps/web/src/components/NavBar.jsx`
  - `apps/web/src/components/Footer.jsx`
- Shared app styles:
  - `apps/web/src/styles.css`

### What Was Wrong

- Header: claim page was still inheriting the global camp navbar, which includes camp network branding and user/navigation controls.
- Footer: claim page was inheriting or conditionally mutating the global camp footer, not a dedicated product onboarding footer.
- Layout: claim page styling was mixed into global style rules and route conditionals, instead of clean reusable onboarding components.
- Copy/microcopy: did not match the desired welcome/setup language and expired-link messaging.

### What We Changed

- Introduced reusable product onboarding chrome components:
  - `apps/web/src/components/ProductHeader.jsx`
  - `apps/web/src/components/ProductFooter.jsx`
- Updated shell routing behavior in `AppShell`:
  - `director-claim` now uses product-only layout (`ProductHeader` + `ProductFooter`), not `NavBar` + `Footer`.
- Rebuilt `DirectorClaimPage` to use a single centered onboarding card with clear CTAs and invite details.
- Added dedicated onboarding styling tokens and classes in:
  - `apps/web/src/styles/productOnboarding.css`
- Loaded onboarding styles via:
  - `apps/web/src/main.jsx`
- Reverted global `NavBar`/`Footer` claim-specific hacks so standard camp pages stay canonical.

## Implementation Summary

### New Components

- `ProductHeader`:
  - Left aligned `PondBridge` brand text only.
  - No right-side navigation/actions.
- `ProductFooter`:
  - 3 lightweight columns (PondBridge descriptor, product links, contact).
  - Minimal product links: Security, Support, Status.
  - Copyright row.

### Claim Page UX

- Headline:
  - `Welcome, {CampName}.`
  - Fallback: `Welcome to PondBridge.`
- Body:
  - `Create your director account to start setup. You'll be guided through branding, access settings, importing alumni, and launching your network.`
- Invite line (if present):
  - `Invite prepared for: {email}`
- CTA buttons:
  - Primary: `Create director account`
  - Secondary: `I already have an account`
- Helper copy:
  - `This setup usually takes about 10-15 minutes.`
- Expired/invalid state:
  - `This setup link has expired.`
  - `Request a fresh link from PondBridge support.`
  - `Contact support` action.

## Routing + Token Handling

- Primary CTA keeps existing flow:
  - routes to `/t/:slug/create-account?inviteToken=...`
- Secondary CTA:
  - routes to `/t/:slug/login?inviteToken=...`
- Tenant slug scoping remains intact (`/t/:slug/...`) and invite token is preserved.

## Styling Notes (Cedar-Aligned Product Vibe)

- Added product-onboarding tokens in one file (`productOnboarding.css`).
- Kept typography families aligned with existing app variables.
- Used soft radius/shadow, subtle borders, navy/gray/white palette.
- Buttons reuse existing `@pondbridge/ui` button primitives with tuned claim-page styling.

## Acceptance Checklist

- [x] Claim page uses ONLY `ProductHeader`, single onboarding card, and `ProductFooter`.
- [x] Global camp `NavBar` and global camp `Footer` are not used on this page.
- [x] Header shows only `PondBridge` (no extra nav controls).
- [x] Card includes welcome by camp name with fallback.
- [x] Invite email line appears when invite email exists.
- [x] Primary/secondary actions preserve slug and token context.
- [x] Expired/invalid token state shows clean error card + support CTA.
- [x] Layout is responsive and intentional for desktop and tablet/mobile.

## Suggested Screenshot Checks

1. Desktop 1440px:
   - `/t/{your-slug}/director-claim?token={valid-token}`
2. Tablet 768px width:
   - same URL, verify card spacing and button wrapping.
3. Invalid token:
   - `/t/{your-slug}/director-claim?token=bad-token`
4. Camp fallback state:
   - verify fallback headline if tenant name is unavailable.
