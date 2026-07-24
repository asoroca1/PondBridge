# ADR 0005: AI-native director communications and delivery-provider strategy

Date: 2026-07-15

Status: Accepted for staged implementation

## Context

PondBridge already has a substantial Resend integration: transactional and
batch delivery, provider-confirmed scheduling and cancellation, idempotency,
tenant branding, suppressions, signed webhooks, and delivery analytics. A
provider rewrite would replace working infrastructure without fixing the main
director problems:

- campaign work starts in a long manual form instead of an outcome-oriented
  workflow;
- drafts, templates, and custom audiences are partly browser-local;
- broadcasts do not yet use a marketing-contact/topic abstraction;
- recipient opt-out, one-click unsubscribe, physical-address, and preflight
  requirements were incomplete;
- AI usage is not yet a durable tenant billable resource;
- no communications-specific assistant can create and improve editable drafts.

## Decision

1. Keep Resend as the primary provider for the fall rollout. Transactional mail
   stays on the current provider path. Marketing broadcasts will move behind a
   PondBridge marketing-provider adapter so Resend Contacts, Segments, Topics,
   Broadcasts, and Automations can be adopted without coupling the director UI
   to vendor objects.
2. Do not migrate to Amazon SES solely for lower unit cost. SES is inexpensive,
   but PondBridge would assume more deliverability, preference, campaign, and
   analytics infrastructure. Postmark remains a credible fallback provider if
   staging deliverability or account architecture gives evidence to change.
3. Make Communications Agent draft-only. It may create or improve subject,
   preheader, and body content. It may not send, schedule, select individual
   recipients, change preferences, or claim an action occurred. The existing
   explicit director send confirmation remains the mutation boundary.
4. Store a durable `ai_generations` row before every provider call. Store
   tenant, actor, feature, model, prompt version, hashes, byte counts, provider
   request ID, token usage, price version, and estimated micro-USD. Do not store
   raw prompts or generated copy in this ledger.
5. Require an allowlisted model price, tenant rollout, provider credentials,
   durable usage ledger, rate limit, and monthly camp budget before calling the
   provider. Any missing control fails closed.
6. Treat recipient preference as distinct from delivery suppression. A member
   preference cannot be lifted by a director. Marketing recipient previews and
   final delivery use the same eligibility calculation.
7. Every marketing broadcast includes a physical postal address, encrypted
   recipient preference link, RFC 8058-style one-click unsubscribe headers,
   and a deterministic server-side readiness check.

## Initial economics

The default communications model is GPT-5.6 Luna. The 2026-07-15 public price
schedule used by the ledger is $1.00 per million input tokens, $0.10 per million
cached input tokens, and $6.00 per million output tokens. A representative
2,000-input/1,000-output-token draft costs about $0.008. Terra would cost about
$0.020 for the same call and Sol about $0.040.

PondBridge should sell a simple AI Communications allowance or add-on rather
than expose sub-cent pass-through line items. Meter first, then set plan credits,
hard caps, and overage policy from observed staging/pilot use. The default local
control is a $25 monthly provider-cost cap per camp for this feature; it is not a
customer price.

## Rollout sequence

1. Apply `communications_system_schema.sql` only to an explicitly identified
   local/staging database and verify table, index, function, and service-only RLS
   evidence.
2. Configure a dedicated email preference token secret, public API origin,
   Resend staging domain/webhook, OpenAI staging key, and spend limit.
3. Run local deterministic tests and a provider-backed synthetic draft set.
4. Enable `director_email_agent_v1` for one non-control tenant. Cedar remains a
   control unless explicitly selected.
5. Exercise generate, revise, preview, test-send, unsubscribe, resubscribe,
   schedule, cancel, webhook, cost, budget, and kill-switch behavior.
6. Add server-persisted templates/audiences/draft version history and then adopt
   Resend marketing APIs behind the provider adapter.

## Consequences

- The product gains an AI-native workflow without granting autonomous outbound
  communication authority.
- Provider cost is attributable and can support high-margin packaging.
- Deployments must apply and verify the communications schema before enabling
  the feature.
- Existing camps remain unaffected until rollout records explicitly enable the
  agent, while the deterministic compliance gate applies to director marketing
  broadcasts once this code is deployed.
