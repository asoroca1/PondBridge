# Questionnaire import release evidence — 2026-09-08

The unpushed local staging app was `/Users/asoroca/pondbridge-worktrees/questionnaire-claim` at `b408b79`, serving web 5174/API 4000. Its eight feature commits have been integrated on current main in `feature/upload-finish-2026-09-08`, preserving subsequent main changes and the separate manual CSV parser correction.

## Behavior

Director People → Add people → Import a questionnaire supports upload, column matching, a dry-run review, approved answer cleanup, commit, authenticated failure CSV download, and undo of unclaimed profiles created by that run. Import does not send email. Existing member values are preserved; missing fields can be filled. Created profiles remain pending and hidden until the person signs in and confirms them. Claim emails are a separate director action.

Finishing fixes preserve quoted CSV/blank name fields, expose invalid and duplicate manual entries, prevent paste from dropping later rows, recover from malformed uploads and field-catalog errors, prevent mapping changes during a pending preview, reject duplicate target fields, download reports through tenant/auth-aware HTTP, and report/retry partial undo failures.

## Validation

- Final integrated web suite: 66 files / 463 tests passed. Final integrated API safe suite: 86 suites / 680 tests passed. Lint, build, web performance budgets, offline Copilot evaluation and environment hygiene passed; production dependency audit reports zero vulnerabilities.
- Six feature API suites: 105 tests passed, with synthetic localhost Supabase settings and mock email. No real provider or database write used.
- Changed web files pass ESLint; Vite production bundle builds successfully with isolated environment.
- API test config requires JWT_SECRET, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY even for these pure tests. Synthetic values were supplied, never production secrets.

## Release preconditions

- Atomic undo/claim protection is integrated and independently reviewed. Migration `20260908195000_atomic_import_undo.sql` was applied and recorded in staging and production on 2026-09-08; production confirms service-role execution allowed and authenticated client execution denied.
- Keep frontend/API feature versions together. The UI requires `/api/t/:slug/admin/import/*`, report download/undo, unclaimed People stage, and member claim endpoints.
- The eight staged commits add no database migration. They reuse existing `profiles.status = 'pending'`, profile `socials` provenance JSON and `import_reports` options/summary/error fields from the baseline schema. Verify these exist in the deployment target. Any migration introduced by the security fix must be applied first.
- AI matching/cleanup uses existing `OPENAI_PROFILE_IMPORT_MODEL`, output/timeout limits, `PROFILE_IMPORT_MONTHLY_BUDGET_USD`, configured OpenAI credentials, approved pricing and the existing AI ledger. Without a working provider or budget, manual dictionary mapping still works. Do not expand provider settings just to publish this feature.
- Browser rehearsal passed manual column correction, dry-run, two-row commit, invalid-row skip, authenticated error CSV HTTP 200, and atomic undo showing two profiles removed. The browser tool did not expose the download event, so local file-save completion was not independently observed. Automated regressions additionally cover: quoted/BOM headers, invalid/duplicate email, map correction, dry-run, rejected cleanup, import, failure download, claim visibility, undo and retry. Check a control tenant cannot access the other tenant's report/profile. Real email dispatch is a separate explicit action.

## Rollback

Roll back frontend and API to the preceding release together. A code rollback does not delete imported records. Preserve pending profiles, import reports and provenance for recovery. Use the reviewed tenant-scoped undo only for unclaimed profiles created by a bad run; it intentionally keeps claimed accounts and updates to existing profiles. Retain any backward-compatible safety migration.

## 600-person rehearsal and request limits

The pure service rehearsal uses model mocks that reject all writes for dry-run tests. Final run: 600 unique responses → 600 creates (24 ms); 606 responses → 600 creates, 5 duplicates, 1 invalid address (38 ms); 600 existing accounts in the latter half of a 1,200-account tenant → 600 duplicates (23 ms). A mocked commit creates all 600 users and profiles, links all 600 users, finalizes the report, and hashes only one discarded random 256-bit batch secret (46 ms). These timings exclude database/network and bcrypt work and are correctness evidence, not a production throughput claim.

The previous implementation hashed a different unusable placeholder password for every created row. A local three-hash bcrypt sample at the default 12 rounds averaged 457 ms, implying approximately 274 seconds of hashing alone for 600 rows. The finishing change lazily hashes one new random 32-byte secret per import, retains only the hash, and never emails/logs/stores the secret. No change to actual member credentials or bcrypt rounds.

The HTTP upload cap is 5 MiB and the importer rejects over 2,000 rows before fetching tenant accounts. Each new person still requires three ordered model writes, but independent identities now run in groups of at most eight. Duplicate/update dependencies drain the pending group first; fuzzy matching intentionally remains sequential. There is no import-specific idempotency key or durable background job; retries create a new report and rely on current tenant deduplication. Avoid presenting a response timeout as proof that no rows were written. The production rehearsal must account for this limitation.


## Hosted staging acceptance after concurrency fixes

On 2026-09-08, the integrated API at `127.0.0.1:4020` used the hosted synthetic staging database, mock email/billing and disabled AI. Each rehearsal used a fresh randomized `qa600-…@example.test` audience, empty city fields, and 600 names/addresses. Existing camp profiles were not changed.

| Check | Sequential baseline | Bounded concurrency |
| --- | ---: | ---: |
| Preview 600 new rows | 4.883 s | 3.562 s |
| Commit 600 new rows | Client timed out at approximately 300 s; report later confirmed all 600 | 63.198 s, 600 created, zero errors |
| Re-preview identical imported file | Not rerun | 4.235 s, zero creates/updates, 600 duplicates |
| Undo 600 unclaimed profiles | 106.246 s | 25.634 s |
| Remaining matching synthetic people after undo | 0 | 0 |

Both undo responses reported 600 removed, zero protected/claimed and zero failures. The baseline request was never blindly retried after its client timeout; its report was observed finalized before restarting the API. The final commit completed comfortably below the 120-second target on this staging rehearsal. This is measured acceptance for this workload and environment, not a guaranteed bound for every database/provider load, fuzzy import or update-heavy file.

Create regression coverage verifies the eight-operation cap, dependent duplicate field merging, name/city matching, sequential fuzzy selection, failed reservation recovery and stable row error order. Undo coverage verifies the same cap, source-order failures and unchanged atomic claim protection. An independent security review found no new duplicate/order or atomicity issue in these concurrency changes.

All 1,200 accounts/profiles created across the two rehearsals were removed by their respective report-scoped undo. No provider messages were sent. Synthetic report IDs used for scoped cleanup are `8bd9065d67d522aa140f4c64` and `eadd36444cc5b0ac7213a846`. Full local timing evidence is in `/tmp/pondbridge-questionnaire-fixture/scale-baseline-evidence.json` and `/tmp/pondbridge-questionnaire-fixture/scale-evidence.json`; credentials are stored separately and must not be committed.
