# Provider Integration Status

Last verified: 2026-07-23

This is the operational source of truth for PondBridge's connected production
providers and Codex connectors. A connector being installed does not mean the
runtime integration is configured; both are recorded separately below.

## Production runtime

| Provider | Runtime state | Evidence | Remaining action |
| --- | --- | --- | --- |
| Cloudflare Pages/DNS | Healthy | `pondbridge` and `pondbridge-landing` latest deployments report success; the `pondbridgealumni.com` zone is active and routes app/API/landing traffic correctly. | Review and remove obsolete explicit test/demo DNS records after owner confirmation; the wildcard already covers camp subdomains. |
| Cloudflare R2 | Healthy | `pondbridge-media` exists and the production health endpoint reports storage configured. | Run a signed upload/download smoke test in staging and on a signed iOS build. |
| Supabase | Healthy but shared | Project `wkyjhmggkujsepafbplv` is active in `us-west-2`; the read-only tenant-domain audit passes for all 11 camps. | Keep production writes gated. Nine rollout tables and the security/performance hardening migrations remain unapplied. The project also contains 21 non-PondBridge tables with permissive authenticated policies; ownership must be resolved before touching them. |
| Stripe | Healthy | The PondBridge live account has one enabled signed webhook covering every event consumed by the billing service, four active annual prices, and the Institutional onboarding price. An invalid-signature probe reached signature verification, proving the production webhook secret is present. | Exercise checkout, portal, payment failure, renewal, and cancellation with a staging/test customer. Replace the broad live secret with a least-privilege restricted key after reviewing Workbench requests. |
| Resend | Healthy | `pondbridgealumni.com` is verified with sending enabled; one enabled webhook targets the production API and subscribes to delivery, failure, suppression, complaint, bounce, and click events. `RESEND_WEBHOOK_SECRET` is stored on `pondbridge-api`; Render deployment `dep-d9havemq1p3s739j7br0` is live. An invalid-signature probe returned `WEBHOOK_SIGNATURE_INVALID`, and a correctly signed untracked verification event returned `200` without sending email or writing campaign activity. | Exercise a real staging campaign through sent/delivered/bounce/unsubscribe correlation. Decide whether click tracking should be enabled per marketing broadcast; it is currently disabled at the domain. |
| Clerk | Healthy | The production Clerk instance now has a Svix webhook application and one endpoint at `https://api.pondbridgealumni.com/api/webhooks/clerk`, subscribed only to `email.created`. `CLERK_WEBHOOK_SIGNING_SECRET` is stored on `pondbridge-api`; Render deployment `dep-d9hb2lt8nd3s73clqorg` is live. Invalid and correctly signed untracked-event probes returned `400` and `200` respectively. | Run one fresh-camp production-shaped signup in isolated staging and confirm the real `email.created` payload produces exactly one branded Resend verification email. |
| OpenAI | Credential live; rollouts gated | The project-scoped key is stored in the ignored root `.env.local` and on Render's `pondbridge-api` service without being printed or committed. A direct authenticated API probe returned `200`; Render deployment `dep-d9hc41favr4c73ea0g20` is live and the production health endpoint remains `200`. The GPT-5.6 Luna/Terra role split, Responses API usage, safety identifiers, token-price ledger, local schemas, and offline safety evaluations pass. All camp AI rollouts remain off. | Set a conservative OpenAI project spend limit, run the guarded provider evaluation against isolated synthetic staging, and enable one synthetic target camp only after the audit/rollout schemas and kill switch are verified there. |
| Apple Push Notification service | Not configured | APNs key, team ID, and private key are absent. | Add a production APNs signing key to Render and validate registration/delivery on a signed physical iPhone before TestFlight rollout. |
| Firebase Cloud Messaging | Parked | Credentials are absent. | No action until Android work resumes. |

## Codex connectors

| Connector | State | What it enables |
| --- | --- | --- |
| Supabase | Connected | Project inventory, read-only SQL/advisors, logs, migrations, branches, and reviewed schema operations. |
| Stripe | Connected | Live account inspection and future reviewed billing operations. The connector's generic OpenAPI search currently fails to discover list operations, so live inventory was verified with the existing server-side credential without exposing it. |
| Resend | Connected | Domain, webhook, contact, broadcast, template, and delivery-log operations. It resolves the same domain/webhook used by production. |
| Cloudflare | Connected | Pages, DNS, R2, and account API operations. |
| GitHub | Installed but unauthorized | The connector returns zero repositories. Authorize the PondBridge repository before relying on PR, CI, issue, or release workflows. |
| Render | Connected | A dedicated Codex Render API key is stored in macOS Keychain, the hosted `https://mcp.render.com/mcp` server is registered globally, and the connector exposes all five Render services, including `pondbridge-api`. Live environment updates, deployment inspection, metrics, and logs were verified while wiring the Resend webhook secret. |
| Google Drive | Connected | Useful for director-import source files, rollout evidence, and operating documents; it is not a runtime dependency. |
| Vercel | Connected but unused | PondBridge production uses Cloudflare Pages and Render, so Vercel should not become a second deployment control plane. |

## Deployment configuration changes

- `render.yaml` now declares the complete production provider contract:
  OpenAI models/budgets, canonical live Stripe price IDs, Resend delivery and
  webhook settings, Clerk secrets/claims, R2 limits, Cloudflare controls, and
  APNs credentials.
- Secret values remain `sync: false`; no secret is committed to source.
- Root and API environment examples now describe the same Resend signing,
  retry, suppression, preference-link, and batch settings.

## Recommended next Codex plugins

1. **Slack** — highest operational value. Route deploy failures, webhook
   failures, payment failures, bounce/complaint spikes, and weekly camp-health
   digests to one internal channel. Codex can then investigate alerts with the
   existing provider connectors.
2. **Figma** — connect product designs, component states, responsive behavior,
   and accessibility annotations to the ongoing UI overhaul.
3. **Outlook Email** — PondBridge DNS currently points business mail to
   Microsoft 365. Use this rather than installing both email connectors for
   support triage, deliverability checks, and director communication QA.
4. **Outlook Calendar** — use the matching calendar connector for camp launch
   calls, onboarding milestones, training, and rollout rehearsals.
5. **Notion** *or* **Atlassian Rovo** — choose one operating knowledge system.
   Notion is the simpler fit for runbooks, decisions, rollout checklists, and
   camp playbooks; choose Rovo only if PondBridge commits to Jira/Confluence.
6. **Teams/SharePoint** — add later when Microsoft-heavy camp customers need
   shared implementation rooms or document libraries. They are not required
   for the initial internal operating stack.

Box is low priority because Google Drive is already connected. Gmail and Google
Calendar would duplicate the Microsoft 365 mail/calendar path visible in DNS;
install them only if PondBridge deliberately moves its operating inbox and
calendar to Google Workspace.
