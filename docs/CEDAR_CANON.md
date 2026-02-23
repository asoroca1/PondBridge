# Cedar Canon (Product Shell Baseline)

This document records the Camp Cedar canonical shell and the files now used as the single shared code path for all camps.

## Canon Routes (Tenant Scope)

Tenant-scoped routes are defined in `/Users/asoroca/Desktop/PondBridge System/pondbridge-platform/apps/web/src/App.jsx`.

- `/t/:slug/` (public entry)
- `/t/:slug/login`
- `/t/:slug/create-account`
- `/t/:slug/home`
- `/t/:slug/my-profile`
- `/t/:slug/edit-profile`
- `/t/:slug/search`
- `/t/:slug/profile/:id`
- `/t/:slug/admin`
- `/t/:slug/onboarding`
- `/super`

Compatibility redirects exist for legacy Cedar route names (`/main-home`, `/advanced-search`, `/directory`, `/onboarding/wizard`) and map into the canonical paths.

## Canon Shared Components

- Shell wrapper: `/Users/asoroca/Desktop/PondBridge System/pondbridge-platform/apps/web/src/components/AppShell.jsx`
- Shared navbar: `/Users/asoroca/Desktop/PondBridge System/pondbridge-platform/apps/web/src/components/NavBar.jsx`
- Shared footer: `/Users/asoroca/Desktop/PondBridge System/pondbridge-platform/apps/web/src/components/Footer.jsx`
- Tenant config + theme provider context: `/Users/asoroca/Desktop/PondBridge System/pondbridge-platform/apps/web/src/context/TenantContext.jsx`

Legacy Cedar navbar components now no-op and do not fork layout:

- `/Users/asoroca/Desktop/PondBridge System/pondbridge-platform/apps/web/src/cedar/components/Navbar1.jsx`
- `/Users/asoroca/Desktop/PondBridge System/pondbridge-platform/apps/web/src/cedar/components/Navbar2.jsx`
- `/Users/asoroca/Desktop/PondBridge System/pondbridge-platform/apps/web/src/cedar/components/NavbarPrelaunch.jsx`

## Canon Page Components

Primary Cedar experience pages still render from Cedar page files, but now inside the shared shell:

- Public Home: `/Users/asoroca/Desktop/PondBridge System/pondbridge-platform/apps/web/src/cedar/pages/Home.jsx`
- Logged-in Home (MainHome): `/Users/asoroca/Desktop/PondBridge System/pondbridge-platform/apps/web/src/cedar/pages/MainHome.jsx`
- Create Account/Profile: `/Users/asoroca/Desktop/PondBridge System/pondbridge-platform/apps/web/src/cedar/pages/CreateProfileWizard.jsx`
- Login: `/Users/asoroca/Desktop/PondBridge System/pondbridge-platform/apps/web/src/cedar/pages/Login.jsx`
- My Profile: `/Users/asoroca/Desktop/PondBridge System/pondbridge-platform/apps/web/src/cedar/pages/MyProfile.jsx`
- Edit Profile: `/Users/asoroca/Desktop/PondBridge System/pondbridge-platform/apps/web/src/cedar/pages/EditProfile.jsx`
- Advanced Search/Directory: `/Users/asoroca/Desktop/PondBridge System/pondbridge-platform/apps/web/src/cedar/pages/AdvancedSearch.jsx`
- View Profile: `/Users/asoroca/Desktop/PondBridge System/pondbridge-platform/apps/web/src/cedar/pages/PublicProfile.jsx`
- Admin Dashboard: `/Users/asoroca/Desktop/PondBridge System/pondbridge-platform/apps/web/src/pages/TenantAdminPage.jsx`

## Canon Theme Tokens and Defaults

Theme variables are applied centrally in `/Users/asoroca/Desktop/PondBridge System/pondbridge-platform/apps/web/src/context/TenantContext.jsx` and consumed in `/Users/asoroca/Desktop/PondBridge System/pondbridge-platform/apps/web/src/styles.css`.

- `--brand-primary`: `#135e8a`
- `--brand-secondary`: `#66a3c8`
- `--brand-accent`: `#f2b134`
- `--bg`: `#f3f7fb`
- `--text`: `#0f1720`
- `--card`: `#ffffff`
- `--font-display`: `"Roboto Slab", "Avenir Next", serif`
- `--font-body`: `"Inter", "Avenir Next", "Segoe UI", sans-serif`
- `--font-family`: body font token value
- `--hero-image-url`: tenant-provided hero image (fallback to Cedar image)

## Canon UX Patterns

- Fixed top nav with search/avatar/menu and role-aware actions.
- Full-bleed hero masthead on public/primary home.
- Card-based content blocks with Cedar spacing, borders, and shadows.
- Form grids and inline action rows (`.form-grid`, `.inline-actions`).
- Checklist/progress UI for onboarding with sticky side panels.
- Shared footer with About/Contact/Links from camp content config.

## Cedar-Specific Hardcoded Items Identified

These were the main Cedar-specific areas audited and moved to config-driven behavior:

- Network title and welcome copy in home/login/nav flows.
- Hero image/logo/color/font tokens.
- Contact email and legal copy references.
- Signup mode and launch gating logic.
- Feature/module visibility in nav and onboarding.

Remaining Cedar-branded areas are mostly intentional content modules (e.g., Cedar Chest label/content) and internal file/component names; they are not route/layout forks.
