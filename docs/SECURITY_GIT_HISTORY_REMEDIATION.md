# Git History Data Remediation

## Incident summary

Tenant migration exports and identity mapping files were committed under
`migration/cedar-existing-backup/` and `migration/cedar-mapping-files/`. Some of
those artifacts contain private member data and authentication-related fields.
They are removed from the current tree and both directories are ignored, but
the historical objects remain available in existing Git history until a
coordinated rewrite is completed.

## Immediate containment completed

- Removed the tracked exports and mappings from the current tree.
- Added both generated-data directories to `.gitignore`.
- Confirmed the application does not read these files at runtime.
- Kept migration scripts capable of generating local artifacts for authorized,
  one-time migration work.

## Required owner actions

1. Treat the affected repository history as containing private data until the
   rewrite is complete.
2. Move any required rollback export to an approved encrypted backup system;
   do not attach it to issues, pull requests, chat, or CI artifacts.
3. Rotate or invalidate any reusable credential, token, session, or legacy
   password material represented in the exports. Password hashes should be
   treated as exposed even when the original passwords are unknown.
4. Identify every remote, fork, CI cache, deployment checkout, and developer
   clone that contains the affected history.
5. Schedule a maintenance window and notify collaborators that all clones must
   be replaced or hard-reset after the rewrite.

## Coordinated history rewrite runbook

Run this only after the owner actions above are complete and a repository
administrator has approved the maintenance window.

```bash
git clone --mirror <repository-url> pondbridge-history-cleanup.git
cd pondbridge-history-cleanup.git
git filter-repo \
  --path migration/cedar-existing-backup \
  --path migration/cedar-mapping-files \
  --invert-paths
git for-each-ref --format='delete %(refname)' refs/original | git update-ref --stdin
git reflog expire --expire=now --all
git gc --prune=now --aggressive
git push --force --mirror
```

After the force-push, invalidate cached artifacts where the hosting provider
supports it, re-run secret/data scanning, replace deployment checkouts, and
require fresh clones. Do not consider the incident closed until a fresh clone
cannot find the removed paths in any reachable ref.

## Verification

From a fresh clone after the rewrite:

```bash
git log --all -- migration/cedar-existing-backup migration/cedar-mapping-files
git rev-list --objects --all | grep -E 'cedar-existing-backup|cedar-mapping-files'
```

Both commands must return no artifact paths. A security owner should record the
date, approver, affected remotes, rotation actions, and verification result in
the incident record.
