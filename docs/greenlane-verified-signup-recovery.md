# GreenLane verified signup recovery

Target: the stable tenant ID resolved by slug `greenlane`. Cedar is the control.
The `verified_signup_review_reconciliation_v1` feature rollout defaults off and
must be configured as a pilot with only GreenLane's ID. The service and SQL also
enforce the GreenLane slug and active review gate; changing a display name cannot
enable another camp. No production rows or provider settings were changed by the
implementation task.

## Recovery contract

Only fresh Clerk Backend API user records are evidence: exact verified **primary**
email, member signup metadata naming GreenLane, no conflicting tenant claim and
no locked/banned account. Client-controlled signup metadata expresses intent;
it never grants membership or a role. The unauthenticated, in-memory branding
intent is not used. Open entry with review permits recovery; code/invite-only
entry additionally requires a live unused member invite for that email.

The service-only RPC skips every existing request (pending, approved or denied),
every matching app account/membership, and director invitations. It inserts only
`pending`, with the actual Clerk names/ID and server provenance in
`profilePayload.socials.signupRecovery`. It does not create users/profiles,
consume invites, send notifications, store OTPs, or claim legal/age acceptance.
An empty request message avoids attributing system text to the member.

Recovered requests require the person to confirm consent. Single and bulk
approval share a server guard; `decision.request.requiresConsent` and approval
list flags expose the requirement. A real authenticated, email-verified consent
submission preserves the recovery provenance. Its conditional update cannot
undo a concurrent director decision. GET `/decision` remains read-only with
respect to recovery.

## Repair and activation order

1. Apply migration `20260909010000_verified_signup_review_reconciliation.sql`
   after review. Ship the API consent guards and the corresponding callback and
   director UI changes before enabling recovery.
2. Configure the feature rollout as `pilot`, `killSwitch=false`, with only the
   actual GreenLane tenant ID. Retain the review gate. No broad enabled rollout
   or Cedar configuration change is needed.
3. Prepare an approved private JSON array of Clerk user IDs from the read-only
   audit. Keep it outside git with mode 0600. With the existing API environment:

   ```sh
   node apps/api/scripts/reconcileVerifiedSignups.mjs --user-ids-file /private/path/user-ids.json
   node apps/api/scripts/reconcileVerifiedSignups.mjs --user-ids-file /private/path/user-ids.json --apply
   ```

   The first command defaults to dry-run and revalidates each account from Clerk.
   The second explicitly inserts eligible pending rows; retrying is idempotent.
   Output contains counts, error codes and opaque IDs, never recipient emails or
   codes. Stop and investigate unexpected counts or any failure before expanding
   the input cohort. Keep the resulting request IDs with the private incident.

## Recurrence and detection

Signed `user.created` and `user.updated` events trigger the same fresh-record
check. They require those Clerk event subscriptions for immediate execution;
event delivery is not assumed to be configured. A server worker independently
scans at most 100 Clerk users per minute, with a database lease and persisted
offset. It repeatedly scans ascending creation order so later verification,
deleted accounts shifting pagination, a closed browser and missed webhooks heal.
Errors retain the page and record a redacted code. A crashed worker's lease
expires after four minutes. No external scheduler is required.

Read this health query while the pilot is enabled:

```sql
SELECT scan_offset, run_at, lease_until, last_success_at,
       last_completed_cycle_at, last_error
FROM public.signup_review_scan_state
WHERE tenant_id = (SELECT id FROM public.tenants WHERE slug = 'greenlane');
```

Investigate any nonempty `last_error`, no successful page within six minutes of
enablement, or a success older than six minutes. A full sweep normally takes
`ceil(Clerk user count / 100)` minutes; investigate a missing/stale completed cycle
after that budget plus five minutes. `updated_at` is not a success indicator.
The rollout gate also stops the periodic worker from scanning when disabled.
No promise of instant recovery is made during an API, Clerk or database outage.

## Validation and rollback

The disposable local test clones the actual local schema **without its rows**,
then tests synthetic pending-only recovery, dry-run, prior decision/account and
Cedar protection, invitation policy, concurrent calls, service-only grants and
cursor failure/success health. Run `python3 apps/api/tests/signupReconciliation.local.py`.
Mocked API tests cover verified identity, bounded pages, failure retry, real
consent, and single/bulk approval refusal. No live email or production mutation
is part of these tests.

Rollback: set the rollout kill switch true (effective within its 15-second cache),
then revert the service if needed. Preserve existing pending/history records and
consent guards; disabling recovery does not approve, delete or alter anyone.

References: [Clerk pagination contract](https://clerk.com/docs/reference/backend/user/get-user-list),
[Clerk webhooks](https://clerk.com/docs/guides/development/webhooks/overview).

## Final approval and provenance boundary

`access_requests.recovered_clerk_user_id` is authoritative server provenance. Request body normalization strips `signupRecovery` from both social aliases; historic JSON-only markers do not bind identity or enter the recovery approval path. Recovery history matches the tenant plus normalized email or this stable Clerk ID, so changing primary email cannot recreate a previously denied recovery.

A consent-only callback preserves the original names and omitted profile fields. The common single/bulk approval helper calls one service-only SQL transaction for recovered rows: lock the pending request, verify director tenant scope and actual age/legal consent, reject existing account conflicts, insert the Clerk-bound legacy user, global identity, tenant membership and linked profile, then mark approved. A competing denial uses a pending-state compare-and-set; losing decisions write no member and send no acceptance. Any transaction failure rolls all membership writes back and leaves the request pending. Internal recovery metadata is omitted from the member-facing profile; the real legal agreement remains. Ordinary legacy approval is outside this migration's atomic approval scope.

Validation additionally covers complete identity/profile linkage, competing approval and denial, duplicate approvals, failure after user creation, spoofed server provenance, changed-email denied history, and member profile metadata privacy in the disposable full-schema database.
