# Director and Member Onboarding

Last reviewed: 2026-07-14

## Canonical director flow

The active workspace is `/t/:slug/onboarding`. Legacy wizard and admin onboarding
paths redirect there.

1. A global super admin creates the camp and receives its claim link.
2. The first verified director claims or creates the director membership.
3. Until launch, directors are routed to the guided launch workspace and ordinary member
   access remains blocked.
4. The director follows the live plan into the existing branding, welcome
   content, access, module, billing, and legal evidence screens.
5. The server returns readiness blockers after every saved change.
6. The director previews invitation recipients and explicitly sends invitations.
7. `POST /api/tenants/me/launch` succeeds only when the server-owned launch
   contract passes.

The saved onboarding draft and progress make the flow resumable after the
browser closes. The API, not the conversation or a client checklist, determines
launch readiness. The former dense Command Center remains at
`/t/:slug/onboarding/details`.

## Member acquisition

Direct member CSV activation and generated passwords are retired. The supported
bulk workflow is invitation-first:

1. Upload or paste recipient rows in Director Admin.
2. `POST /api/t/:slug/admin/invites/preview` validates the current recipients.
3. The response identifies invalid, duplicate, existing-user, and pending-invite
   rows and issues a short-lived signed preview token.
4. The director reviews the final audience.
5. `POST /api/t/:slug/admin/invites/send` requires that matching preview token
   before sending.
6. Each recipient creates and owns their account through the configured access
   policy.

Never upload a member export to Git or use a production database for onboarding
tests.

## Access policies

The server enforces `open`, access-code, approval, invite-only, and allowed-domain
rules. New camps should default to invitation or approval until the director has
reviewed their privacy requirements. UI visibility is not an access boundary.

## Canonical APIs

- `GET /api/tenants/me/onboarding`
- `PATCH /api/tenants/me/onboarding/draft`
- `PATCH /api/tenants/me/theme`
- `PATCH /api/tenants/me/content`
- `PATCH /api/tenants/me/settings`
- `PATCH /api/tenants/me/modules`
- `GET /api/tenants/me/billing`
- `POST /api/tenants/me/billing/checkout`
- `POST /api/tenants/me/launch`
- `POST /api/t/:slug/admin/invites/preview`
- `POST /api/t/:slug/admin/invites/send`

For the operational walkthrough and staging validation, see
`docs/DIRECTOR_ONBOARDING.md`.
