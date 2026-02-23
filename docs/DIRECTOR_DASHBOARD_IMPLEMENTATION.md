# Director Dashboard Implementation (Spec Pass)

Source spec: `/Users/asoroca/Downloads/director_dashboard_spec.docx`

## Scope implemented

The director-facing admin console is now implemented as a tenant-scoped section under:

- `/t/:slug/admin/dashboard`
- `/t/:slug/admin/members`
- `/t/:slug/admin/members/approvals`
- `/t/:slug/admin/members/import`
- `/t/:slug/admin/email/compose`
- `/t/:slug/admin/email/history`
- `/t/:slug/admin/analytics`
- `/t/:slug/admin/features`
- `/t/:slug/admin/billing`
- `/t/:slug/admin/settings/network`
- `/t/:slug/admin/settings/branding`
- `/t/:slug/admin/settings/access`
- `/t/:slug/admin/settings/admins`
- `/t/:slug/admin/settings/notifications`
- `/t/:slug/admin/settings/danger`

All routes are role-gated (`tenant_admin`, with `super_admin` bypass), tenant-scoped, and rendered inside the existing network shell.

## Frontend files

- `apps/web/src/pages/admin/DirectorAdminLayout.jsx`
- `apps/web/src/pages/admin/DirectorAdminPages.jsx`
- `apps/web/src/App.jsx` (route wiring + legacy redirects)
- `apps/web/src/styles.css` (director admin visual system under `.pb-cedar-page`)

## Backend files

- `apps/api/src/routes/admin.js`
- `apps/api/src/routes/tenantAuth.js`
- `apps/api/src/services/email.js`

## API surface added for director admin

- `GET /api/t/:slug/admin/dashboard`
- `GET /api/t/:slug/admin/members`
- `GET /api/t/:slug/admin/members/template.csv`
- `PATCH /api/t/:slug/admin/members/:profileId`
- `POST /api/t/:slug/admin/members/bulk-action`
- `GET /api/t/:slug/admin/members/approvals`
- `POST /api/t/:slug/admin/members/approvals/:requestId/approve`
- `POST /api/t/:slug/admin/members/approvals/:requestId/deny`
- `GET /api/t/:slug/admin/email/history`
- `GET /api/t/:slug/admin/email/history/:broadcastId`
- `POST /api/t/:slug/admin/email/recipients-preview`
- `POST /api/t/:slug/admin/email/test`
- `POST /api/t/:slug/admin/email/send`
- `GET /api/t/:slug/admin/analytics/network`
- `GET /api/t/:slug/admin/features`
- `PATCH /api/t/:slug/admin/features`
- `GET /api/t/:slug/admin/billing`
- `GET /api/t/:slug/admin/settings`
- `PATCH /api/t/:slug/admin/settings/identity`
- `PATCH /api/t/:slug/admin/settings/branding`
- `PATCH /api/t/:slug/admin/settings/access`
- `GET /api/t/:slug/admin/settings/admins`
- `POST /api/t/:slug/admin/settings/admins/invite`
- `DELETE /api/t/:slug/admin/settings/admins/:userId`
- `PATCH /api/t/:slug/admin/settings/notifications`
- `POST /api/t/:slug/admin/settings/pause`
- `POST /api/t/:slug/admin/settings/delete-request`

## Key behaviors now in place

- Admin sidebar/sub-nav + breadcrumb + back-to-network link.
- Dashboard overview cards, quick actions, recent activity.
- Members table with search/filter/sort/pagination, bulk actions, inline edit modal.
- Approval queue with approve/deny actions and access-policy-aware visibility.
- Import flow with template download, upload, results, and import history.
- Email compose, targeting preview, test send, send/schedule scaffold, and history/detail modal.
- Analytics overview metrics, feature usage bars, active members table, email performance table.
- Feature/module toggles with server-side tier locks and newsletter display name override.
- Billing summary + Stripe portal launcher + trial/past-due banners.
- Settings tabs for identity, branding, access policy, admins, notifications, and danger zone.
- Access-request record creation for `approval_queue` signup mode (instead of hard rejection).

## Validation run

- `npm run lint` passes for all workspaces.
- `npm run build` passes for all buildable workspaces.

## Known follow-up items (non-blocking)

- Email composer currently uses textarea-based body editing (not rich text editor yet).
- Import currently accepts CSV flow only (xlsx UX not implemented yet).
- Billing invoices list is scaffolded unless Stripe invoice sync is wired in environment.
