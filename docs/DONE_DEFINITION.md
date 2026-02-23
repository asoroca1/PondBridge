# Done Definition

- [x] Cedar tenant renders through the canonical shared shell (`AppShell + NavBar + Footer`) with Cedar default branding values.
- [x] New camps render the same layout/routes/components and differ only via `TenantConfig` values.
- [x] No per-camp route/layout forks were added; one tenant code path is used in `/t/:slug/*`.
- [x] Customization inputs flow through `TenantConfig` domains: branding, content, access rules, modules.
- [x] Directors can configure branding/content/access/modules in onboarding wizard and launch from the final review step.
- [x] Launch gates are enforced: non-live camps block non-director signup/login and directors are routed to onboarding until launch.
