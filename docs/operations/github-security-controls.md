# GitHub main protection

Applied and independently verified on 2026-09-08 for `asoroca1/PondBridge`.
Before this change the classic protection endpoint returned 404 and effective
rules were empty. [The saved request](main-branch-protection.json) is reproducible;
[the selected API response](evidence/main-protection-2026-09-08.json) records the result.

- Pull requests are required. A solo operator does not need another approving
  reviewer (`required_approving_review_count: 0`). Stale approvals are dismissed.
- Both `Quality Gates` jobs must pass on an up-to-date branch: `web-and-security`
  and `api-and-hosted-db-gates`. Checks are bound to the observed GitHub Actions
  app ID `15368`, preventing another integration from supplying these statuses.
- Force pushes and branch deletion are disabled. Review conversations must be resolved.
- `enforce_admins: false` preserves the existing administrator's emergency bypass;
  it does not grant anyone a new repository role. Administrators should normally
  use PRs and record an incident reason and post-change checks when bypassing.

The API job's name includes hosted DB gates, but its destructive hosted-test portion
is conditional on the existing `PONDBRIDGE_CI_DB_ENABLED` setting. This protection
requires the job to pass; it does not silently enable tests against any database.

Review current settings before applying an update, preserving any newer controls:

```sh
gh api repos/asoroca1/PondBridge/branches/main/protection
gh api --method PUT repos/asoroca1/PondBridge/branches/main/protection \
  --input docs/operations/main-branch-protection.json
gh api repos/asoroca1/PondBridge/branches/main/protection
```

The PUT is a reversible repository configuration change, not a deployment. Check
job names and app IDs before changing workflows. Never solve a failed quality gate
by weakening the protection. In a genuine outage, prefer the existing admin bypass
over deleting the rule, and preserve an incident record.

API semantics: [GitHub branch protection reference](https://docs.github.com/en/rest/branches/branch-protection).
