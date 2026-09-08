# Green Lane one-time counted membership exception

The operator authorized a one-time exception on September 8, 2026: admit the
remaining director-preapproved recovered Green Lane accounts into the network's
active profile/member counts, while requiring those same people to provide their
missing account confirmation before using authenticated network features.

This is a fixed cohort, not a new signup policy. The original repair contained 43
verified Clerk identities. The read-only snapshot at 23:27:49 UTC found three
already fully approved and exactly 40 still pending with a director preapproval.
Every candidate was rechecked against Clerk's current verified primary email,
explicit Green Lane member intent, and non-banned/non-locked state. The private
manifest retains request, Clerk identity, verified email and director-decision
bindings. Real recipient details are excluded from source control.

Manifest SHA-256 (canonical sorted private member array):
`2426081401dc252a39b46cbd66e82ae131de17809544d506a0d14af1a8f727e4`.

## Required behavior

- Admission creates or binds one active user, profile and membership so the
  person appears in the network and its member counts immediately.
- Admission does not fabricate age confirmation, legal acceptance, login history,
  contributions or message delivery. The existing director decision is retained.
- A server-owned confirmation gate applies only to admitted cohort identities.
  Authentication may identify them, but network data/actions and sockets remain
  unavailable until confirmation. The page alone is not the access boundary.
- The next account entry leads to a clear one-click confirmation of age eligibility
  and the current Terms/Privacy Policy. Actual confirmation is saved atomically;
  retry, refresh or later login cannot create another account or require the same
  cohort confirmation again.
- Admission sends no extra account-ready email. Successful confirmation uses the
  existing durable final-approval email intent and its stable idempotency key.
- People who finish confirmation or lose approval before admission must not be
  re-gated or admitted from stale evidence. New signups and other camps keep their
  normal policies, including the durable signup confirmation introduced in #150.

## Release boundary

Apply the additive schema before application code. Verify both application
providers run the release and old API instances have drained before admitting any
real member. Refresh identity and request eligibility immediately before the
operator-only admission step; process only the sealed private manifest. Record
per-entry admission, already-completed and rejected outcomes without expanding it.

Validate synthetic target/control accounts and direct-route restrictions before
production admission. Afterward verify active profile counts, cohort gates,
request/identity uniqueness, no fabricated consent, delivery intent state, and
normal future signup routing. Preserve the server gate on application rollback;
never roll back to code that would expose admitted gated users without checks.

## Release evidence

The frozen list remained 40 entries. A fresh preflight at 23:44 UTC found 39
still eligible and one already approved through normal signup; the latter must
not receive another confirmation gate.

The integrated release passed 818 API tests. Its final frontend changes cover
Clerk, legacy password/magic-link sessions, safe deep links, denied accounts, and
a revocation racing with the confirmation click. The disposable full-schema
rehearsal passed admission/confirmation/denial concurrency, exact identity,
manifest immutability, active counts, outbox rollback and function/table ACLs.
Hosted staging migration and a synthetic transaction-only rehearsal passed;
all synthetic rows and jobs were rolled back. Detailed RPC behavior and the
safe rollback boundary are in [counted-greenlane-confirmation.md](counted-greenlane-confirmation.md).
