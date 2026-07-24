# ADR 0006: Tenant AI search and LinkedIn profile PDF import

Date: 2026-07-15

Status: Accepted for staged implementation

## Context

Camp members often remember a connection by a combination of camp role,
location, school, and career rather than an exact name. The existing directory
already enforces tenant scope, member blocks, module availability, and safe
profile summaries, but its manual filters require the member to translate that
memory into database fields.

The existing profile PDF assistant also claimed support for LinkedIn exports,
but its backend used a generic resume prompt and an older unstructured model
call. It did not detect LinkedIn's export layout or attribute provider cost to a
camp.

## Decision

1. Camp Search AI is a query planner, not a directory-reading chatbot. OpenAI
   receives the member's search sentence and generic camp role labels only. It
   never receives profile records, result cards, email addresses, phone
   numbers, block state, or cross-camp data.
2. Structured model output is normalized into the existing search fields. The
   existing tenant-scoped, block-aware search route remains the only retrieval
   layer and the only source of result facts.
3. `camp_ai_search_v1` is off by default and controlled by the durable rollout
   plane using stable tenant IDs, control-camp exclusions, revisioned changes,
   and an immediate kill switch. The current filters remain available to every
   camp that already has Search enabled.
4. A local deterministic planner handles provider, budget, or ledger failure.
   The client labels this as guided fallback rather than AI. No generated prose
   is shown, so result cards remain source-linked and hallucination-resistant.
5. Every provider search plan starts an `ai_generations` record before the
   provider call. The ledger stores hashes, byte counts, prompt/model versions,
   tokens, provider IDs, and estimated micro-USD—not the raw search sentence.
6. LinkedIn Save-to-PDF and standard resume imports share the authenticated,
   tenant-scoped Premium profile assistant. The server validates a real PDF
   signature, enforces file/page limits, extracts text in memory, detects or
   accepts the document type, and never retains the uploaded file or raw text.
7. LinkedIn extraction understands Contact, Top Skills, Summary, Experience,
   and Education ordering. Structured AI extraction is preferred when safely
   configured; a conservative local parser provides useful name, location,
   About, LinkedIn URL, education, and basic dated-experience suggestions when
   AI is unavailable.
8. Imported account email is never applied. The member selects individual
   suggested fields, applies them to the editable form, and must still save the
   profile. No parser has write authority.

## Initial economics

Both features default to GPT-5.6 Luna and use the shared approved price ledger.
At the recorded schedule of $1.00 per million input tokens and $6.00 per million
output tokens, a short search plan is normally a small fraction of one cent. A
profile PDF is input-heavy but should still cost pennies or less for normal
exports. PondBridge should package allowances by camp and meter actual pilot
usage instead of showing per-call charges to members.

Local defaults cap provider cost at $15 per camp per month for Camp Search AI
and $15 per camp per month for Profile PDF Import. These are safety controls,
not final customer prices.

## Rollout sequence

1. Apply and verify the platform-audit, rollout-control, and communications
   schemas in an explicitly identified staging project. The communications
   schema supplies the service-only AI generation ledger and usage function.
2. Configure a staging OpenAI key, approved model names, hard provider spend
   limits, and per-feature camp budgets.
3. Run synthetic natural-language planning and LinkedIn/resume PDF cases. Use
   invented people and documents only.
4. Enable `camp_ai_search_v1` for one target camp while Cedar remains an
   explicit control. Verify target, control, kill switch, budget exhaustion,
   provider failure, blocked-member filtering, and two-camp isolation.
5. Exercise LinkedIn import with text-based exports, malformed files,
   image-only files, long files, provider failure, selective field application,
   discard, and save. Confirm no raw PDF/text appears in storage or logs.
6. Complete desktop/mobile, keyboard, VoiceOver, and NVDA checks before widening
   the cohort.

## Consequences

- Members gain an AI-native discovery experience without granting a model
  directory access or write authority.
- Directors see the feature's rollout/provider/ledger state and usage in the
  same feature inventory used by Settings and onboarding.
- Super admins control the cohort from the existing audited rollout page.
- Vector embeddings are deliberately deferred. If later added, they require a
  separate tenant-partitioned index, deletion synchronization, re-embedding
  policy, authorization review, and target/control rehearsal.
