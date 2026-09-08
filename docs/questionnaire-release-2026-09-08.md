# Questionnaire import release evidence — 2026-09-08

The unpushed local staging app was `/Users/asoroca/pondbridge-worktrees/questionnaire-claim` at `b408b79`, serving web 5174/API 4000. Its eight feature commits have been integrated on current main in `feature/upload-finish-2026-09-08`, preserving subsequent main changes and the separate manual CSV parser correction.

## Behavior

Director People → Add people → Import a questionnaire supports upload, column matching, a dry-run review, approved answer cleanup, commit, authenticated failure CSV download, and undo of unclaimed profiles created by that run. Import does not send email. Existing member values are preserved; missing fields can be filled. Created profiles remain pending and hidden until the person signs in and confirms them. Claim emails are a separate director action.

Finishing fixes preserve quoted CSV/blank name fields, expose invalid and duplicate manual entries, prevent paste from dropping later rows, recover from malformed uploads and field-catalog errors, prevent mapping changes during a pending preview, reject duplicate target fields, download reports through tenant/auth-aware HTTP, and report/retry partial undo failures.

## Validation

- Full web suite: 66 files / 462 tests passed before adding the final partial-undo regression; final targeted rerun recorded in task output.
- Six feature API suites: 105 tests passed, with synthetic localhost Supabase settings and mock email. No real provider or database write used.
- Changed web files pass ESLint; Vite production bundle builds successfully with isolated environment.
- API test config requires JWT_SECRET, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY even for these pure tests. Synthetic values were supplied, never production secrets.

## Release preconditions

- Integrate the security review's atomic undo/claim fix before releasing. The staged undo implementation reads then deletes and can race a member claiming their profile.
- Keep frontend/API feature versions together. The UI requires `/api/t/:slug/admin/import/*`, report download/undo, unclaimed People stage, and member claim endpoints.
- The eight staged commits add no database migration. They reuse existing `profiles.status = 'pending'`, profile `socials` provenance JSON and `import_reports` options/summary/error fields from the baseline schema. Verify these exist in the deployment target. Any migration introduced by the security fix must be applied first.
- AI matching/cleanup uses existing `OPENAI_PROFILE_IMPORT_MODEL`, output/timeout limits, `PROFILE_IMPORT_MONTHLY_BUDGET_USD`, configured OpenAI credentials, approved pricing and the existing AI ledger. Without a working provider or budget, manual dictionary mapping still works. Do not expand provider settings just to publish this feature.
- Complete browser rehearsal using synthetic CSVs: quoted/BOM headers, invalid/duplicate email, map correction, dry-run, rejected cleanup, import, failure download, claim visibility, undo and retry. Check a control tenant cannot access the other tenant's report/profile. Real email dispatch is a separate explicit action.

## Rollback

Roll back frontend and API to the preceding release together. A code rollback does not delete imported records. Preserve pending profiles, import reports and provenance for recovery. Use the reviewed tenant-scoped undo only for unclaimed profiles created by a bad run; it intentionally keeps claimed accounts and updates to existing profiles. Retain any backward-compatible safety migration.
