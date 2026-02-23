# Cedar Alumni Technicality Audit

## Scope
This audit compares the original Cedar app import at:
- `/Users/asoroca/Desktop/PondBridge System/pondbridge-platform/_import/cedar-original/camp-cedar-alumni-network-frontend/src`

against the current Cedar-backed multi-tenant shell at:
- `/Users/asoroca/Desktop/PondBridge System/pondbridge-platform/apps/web/src/cedar`
- `/Users/asoroca/Desktop/PondBridge System/pondbridge-platform/apps/web/src`

Focus was on alumni-network technical details: fonts, animations, button behavior, page structure, and feature behavior parity.

## Method
1. File map comparison (`find`, `diff -qr`) between original Cedar frontend and current `/apps/web/src/cedar`.
2. Byte/hash parity checks for Cedar CSS + assets (PNG/JPG/SVG).
3. JSX diff review for every changed Cedar page/component.
4. Style load-order and route-shell inspection in runtime entrypoints (`main.jsx`, `App.jsx`, `AppShell.jsx`).
5. Validation via lint/build.

## Objective Results
- CSS parity: **11/11 files identical** between original and current `/apps/web/src/cedar`.
- Asset parity: **6/6 files identical** between original and current `/apps/web/src/cedar`.
- JSX parity: **23/32 files intentionally changed** (tenantization + API pathing + onboarding integration).

## What Was Confirmed As Matching Cedar
- Core Cedar typography rules in Cedar CSS remain intact (Inter body, Roboto Slab display via defaults).
- Cedar button classes and transitions remain intact (`.home1-btn`, `.login1-btn`, `.wizard1-btn-*`, `.btn-*`).
- Cedar page-specific CSS for alumni pages remains intact (`main-home.css`, `my-profile.css`, `chats.css`, etc.).
- Cedar media assets (logos/backgrounds/profile defaults) are unchanged.

## High-Sensitivity Parity Drift Found
1. Default theme baselines were non-Cedar in multiple places (green/teal defaults).
2. Original route transition shell existed in CSS but was not active in main app router.
3. Authenticated nav lost legacy Merch Shop entry.
4. Public nav controls included extra account UI controls vs original Cedar public behavior.

## Fixes Applied In This Pass

### A) Cedar baseline color defaults normalized to navy/gray/white
Updated defaults to Cedar baseline for new tenants and fallback rendering:
- `/Users/asoroca/Desktop/PondBridge System/pondbridge-platform/apps/api/src/models/Tenant.js`
- `/Users/asoroca/Desktop/PondBridge System/pondbridge-platform/apps/api/src/services/onboarding.js`
- `/Users/asoroca/Desktop/PondBridge System/pondbridge-platform/packages/shared/src/index.js`
- `/Users/asoroca/Desktop/PondBridge System/pondbridge-platform/apps/web/src/context/TenantContext.jsx`
- `/Users/asoroca/Desktop/PondBridge System/pondbridge-platform/apps/api/scripts/seed.js`
- `/Users/asoroca/Desktop/PondBridge System/pondbridge-platform/apps/web/src/pages/TenantAdminPage.jsx`
- `/Users/asoroca/Desktop/PondBridge System/pondbridge-platform/apps/web/src/pages/DirectorOnboardingCommandCenterPage.jsx`
- `/Users/asoroca/Desktop/PondBridge System/pondbridge-platform/apps/api/src/routes/admin.js` (PDF export accent color)

### B) Route transition behavior restored
Re-enabled original Cedar-style route shell/progress behavior in primary app router:
- `/Users/asoroca/Desktop/PondBridge System/pondbridge-platform/apps/web/src/App.jsx`

### C) Nav behavior parity improvements
- Re-added Merch Shop item for authenticated nav (module-aware, tenant URL-aware).
- Removed unauthenticated avatar/burger controls from global nav for cleaner Cedar-like public surface.
- File:
  - `/Users/asoroca/Desktop/PondBridge System/pondbridge-platform/apps/web/src/components/NavBar.jsx`

### D) Onboarding color consistency hardening
Ensured account-step brand override remains stable when tenant theme arrives async:
- `/Users/asoroca/Desktop/PondBridge System/pondbridge-platform/apps/web/src/pages/DirectorCreateAccountPage.jsx`

## Remaining Intentional Differences (Not Bugs)
1. Cedar page JSX is tenantized:
- Cedar hardcoded labels replaced with TenantConfig-driven labels (newsletter name, role labels, camp-specific copy).

2. API paths are tenant-scoped:
- Original `.../api/...` call paths changed to scoped compat paths for multi-tenant behavior.

3. Routing aliases:
- Legacy Cedar routes still map, but canonical app paths are now `/t/:slug/...` (`/home`, `/search`, etc.).

4. Navbar component consolidation:
- Original Cedar `Navbar1` / `Navbar2` / `NavbarPrelaunch` files are stubs in `/apps/web/src/cedar/components`.
- Runtime nav is provided by `/apps/web/src/components/NavBar.jsx` through `/apps/web/src/components/AppShell.jsx` to keep one tenant-aware navbar code path.

## Validation
Executed successfully:
- `npm run -s lint --workspace @pondbridge/api`
- `npm run -s lint --workspace @pondbridge/web`
- `npm run -s build --workspace @pondbridge/web`

## Recommended Visual/Behavior Check List
1. Public home/login typography and spacing match Cedar baseline.
2. Navbar primary tone defaults to navy before design customization.
3. Button hover/press states match Cedar interactions.
4. Route transitions (fade/progress) occur on page navigation.
5. Authenticated dropdown includes Merch Shop when module is on.
6. Newsletter label reflects tenant-configured name across nav + home + newsletter page.
