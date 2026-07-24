# ADR 0002: Director Copilot Safety and Tool Contract

- Status: Accepted; read-only pilot foundation implemented locally
- Date: 2026-07-14
- Scope: Tenant-scoped director assistance

## Context

Directors repeat the same high-friction work during onboarding and weekly
operations: understanding launch blockers, cleaning invite files, checking
recipient selections, drafting announcements, and finding the right admin
screen. A copilot can reduce that burden, but an unrestricted chatbot would
create new tenant-boundary, privacy, authorization, and audit risks.

PondBridge already has the foundations the copilot must reuse:

- canonical tenant resolution and role enforcement;
- server-owned launch readiness and feature/module gates;
- staged invite previews and recipient previews;
- explicit product confirmations for destructive or external actions;
- tenant admin audit logs and request IDs.

## Decision

Build the copilot as a tenant-scoped orchestration layer over narrow PondBridge
tools. Do not give the model direct database access, raw SQL, arbitrary HTTP,
or provider credentials.

The first release is advisory and preview-first. It may read authorized tenant
state and produce drafts, explanations, checklists, and navigation links. It
must not send email, approve or deny access, activate imported members, change
billing, publish content, toggle modules, or delete data.

Any later mutation tool must use the existing authorized API operation and
require a separate, explicit confirmation in the product UI. A model message
such as “yes,” inferred intent, or a prior approval is not authorization.

### Model and API selection

