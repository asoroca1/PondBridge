# Director Onboarding

## Purpose

The director onboarding flow configures `TenantConfig` for each camp while preserving the fixed Camp Cedar shell.

No layout variants are introduced. All camps use the same pages and components.

## Canonical Routes

- Super admin:
  - `/super/dashboard` (Operations Agent)
  - `/super/pulse` (full measured platform dashboard)
- Director claim:
  - `/t/:slug/director-claim?token=...`
- Onboarding:
  - `/t/:slug/onboarding` (guided launch workspace)
  - `/t/:slug/onboarding/details` (detailed setup center)
  - Legacy `/t/:slug/onboarding/wizard` redirects to the guided workspace.
- Billing:
  - `/t/:slug/admin/billing`

## End-to-End Flow

1. Super admin creates tenant with minimal fields and optional director email.
2. API returns director claim link.
3. Director opens claim link and continues to create account with invite token.
4. Director is forced into onboarding until tenant is launched.
5. The guided workspace explains live server readiness and links to the existing admin settings that update draft branding, content, access, modules, billing, and legal evidence. It also shows the same server-confirmed feature and service inventory as Director Settings, including Alumni Growth, module setup, plan locks, provider readiness, and AI rollout state. The guide never changes these values itself.
6. Recipient CSV files are previewed as invitations; they do not silently activate member accounts.
7. Launch is blocked until the server readiness contract passes, including billing and legal readiness.
8. Only a super admin can apply an explicit, audited launch override.

The workspace runs in deterministic guided mode for every director. An
off-by-default Director Copilot pilot can answer against the same aggregate
readiness evidence and create editable text drafts. It cannot accept legal
terms, change billing, send invitations, update settings, or launch the camp.

After launch, participation questions route directors to **Alumni Growth**. That
workspace stores tenant-scoped alumni emails before signup, shows the
known → invited → joined → active funnel, keeps invitation sending behind the
existing reviewed confirmation, and opens server-calculated welcome,
profile-completion, and re-engagement audiences in Communications Studio.

## Billing Gate Rules

Billing is considered ready when:

- `billingStatus` is `active` or `trialing`
- and onboarding fee is paid (or fee amount is `0`)

In `mock` billing mode (or as super admin), billing state can be updated via:

- `PATCH /api/tenants/me/billing`

## APIs Used

Public:

- `GET /api/public/tenant-config?slug=...`

Super admin:

- `POST /api/super/tenants`

Director auth:

- `POST /api/t/:slug/auth/invite/verify`
- `POST /api/t/:slug/auth/register`

Director onboarding:

- `GET /api/tenants/me/onboarding`
- `GET /api/t/:slug/admin/features`
- `PATCH /api/t/:slug/admin/features`
- `GET /api/t/:slug/admin/growth`
- `POST /api/t/:slug/admin/growth/contacts`
- `PATCH /api/t/:slug/admin/growth/contacts/:contactId`
- `PATCH /api/tenants/me/onboarding`
- `PATCH /api/tenants/me/theme`
- `PATCH /api/tenants/me/content`
- `PATCH /api/tenants/me/settings`
- `PATCH /api/tenants/me/modules`
- `POST /api/t/:slug/admin/invites/preview`
- `POST /api/t/:slug/admin/invites/send`
- `GET /api/tenants/me/billing`
- `PATCH /api/tenants/me/billing`
- `POST /api/tenants/me/launch`

## Local Test Steps

1. From repo root:
   - `cd "/Users/asoroca/Desktop/PondBridge System/pondbridge-platform"`
2. Install dependencies:
   - `npm install`
3. Seed data:
   - `npm --workspace @pondbridge/api run seed`
4. Start apps:
   - `npm run dev`

### Seeded Tenants

- Live Cedar tenant:
  - URL: `http://localhost:5173/t/cedar`
  - Admin: `admin@campcedar.local` / `Pondbridge123!`
- Draft tenant:
  - Create from super admin at `http://localhost:5173/super/dashboard`.
  - Use generated director claim link from the create-tenant workflow.

### Verify Flow

1. Sign in to draft tenant admin.
2. Confirm redirect to `/t/:slug/onboarding`.
3. Open the guided workspace and complete/save the linked setup sections. Use the detailed setup center when dense billing or preview evidence is needed.
4. Confirm all ten community modules and the full director toolkit appear in both onboarding and **Settings → Features & services**. Validate Alumni Growth storage, dependency, plan-lock, provider, and setup-required states.
5. Validate server readiness after each required section, including a valid URL for Merch Shop when that module is selected.
6. Preview an invitation CSV, review exclusions, and explicitly send to a mail sandbox.
7. Configure billing readiness from command center/billing page.
8. Review the live plan, open the separate launch confirmation, and launch from the guided workspace.
9. Confirm tenant status becomes live and admin dashboard is accessible.
10. Open **Alumni Growth**, save a pre-member address without sending, review an invitation, confirm signup conversion, and preview one server-owned engagement audience in Communications Studio.
11. Confirm non-admin signup is blocked before launch and enabled per configured signup mode after launch.
