# Durable signup consent receipts

This follow-up applies only to the existing GreenLane verified-signup recovery
pilot. It requires migration `20260909030000` and its director-preapproval API.
It does not infer consent for older signups or change Cedar's signup behavior.

The signup checkbox supplies `unsafeMetadata.signupLegalAgreement` with this
exact contract:

```json
{
  "version": 1,
  "accepted": true,
  "ageEligibilityConfirmed": true,
  "termsVersion": "2026-03-04",
  "privacyVersion": "2026-03-04",
  "agePolicyVersion": "2026-07-14",
  "minimumAge": 14,
  "acceptedAt": "2026-09-08T12:00:00.000Z"
}
```

Clerk copies signup unsafe metadata onto its user record. Unsafe metadata remains
editable by the user: this payload is that verified user's self-attestation,
equivalent to their authenticated consent submission. It is not independent
proof of age, identity, camp eligibility, or director approval. The service reads
the current user from Clerk's Backend API, checks the verified primary email and
exact member/tenant intent, and applies the existing review/invitation policy.
Neither browser state, webhook payload metadata, nor token claims supply the
receipt directly. See [Clerk's metadata contract](https://clerk.com/docs/guides/users/extending).

The API and database require the current version tuple, literal boolean `true`
for both confirmations, and an ISO UTC timestamp between the policy's effective
date and five minutes ahead of server time. Unknown fields are rejected. The
claimed acceptance time is stored separately from the server's observation time.
There is no short expiry that would discard genuine consent during delayed email
verification. Changing policy versions requires a coordinated database migration;
an API/database tuple mismatch fails the scan rather than replaying an old policy.

On an applied recovery, the service may append a receipt only to a pending,
server-marked recovered request with the same Clerk ID and verified email.
Missing or invalid metadata creates no receipt. The table keeps one immutable
snapshot per tenant, Clerk ID and policy tuple. Later metadata edits do not rewrite
it. The same identity can restore a missing request copy from that snapshot.
A genuine agreement already on the request with the current policy tuple is
preserved; an older or partial tuple cannot outrank a valid current receipt.
Consent does not grant access without a recorded director decision.

This ledger supplies fallback evidence for recovered pending requests. A normal
authenticated callback already persists consent on its request and member profile
and may activate before asynchronous metadata ingestion. Approved requests are
not retrospectively ingested, so the ledger is not a universal signup audit log.

Receipt insertion and the existing row-locked consent RPC run in one transaction.
If the director already preapproved, that transaction also activates the membership
and inserts the final approval email outbox intent. A competing denial wins or loses
under the same row lock. A failed member/outbox write rolls back the receipt and
consent update; the scan retains its page for retry. A retry also heals a pending
preapproved request that already has genuine consent without replacing it.

## Rollout and operations

1. Apply `20260909040000_durable_signup_consent_receipts.sql` after `20260909030000`.
   The migration creates no receipts and sends nothing.
2. Deploy this backend and the matching explicit-checkbox metadata capture. Keep
   the existing GreenLane-only recovery rollout and review gate. The next webhook
   or bounded periodic sweep reads fresh Clerk data; no historical backfill or
   synthetic acceptance timestamp is needed.
3. Check `signup_review_scan_state.last_success_at`, `last_completed_cycle_at`,
   and `last_error` using the existing recovery runbook. A database receipt error
   retains the page and reports a redacted error instead of a healthy scan.
4. Inspect aggregate receipt counts without exporting identities or email addresses:

   ```sql
   SELECT count(*) AS receipts, min(observed_at) AS first_observed,
          max(observed_at) AS last_observed
   FROM public.signup_consent_receipts
   WHERE tenant_id = (SELECT id FROM public.tenants WHERE slug = 'greenlane');
   ```

The existing ID-based repair CLI remains dry-run by default; dry-run never appends
or applies a receipt. An explicit `--apply` may finish an already recorded director
approval when genuine consent exists. It never invents a director decision.

The table has forced RLS and no public/authenticated access. The service role may
read it and execute the validating RPC but cannot insert, update or delete rows
directly. Tenant deletion cascades for privacy erasure. Preserve the ledger on
application rollback; do not edit historical receipts to change policy or revoke
access. Disable the recovery rollout to stop ingestion, then investigate/revert
the application while retaining genuine existing consent and decisions.

## Verification

Run `python3 apps/api/tests/signupConsentReceipts.local.py` with the repository's
local Supabase container available. It copies only the local schema into a new,
randomly named disposable database and uses synthetic identities. It removes only
its own database. It never resets the source database, exports production data,
or sends email.

The rehearsal covers strict input and policy drift, missing metadata, identity
mismatch, ordinary/denied/Cedar exclusions, immutable duplicate ingestion, lost
browser/request state, both consent/director orderings, stuck-state healing, final
outbox failure rollback, and forced RLS/service-only grants. The registered safe
API suite covers fresh Clerk reads, strict validation, dry-run, and retained scan
pages on failures. On this change: all 94 safe API suites / 786 tests passed;
changed JavaScript lint and the full-schema synthetic rehearsal passed.
