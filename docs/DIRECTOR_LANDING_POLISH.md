# Director Landing Polish

## Scope
Polish only the director claim landing flow and shared product header/footer used by that route. No Cedar page layouts were changed.

## File Map (Focused)
- Director claim page: `apps/web/src/pages/DirectorClaimPage.jsx`
- Product header: `apps/web/src/components/ProductHeader.jsx`
- Product footer: `apps/web/src/components/ProductFooter.jsx`
- Product onboarding styles: `apps/web/src/styles/productOnboarding.css`
- Product layout routing hook: `apps/web/src/components/AppShell.jsx`

## Cedar Typography Source (Authoritative)
- Tenant theme font tokens are set in `apps/web/src/context/TenantContext.jsx:6-37`:
  - `--font-display`: `"Roboto Slab", "Avenir Next", serif`
  - `--font-body`: `"Inter", "Avenir Next", "Segoe UI", sans-serif`
- Global body font uses Cedar token in `apps/web/src/styles.css:16-22`:
  - `body { font-family: var(--font-body, "Inter", sans-serif); }`

## What Was Wrong Before This Pass
- Hero area was too tall and read like a marketing hero instead of product onboarding.
- Product footer had too much vertical footprint versus Cedar-style product screens.
- Typography was close, but not consistently enforced across product shell areas.
- Director claim page lacked the secondary route and onboarding helper microcopy requested for this pass.

## Changes Implemented
### 1) Director Claim Content + Flow
Updated `apps/web/src/pages/DirectorClaimPage.jsx`:
- Kept generic headline unchanged: “Welcome to the future of your camp's alumni network.”
- Added secondary route back:
  - Primary: `Create director account` (preserves `inviteToken`)
  - Secondary: `I already have an account` (routes to `/t/:slug/login` with `inviteToken` when present)
- Added invite microcopy line when invite email exists:
  - `Invite prepared for: ...`
- Added helper line:
  - `This setup usually takes about 10-15 minutes.`

### 2) Hero Spacing Tightened (Less Marketing, More Product)
Updated `apps/web/src/styles/productOnboarding.css`:
- Reduced claim section vertical height and padding:
  - `min-height` lowered to `clamp(320px, calc(100dvh - 360px), 540px)`
  - page padding reduced for tighter rhythm
- Reduced card padding and aligned radius/shadow closer to Cedar cards:
  - card radius `14px`
  - button radius `10px`
  - shadow switched to subtle Cedar-like shadow scale

### 3) Product Footer Polish + Reduced Footprint
Updated `apps/web/src/styles/productOnboarding.css` (affects only `ProductFooter`):
- Footer inner padding reduced (`22px 24px 14px`) and gap reduced (`18px`)
- Bottom legal row padding reduced (`12px 24px 16px`)
- Kept 3-column product footer structure:
  - PondBridge descriptor
  - Product links (Security, Support, Status)
  - Contact (support email)
- Kept legal line:
  - `© {year} PondBridge. All rights reserved.`

### 4) Cedar Font Consistency Applied
Updated `apps/web/src/styles/productOnboarding.css`:
- Enforced Cedar font tokens across product shell elements:
  - `.product-app-shell`, `.product-header`, `.product-claim-page`, `.product-footer` use `var(--font-body, ...)`
  - Brand wordmark + major heading use `var(--font-display, ...)`
- Matched Cedar-like type scale/weight:
  - Hero heading uses tighter display sizing/letter spacing
  - Body text and button text use Inter scale and weight aligned with Cedar UI conventions

### 5) Responsive Behavior
- `1440px`: centered card, balanced hero spacing, inline actions.
- `768px`: reduced card/page padding, footer stacks to one column.
- `390px`: action buttons stack full width (`@media (max-width: 540px)`), compact spacing preserved.

## Verification
- `npm run -s lint --workspace @pondbridge/web` passed.
- `npm run -s build --workspace @pondbridge/web` passed.
