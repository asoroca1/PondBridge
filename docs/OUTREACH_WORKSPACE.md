# Outreach knowledge

PondBridge's operator-only outreach tables are the durable source of truth for
fall-launch prospects and current clients. They are separate from camp tenant
data because a prospect may not have a PondBridge tenant yet. Outreach is used
through Codex conversation, not a PondBridge dashboard.

## Initial setup

1. Apply the additive schema locally:

   ```bash
   export PONDBRIDGE_TARGET_ENV=local
   npm --workspace @pondbridge/api run supabase:apply-outreach-workspace
   ```

   For reviewed staging, set
   `PONDBRIDGE_SCHEMA_APPLY_ACK=apply-outreach-workspace-staging`. Production is
   intentionally rejected by the helper; promote the reviewed migration through
   the normal Supabase migration workflow.

2. Install or use the `pondbridge-outreach` Codex skill in
   `~/.codex/skills/pondbridge-outreach`.

3. Ask Codex about outreach naturally. It reads current records before answering:

   > Where did I leave things with Camp Vega?

4. Report factual changes conversationally so Codex can persist them through the
   audited outreach service:

   > Camp Pine signed today. Jordan remains the primary contact, and onboarding
   > is next Monday.

5. Add current clients by stating that they are signed. If a matching
   PondBridge tenant ID is known, it can still be linked through
   `PATCH /api/super/outreach/accounts/:id` using `linkedTenantId`.

No sample pipeline is seeded. Production prospect/contact information should be
entered by an authorized operator, not committed to source control.

## Stages

| Stage            | Use when                                                           |
| ---------------- | ------------------------------------------------------------------ |
| Identified       | A plausible camp has entered the pipeline.                         |
| Researching      | Camp or buyer research is in progress.                             |
| Ready to contact | Enough context exists for thoughtful first outreach.               |
| Contacted        | Initial outreach happened; no substantive response yet.            |
| Engaged          | A decision-maker is participating in a conversation.               |
| Proposal         | Pricing or a formal proposal is under review.                      |
| Verbal commit    | The camp intends to proceed but has not signed.                    |
| Signed           | The camp is a client; link its tenant record when available.       |
| Nurture          | Timing is not current, but periodic follow-up remains appropriate. |
| Lost             | The camp declined or became unqualified; record the reason.        |

Stage changes are written to interaction history automatically. Update the
record immediately when a camp signs, drops out, an owner changes, or the next
action changes. Log every material external interaction so the chat context
stays current.

## Agent and approval boundary

There is intentionally no PondBridge outreach page. Pipeline records, contacts,
and interactions remain behind the scenes as the durable source of truth. Codex
retrieves current context when the operator asks about outreach.

When AI is enabled, explicit statements such as “Camp Pine signed,” “move Cedar
to nurture,” or “log today's call” invoke audited internal CRM tools. The agent
searches before creating a camp and asks a concise question instead of changing
data when the camp or intent is ambiguous. In guided mode it can summarize
pipeline hygiene but does not interpret natural-language mutations.

To enable natural-language updates and drafting:

```bash
OUTREACH_AGENT_ENABLED=true
OPENAI_API_KEY=...
```

Public-web research is a separate opt-in:

```bash
OUTREACH_WEB_RESEARCH_ENABLED=true
```

Web-derived claims include sources. Ask the agent to save an operator-reviewed
research summary when it should become durable context. PondBridge sends
relevant business-contact context to OpenAI with provider storage disabled when
AI is enabled.

The workspace has **no send endpoint**. Drafts are suggestions stored in chat;
email, LinkedIn, calls, scheduling, and any future delivery integration require
a separate explicit review-and-approve workflow.

## Internal API surface

- `GET /api/super/outreach/pipeline`
- `POST /api/super/outreach/accounts`
- `GET|PATCH /api/super/outreach/accounts/:accountId`
- `POST /api/super/outreach/accounts/:accountId/contacts`
- `PATCH /api/super/outreach/contacts/:contactId`
- `POST /api/super/outreach/accounts/:accountId/interactions`
- `GET /api/super/outreach/conversation` (reserved for integrations)
- `POST /api/super/outreach/chat` (reserved for integrations)

All direct API mutations and chat-tool mutations write platform admin audit
events. There is deliberately no delete or external-delivery route in v1.
