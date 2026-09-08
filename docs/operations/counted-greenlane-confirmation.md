# Exact GreenLane cohort admission with one-time confirmation

Scope: the operator-reviewed intersection of the original 43 recovered GreenLane
signup requests with their still-pending director preapprovals. The implementation
ships no identities, manifest, or production data. Cedar, other existing camp
memberships, and future ordinary GreenLane signups keep their existing policies.

Migration `20260909050000_counted_signup_confirmation.sql` is additive and inert
until the operator seals a manifest and applies individual admissions. The
service-only manifest function accepts at most 43 unique request IDs with exact
Clerk IDs, emails, and director-preapproval snapshots. It checks original
`operator_repair` provenance, active GreenLane tenant, and current identity
bindings. Completed, denied, or changed entries are skipped; a repeated identical
manifest is idempotent, and a different manifest cannot expand the sealed cohort.
The database fingerprint hashes its canonical JSON representation; it is distinct
from a private file's byte-level checksum.

Admission locks each request, rechecks the frozen cohort and fresh operator-verified
Clerk primary email/ID, and creates exactly one active user, profile, and tenant
membership. Roles are only `user`. It records immutable admission evidence and a
server-owned `users.account_confirmation_request_id`. It neither creates a legal
agreement nor records a login. The active profile is counted on Today and visible
in People as a Member; that stage outranks the retained pending access request.
The request remains pending solely for the existing final-confirmation and
approval-outbox transaction. Admission emits no new email.

`requireAuth` blocks protected tenant/global/legacy HTTP routes for this selected
membership with `ACCOUNT_CONFIRMATION_REQUIRED`. Credential responses contain a
token and minimal bootstrap only, never profile content. Socket authentication
and every incoming socket action check database-backed account state. Identity-only
access routes permit only the same camp's GET `/access/decision` and POST
`/access/confirm-account`; other mutations cannot bypass confirmation. Public
unauthenticated endpoints remain public. Existing authorized memberships in other
camps remain scoped to those camps and cannot authorize GreenLane content.

Decision returns action `confirm_account`, `confirmation.required: true`, and
`/t/greenlane/account-confirmation`, with no profile or internal request marker.
The POST accepts the actual current version-1 `legalAgreement`. Both Clerk and
legacy sessions bind to the exact stored account; the server freshly verifies its
Clerk primary email, rejecting changed, unverified, locked or banned identities.
Consent is a self-attestation, not independent verification of the person's age.

Final confirmation atomically records immutable real consent, copies it to the
request/profile, clears the user gate, marks the original request approved and
inserts the existing `access-approval/<request>` outbox intent. Repeated calls
cannot duplicate this receipt or email. A normal recovery consent racing with
admission delegates to the same transaction. Denial deactivates admitted users
and memberships and removes their profiles; later user/profile/membership
deactivation or deletion prevents completion from resurrecting access. Admission
history survives deletion of its user, so old pending preapproval cannot create
a second account. An outbox failure rolls back consent and preserves the gate.

## Deployment order and operator application

1. Apply the reviewed migration through the normal Supabase migration/ledger
   deployment path, after migrations 010000–040000. Do not replay the legacy
   `native_schema.sql` bootstrap against production.
2. Deploy the matching backend guard and frontend confirmation route. Drain every
   old API/socket process before admitting anyone: old code cannot enforce this
   new active-account gate.
3. Refresh each frozen candidate from Clerk. Project the private, reviewed
   manifest into objects containing `requestId`, `clerkUserId`, `email`,
   `directorApprovedAt`, and `directorApprovedByUserId`. Never add new IDs based
   on a later pending-queue query. Call `register_counted_signup_cohort(tenant,
   manifest)` once and retain its counts/fingerprint in the private incident.
4. For those exact registered entries with fresh verified primary identity,
   call `admit_counted_signup_account(tenant, request, clerkId, verifiedEmail)`.
   Review admitted/already-admitted/skipped-changed/error counts. A concurrent
   completed or denied request must stay unchanged. No email-send operation is
   part of this application.
5. Verify active counts and protected-route rejection, then a synthetic confirmed
   account's successful access. The real cohort must personally submit consent;
   operators must never fill in acceptance timestamps or booleans for them.

Rollback is **roll forward with the new guard retained** once any admission is
active. Pause further admissions while repairing the application. Do not revert
to old auth code or drop the gate column/functions while unconfirmed active users
remain. A separate reviewed quarantine transaction would be required before an
old-code rollback; it must lock requests, deactivate only still-unconfirmed
admitted users/profiles/memberships, and preserve completed members and receipts.

## Rehearsal

`python3 apps/api/tests/countedSignupConfirmation.local.py` clones only the actual
local schema into a new random disposable database, applies the migrations and
tests synthetic data. It never resets the source database, accesses production
rows, or sends emails. Cases cover sealed cohort/changed-snapshot skips, exact
identity, counted active profiles without fabricated consent, no admission email,
concurrent admission and consent, duplicate completion, denial/removal/deletion,
inactive membership, final-outbox rollback, and forced RLS/service-only immutable
storage. Mocked API suites exercise protected HTTP, credential redaction,
identity-only bypass attempts, Clerk/legacy owner verification, sockets and the
one-time decision/confirmation contract.

Validation: the full safe suite passed 98 suites / 815 tests before three final
focused regressions were added; the final six affected suites passed all 82
tests. Changed JavaScript lint and the final full-schema SQL rehearsal passed,
including concurrent confirmation versus denial, direct missing-version refusal,
and compatibility with the existing versionless stored legal-agreement format.
