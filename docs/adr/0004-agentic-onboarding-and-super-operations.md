# ADR 0004: Agentic Director Onboarding and Super Operations

- Status: Accepted; local read-only foundations implemented
- Date: 2026-07-14
- Scope: Director onboarding and platform administration

## Context

Director onboarding and the super-admin console were organized around large
checklists, dashboards, and forms. Those screens exposed the underlying system,
but required users to know where to start, how status fields relate, and which
screen contains the evidence for a problem.

An agentic experience can provide a more useful front door, but chat must not
become a second authorization system. PondBridge handles identity, member data,
billing, legal acceptance, camp launch, communications, domain provisioning,
and destructive operations. A model must not infer approval for those actions.

## Decision

Use one shared interaction pattern on both surfaces:

1. **Conversation** explains current role-authorized state and produces editable
   drafts.
2. **Live plan** shows deterministic server evidence, independent of the model.
3. **Evidence links** open the existing PondBridge screen where a person can
   verify state and use normal authorized controls.

The default director route `/t/:slug/onboarding` is the guided workspace. The
former detailed Command Center remains available at
`/t/:slug/onboarding/details` for dense billing, checklist, and preview work.
The legacy wizard route continues to redirect to the guided workspace.

The default platform route `/super/dashboard` is the Operations Agent.
`/super/pulse` remains the complete measured dashboard. Super, support, and
finance roles receive different tools and evidence; the agent does not broaden
the role already established by server middleware.

Both workspaces have a useful deterministic guided mode when AI is disabled.
This avoids making provider availability a dependency for onboarding or
operations. AI mode is disclosed in the UI and remains off by default.

## Actions outside chat

The following remain normal product controls and are not model tools:

- signing in, claiming an account, or handling credentials;
- entering payment details or changing a Stripe subscription;
- accepting legal terms or privacy agreements;
- launching a camp network;
- sending invitations or email;
- approving or denying members;
- changing camp access, modules, branding, domains, or platform settings;
- creating, disabling, resetting, or deleting a camp;
- retrying provider work or executing any destructive operation.

Director launch uses the existing server readiness contract and a separate
confirmation dialog. Billing redirects to Stripe or the existing billing
screen. Super-admin mutations stay in existing role-protected forms and
dialogs. A chat message is never an approval.

The pre-authentication director account flow remains a structured form because
it handles identity, credentials, legal disclosures, and billing. It may later
receive non-AI progressive guidance, but it must not send secrets or payment
material to a model.

## Assistant separation

Director Copilot is tenant-scoped and mounted at
`/api/t/:slug/admin/copilot/*`. Its server context derives camp and actor from
authenticated middleware. The UI can read launch readiness, explain director
screens, and request editable text. Existing ADR 0002 remains authoritative for
its tenant and privacy controls.

Operations Agent is platform-scoped and mounted at `/api/super/copilot/*`.
Its v1 tools are read-only:

| Role | Allowed investigation tools |
| --- | --- |
| Super admin | Platform pulse, camp search, camp health, screen explanation |
| Support admin | Platform pulse, camp search, camp health, screen explanation |
| Finance admin | Camp search, camp billing, finance-authorized screen explanation |

The Operations Agent cannot call any tenant mutation route. Model tool names
are checked against a server-side role allowlist before execution.

## Provider and audit contract

Both assistants use the OpenAI Responses API only when their server-side gates
are enabled and a server-only API key is configured. Tools use strict JSON
Schemas, parallel tool calls are disabled, output and latency are bounded, and
requests use `store: false` plus a privacy-preserving safety identifier.

Director runs write to tenant admin audit logs. Platform runs write to the
service-role-only `platform_admin_audit_logs` table. Records include actor,
request/run identifiers, model and contract versions, tool policy decisions,
duration, hashes, byte counts, provider IDs, and aggregate usage. Raw questions
and answers are not retained.

Each assistant must persist a run-start record before contacting the provider.
If any required run or tool audit cannot be written, the assistant fails closed
instead of making an unaudited provider request or returning an unaudited
result. Workspace analytics use a fixed event/target allowlist and never retain
question text or arbitrary link values.

## Rollout gates

1. Apply and verify the new platform audit table and indexes in staging.
2. Run synthetic tool-selection, prompt-injection, role-boundary, and
   cross-tenant isolation evaluations using
   `docs/COPILOT_EVALUATION_RUNBOOK.md`.
3. Configure a separate staging provider project with rate and spend limits.
4. Complete desktop, tablet, mobile, keyboard, and screen-reader browser QA.
5. Enable the platform assistant for internal super admins only.
6. Enable Director Copilot for an internal tenant, then one opt-in camp.
7. Review traces daily and compare completion, correction, latency, cost,
   support load, and unsafe-action blocks before cohort expansion.

Provider-backed AI remains disabled until these gates pass. Guided mode and all
existing evidence/action screens continue to work when the gates are off.

## Implementation checkpoint

Implemented locally on 2026-07-14:

- both agent workspaces and their deterministic guided fallbacks;
- strict, role-scoped, read-only tools and evidence-link boundaries;
- fail-closed durable audits written before provider access;
- privacy-safe workspace, question, evidence, and refresh telemetry;
- an eight-case offline adversarial dataset and contract evaluator; and
- an opt-in provider evaluator that requires separate staging role tokens, an
  explicit acknowledgement, and a local or staging-labeled URL.

No provider-backed staging evaluation, production feature enablement, or camp
cohort change has been performed.

## Deferred work

- Persistent conversation history, including retention/export/deletion policy.
- Preview/execute tools for any mutation; each requires its own threat model and
  approval design.
- File-based invite cleanup, recipient preview, and support triage tools.
- Director onboarding analytics and target/control experiment dashboards.