The pilot uses OpenAI's Responses API with a configurable model and defaults to
`gpt-5.6-luna`, the efficient/high-volume member of the current GPT-5.6 family.
It uses strict JSON Schema tools, disables parallel tool calls, sends a stable
privacy-preserving safety identifier, sets `store: false`, and bounds provider
latency and output size. This follows the official
[model guidance](https://developers.openai.com/api/docs/guides/latest-model),
[function-calling guidance](https://developers.openai.com/api/docs/guides/function-calling),
and [production guidance](https://developers.openai.com/api/docs/guides/production-best-practices).

The model and API key are server-only environment configuration. A camp must be
explicitly included in the `director_copilot_v1` rollout cohort, and the server
must have a provider key, before the UI entry point appears.

## Tenant and authorization contract

1. Mount the API at `/api/t/:slug/admin/copilot/*`.
2. Resolve the tenant from the path and apply the existing tenant-admin role
   middleware before loading conversation or tool context.
3. Derive `tenantId` and actor identity exclusively from authenticated request
   context. Never accept a model-provided tenant ID or client override.
4. Every tool handler must receive a server-created context containing
   `tenantId`, `actorUserId`, `roles`, and `requestId`.
5. Every data query must use a tenant-scoped model method. Cross-tenant
   retrieval and shared vector indexes are out of scope for v1.
6. The feature is off by default and enabled only by a server-evaluated tenant
   rollout flag. Cedar remains a control tenant unless it is explicitly added
   to an approved test cohort.

## V1 tool allowlist

| Tool | Reads | Result | Mutation |
| --- | --- | --- | --- |
| `get_launch_readiness` | Server launch contract | Blockers, owner, and deep links | None |
| `get_director_action_queue` | Approvals, communications, billing, completion | Prioritized tasks with source timestamps | None |
| `preview_invite_csv` | Uploaded CSV through staged preview service | Invalid, duplicate, existing, and pending rows | None |
| `preview_email_recipients` | Existing recipient preview service | Counts, exclusions, and sample recipients | None |
| `draft_announcement` | Director prompt plus tenant terminology | Editable draft | None |
| `draft_email` | Director prompt plus approved tenant branding | Subject/body draft; no recipient action | None |
| `explain_admin_screen` | Curated route/help catalog | Explanation and tenant-safe deep links | None |

Tools return structured JSON with a short `summary`, `sourceUpdatedAt`, and
`links`. The UI renders source links beside the answer so directors can verify
the underlying system state.

## Approval boundary for later phases

Mutation tools, if added, use a two-step contract:

1. `prepare_*` returns a short-lived, signed preview containing exact scope,
   affected counts, validation warnings, and an expiry.
2. The product presents a normal confirmation dialog. Only an explicit click
   calls `execute_*` with the signed preview token.

Execution rechecks tenant, role, feature flag, preview expiry, and current
resource version. Material drift invalidates the preview and requires a new
review. High-risk operations such as tenant deletion, billing changes, access
decisions, and bulk communications remain human-only until a separate security
review approves them.

## Audit and observability

Record one tenant audit event per copilot run and tool call with:

- `requestId`, `conversationId`, `runId`, and tool call ID;
- tenant and actor from server context;
- tool name, policy decision, duration, and outcome;
- model identifier and prompt/tool-contract version;
- input/output hashes and size counts, not raw resume text, message bodies, or
  member PII;
- provider request ID, token usage, and estimated cost when available;
- confirmation preview ID and executing actor for future mutations.

The initial run record must be written durably before any provider request. If
that write, a tool audit, or the completion audit cannot be persisted, the run
fails closed with a service-unavailable response. Provider-backed assistance is
not allowed to operate without its audit trail.

Metrics must separate target and control tenants and include task completion,
director correction rate, tool failure rate, unsafe-action blocks, latency,
cost, and support deflection. Logs and traces must carry the HTTP request ID.

## Privacy and prompt-injection controls

- Send only the minimum fields needed for the selected tool.
- Treat member content, uploaded files, emails, and tenant copy as untrusted
  data, never as instructions.
- Keep system policy and tool schemas server-owned and versioned.
- Do not place API keys, access codes, invite tokens, password material, or
  private contact fields in model context.
- Do not store raw prompts or outputs by default. If conversation history is
  later retained, define retention, deletion, export, and admin visibility
  before enabling it.
- The pilot is single-turn. It sends the director request and the minimum
  aggregate camp context needed for the answer to OpenAI. PondBridge stores
  content hashes, byte counts, tool decisions, provider request IDs, token
  usage, latency, and outcome—not the raw prompt or answer.
- Run output through schema validation and safe rendering. Model-generated HTML
  is not rendered directly.

## Rollout sequence

1. Offline evaluation with synthetic tenants and adversarial prompts.
2. Internal staff tenant, read-only, with tool traces reviewed daily.
3. One opt-in pilot camp, still read-only, with an immediate server kill switch.
4. Small cohort expansion only after target/control metrics and support review.
5. Consider preview/execute mutation tools individually; never enable all
   mutations as one capability.

Rollback is one server-side flag change. Disabling the flag removes the UI
entry point and rejects copilot API requests without changing tenant data.

## Deferred decisions

- Conversation persistence and retention policy.
- Retrieval/indexing architecture beyond curated route/help content.
- Any mutation tool beyond preview generation.

## Implementation checkpoint

Implemented locally on 2026-07-14:

- tenant-admin-only `/api/t/:slug/admin/copilot/*` API;
- off-by-default, tenant-slug rollout cohort and server-side provider gate;
- read-only `get_launch_readiness`, `get_director_action_queue`, and
  `explain_admin_screen` tools;
- fail-closed, per-run and per-tool durable audit metadata without raw
  conversation text, including a run-start record before provider access;
- rate, timeout, tool-round, input, and output bounds;
- accessible director UI with read-only boundaries and PondBridge source links;
- privacy-safe workspace, question, refresh, launch-review, and categorized
  evidence events without question text or raw URLs;
- deterministic tests asserting sanitization, strict schemas, the mutation-free
  allowlist, privacy-preserving identifiers, and audit failure behavior; and
- an eight-case offline safety dataset plus an explicitly acknowledged,
  staging-URL-only provider evaluation runner documented in
  `docs/COPILOT_EVALUATION_RUNBOOK.md`.

Not yet complete: provider-backed staging execution of the adversarial cases,
live provider smoke testing, staging spend/rate limits, authenticated browser
QA, internal-staff review, or pilot-camp enablement. The feature must remain off
for all camps until those gates pass.
