# Director release security review — September 8, 2026

Reviewed current main `2fd23b5` in the isolated `pondbridge-security-review` checkout. This is a bounded application review, not an exhaustive penetration test. No production data, credentials, outbound messages, or live intrusive scans were used.

## Corrected findings

- **High, conditional on hybrid authentication configuration:** Socket.IO accepted a valid legacy JWT even when `HYBRID_ALLOW_LEGACY_TOKENS=false`, bypassing the HTTP session retirement policy. A holder of a still-valid legacy token and active membership could continue reading/sending their conversation traffic. Realtime now respects the configuration. The handshake also rejects explicit unknown/mismatched camps, applies Clerk tenant-claim requirements (with the existing membership-backed multi-camp exception), applies super-role allowlist filtering before inactive-user exemptions, and rejects identities without an application membership. No cross-tenant conversation read was demonstrated; room lookups already require tenant and participation.
- **Medium, member tier privacy:** Family-tree writes returned a raw hydrated tree, unlike the filtered GET response. A member knowing a hidden same-camp profile ID could submit it during creation/editing to recover name/avatar data; renaming an old tree also returned members newly hidden by tier policy. Writes now reject hidden member additions, apply creator visibility, and return only filtered serialization. Hidden relationship IDs are stripped from both read and write responses. Hydration additionally constrains profiles by tenant ID as a data-layer guard against corrupted cross-camp references.
- **Dependency hardening:** Updated `csv-parse` to 7.0.2 and `sanitize-html` to 2.17.7; patched transitive js-yaml, browserslist, humanfs and xmldom. Added a qs 6.16.0 override. The sanitizer update requires Node >=22.12; the root engine now states that minimum. Jest 29 lacks Node's require(ESM) implementation, so its test environment loads the actual patched sanitizer with Node's native loader and exposes it to VM tests. Sanitizer behavior is not stubbed.

## Verification

- 62 focused auth, realtime, tenant-isolation, messaging and family-tree privacy tests passed.
- Entire pre-feature API safe suite: 75 suites / 539 tests passed using Node 22.17, synthetic JWT key and loopback-only fake Supabase URL. The safe suite mocks network/database access; no database reset was enabled.
- Fresh `npm ci --ignore-scripts` succeeded; full `npm audit` reports zero vulnerabilities (including development dependencies). qs resolves to 6.16.0 through Express/body-parser/Stripe.
- Targeted implementation ESLint and `git diff --check` passed.
- Tracked environment-file check passed. This checks tracked `.env` hygiene, not all historical secrets or deployed secret configuration.

Dependency reachability: the high-severity js-yaml/browserslist entries were development toolchain dependencies; no remotely reachable application exploit was established. The application does not enable CSV duplicate-column grouping and restricts sanitizer tags/attributes, reducing several advisory preconditions. xmldom is reached through the native-app build tooling. Patched versions were preferred over assuming those constraints remain permanent.

## Sampled boundaries and remaining coverage

Reviewed HTTP identity/role/tenant middleware, scoped profile/family-tree/event/giving paths and realtime room ownership checks. Stripe/Clerk webhook handlers call their provider's signature verifier; Resend/Stream handlers check raw payload HMACs, timestamp tolerance, and constant-time comparison. These paths require externally configured secrets; no production webhook delivery or key validation was attempted. The older tenant-filter/Clerk re-verification/CSRF defects from September 6 remain fixed in current source and pass their regression tests.

Uploads/media are reviewed separately by the upload specialist. Persistent socket connections still capture membership at handshake: account/tier changes during an already-open connection need a broader revocation design. Automatic conversation subscriptions and every privileged ID lookup were not exhaustively verified. Live RLS/ACL/provider configuration is outside this local review. The coordinator supplies release/staging verification.

The separately integrated questionnaire feature was also reviewed for admin/import/claim ownership: admin actions inherit director + tenant middleware, report lookup is tenant scoped, and claim targets the authenticated identity's own membership. A claim-versus-undo race was identified and is being corrected in a separate follow-up commit before release.

## Primary references

- [csv-parse maintainer advisory](https://github.com/adaltas/node-csv/security/advisories/GHSA-8cw4-87c7-c6xx): duplicate prototype headers with column grouping; current application parser does not enable grouping, but the dependency is patched.
- [sanitize-html upstream releases](https://github.com/apostrophecms/sanitize-html/releases) and installed 2.17.7 manifest: patched sanitizer and Node minimum.
- [qs upstream releases](https://github.com/ljharb/qs/releases).
- [xmldom upstream releases](https://github.com/xmldom/xmldom/releases).

## Questionnaire claim/undo follow-up

**High — claim/undo race could delete a claimed account.** A director's undo fetched a pending profile snapshot, then issued unconditional, separate profile and user deletes. A member claiming between the read and deletes could lose an already-claimed account; a failure deleting the user could also leave partial state. This requires a same-camp authorized undo and a concurrent claim, not an unprivileged cross-camp IDOR.

`20260908195000_atomic_import_undo.sql` introduces a service-only, invoker-rights transaction. It locks the tenant/report/profile and rechecks provenance plus pending status, then locks the tenant-local user. It preserves global references, elevated accounts, Clerk-linked or previously signed-in users, and membership-linked accounts. Only an untouched import stub and its profile can be deleted together; failure rolls back both writes. No global identity or Clerk account is deleted. Protected accounts are included in `keptClaimedCount` conservatively even if still pending.

Confirm/decline now compare-and-set the caller's own pending tenant/user profile. A concurrent deletion or prior claim returns 409, without reporting success or logging a claim. Claim reads no longer create a missing profile. Missing RPC deployment fails closed and surfaces per-profile undo failures; there is no fallback to unsafe deletes.

Validation: 61 focused import/claim/security API tests passed. `python3 apps/api/tests/atomicImportUndo.local.py` passed against real PostgreSQL in a newly created isolated local Docker database, then removed only that database. It covers both concurrent claim/undo orders, tenant/report isolation, six protected-account cases, rollback when user deletion fails, and denied client-role execution. No shared fixtures were reset or hosted databases modified. Targeted ESLint and diff whitespace checks passed. Apply the reviewed migration before enabling the updated undo handler; coordinator owns hosted staging/production application and smoke verification.

## Final gate and suppression review

Reviewed `9182231` (review-toggle handling) and `0c13b1d` (CC/BCC suppression). Suppression correctly covers all actual delivery recipients before sending, while preserving Reply-To as metadata. The stale pending-request redirect is fixed for new members when approval is disabled.

**High — removed membership could self-reactivate through direct join.** The existing `/access/join` handler explicitly recreated an inactive membership with active status when the review gate was off, contradicting its access-decision policy requiring human reapproval for removed members. The handler now queues any existing non-active membership regardless of gate configuration and has no automatic reactivation branch. New members and active members retain their gate-off behavior.

The original `reviewGateToggle.test.js` connects to a database and clears documents after each test, so it intentionally remains outside the safe suite. Registered `reviewGateToggleSafe.test.js` instead exercises the actual Express decision/join routes with mocked storage, identity resolution and notifications. It covers stale pending decisions, gate-on to gate-off joins, inactive/removed direct requests, active-member success, and another camp's pending request.

Before this final narrow change, the fully integrated API safe suite passed **85 suites / 667 tests** using Node 22 and the CI synthetic credentials/invalid Supabase hostname. The added six gate regressions pass independently, with targeted ESLint and whitespace checks.
