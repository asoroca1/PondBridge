# ADR 0003: Member Safety Controls and Age Eligibility

- Status: Partially accepted; minor-participation policy remains provisional
- Date: 2026-07-14
- Owners: PondBridge product, engineering, privacy, and legal counsel

## Context

PondBridge previously had community-conduct language but no member-facing block
or report workflow, no director report queue, and no server enforcement that
stopped a blocked member from starting or continuing a direct conversation.
The Terms state that members must be at least 14, but account creation recorded
only general Terms/Privacy acceptance and did not separately confirm that age
eligibility.

Those gaps are unsafe for a multi-camp rollout. They also cannot be solved by a
moderation chatbot: consequential safety decisions need a human owner, a source
record, and an audit trail.

## Accepted decision: report and block

1. Blocks and reports are tenant-scoped server records. IDs in the request are
   never trusted as tenant authority.
2. A block disables one-to-one contact in both directions, hides the two
   profiles from each other in search/directory views, and removes their direct
   conversation from the conversation list.
3. The same rule is enforced by the REST send path and the socket send path.
4. Blocking does not silently remove either member from shared group chats,
   forums, or camp events. The UI explains this boundary.
5. Members can report profiles and individual messages. The report target is
   verified in the same tenant; a message can be reported only by a participant
   in its conversation.
6. Duplicate active reports from the same reporter for the same item are
   idempotent.
7. Directors receive a Community Safety queue, can mark reports in review,
   resolved, dismissed, or reopened, and must enter a resolution note before
   closing a report. Status changes are written to the tenant admin audit log.
8. Safety records are service-role only under RLS. Database triggers reject
   reporter, reviewer, blocker, blocked-member, or target-author references from
   another tenant.

## Provisional decision: age eligibility

The application now enforces the eligibility statement already present in the
current Terms: a new member must separately confirm being at least 14. The
server rejects both legacy and Clerk-backed membership creation unless Terms,
Privacy, and age eligibility are all confirmed. The profile legal-agreement
record stores the minimum age and a separate age-policy version.

This is an eligibility attestation, not a complete minor-consent system. It does
not establish guardian consent, verify date of birth, limit adult/minor direct
messages, or assign directors the legal role of guardian. Therefore the broader
minor-participation policy is not considered complete.

Before marketing PondBridge to communities that intentionally include members
under 18, legal/product owners must choose and document one of these paths:

- adult-only networks for the initial rollout;
- ages 14–17 with a legally reviewed guardian-consent and revocation workflow;
- camp-managed institutional consent with a documented lawful basis and clear
  allocation of responsibilities.

The selected path must define geography, verification, retention, parental or
guardian rights, visibility defaults, adult/minor messaging rules, reporting
SLAs, escalation contacts, and account deletion/export behavior. Until then,
PondBridge must not describe the age attestation as verified consent.

## Moderation operations

- A safety report is triaged before routine onboarding or engagement work.
- Immediate-danger copy directs members to local emergency services; PondBridge
  is not presented as an emergency channel.
- Directors document the facts reviewed and action taken without copying
  unnecessary sensitive content into the resolution note.
- AI may later summarize an existing report for a director, but it may not
  close reports, contact members, suspend accounts, or decide whether conduct
  violated policy.

## Validation and rollout

Before enabling the schema in a target camp:

1. Apply the `member_blocks` and `content_reports` migration in staging.
2. Test same-tenant block/unblock, cross-tenant target rejection, REST and socket
   DM denial, search/profile hiding, duplicate reports, director review, and
   admin audit records.
3. Verify member controls and the director queue by keyboard and screen reader.
4. Confirm the camp's named moderation owner and response/escalation process.
5. Validate the age-attestation copy and minimum age with counsel before any
   policy change or under-18 marketing.

Rollback may hide the member/director UI and reject new safety mutations, but
existing reports and audit records must be retained according to the approved
retention policy. Never drop safety records merely to reverse the feature UI.
