# Backup Summary

- Backed up the current PondBridge Cedar tenant before replacement.
- Tenant ID: `c674696ffa32fbc19bb1f311`
- Tenant slug: `cedar`
- Tenant name: Camp Cedar
- Export timestamp: 2026-03-13T20:52:36.690Z

## Exported artifacts

- `users`: 3 row(s) -> `migration/cedar-existing-backup/users.json`
- `profiles`: 3 row(s) -> `migration/cedar-existing-backup/profiles.json`
- `invites`: 0 row(s) -> `migration/cedar-existing-backup/invites.json`
- `access_requests`: 0 row(s) -> `migration/cedar-existing-backup/access_requests.json`
- `magic_link_tokens`: 0 row(s) -> `migration/cedar-existing-backup/magic_link_tokens.json`
- `conversations`: 0 row(s) -> `migration/cedar-existing-backup/conversations.json`
- `messages`: 0 row(s) -> `migration/cedar-existing-backup/messages.json`
- `forums`: 0 row(s) -> `migration/cedar-existing-backup/forums.json`
- `forum_posts`: 0 row(s) -> `migration/cedar-existing-backup/forum_posts.json`
- `photos`: 0 row(s) -> `migration/cedar-existing-backup/photos.json`
- `newsletters`: 0 row(s) -> `migration/cedar-existing-backup/newsletters.json`
- `email_broadcasts`: 0 row(s) -> `migration/cedar-existing-backup/email_broadcasts.json`
- `family_trees`: 0 row(s) -> `migration/cedar-existing-backup/family_trees.json`
- `analytics_events`: 2 row(s) -> `migration/cedar-existing-backup/analytics_events.json`
- `import_reports`: 0 row(s) -> `migration/cedar-existing-backup/import_reports.json`
- `tenant_admin_audit_logs`: 0 row(s) -> `migration/cedar-existing-backup/tenant_admin_audit_logs.json`
- `resume_parse_results`: 0 row(s) -> `migration/cedar-existing-backup/resume_parse_results.json`
- `activity_items`: 0 row(s) -> `migration/cedar-existing-backup/activity_items.json`
- `resend_webhook_events`: 0 row(s) -> `migration/cedar-existing-backup/resend_webhook_events.json`
- `stripe_webhook_events`: 0 row(s) -> `migration/cedar-existing-backup/stripe_webhook_events.json`
- `email_suppressions`: 0 row(s) -> `migration/cedar-existing-backup/email_suppressions.json`

- Non-Cedar tenant inventory: `migration/cedar-existing-backup/non_cedar_tenants.json`
- Tenant snapshot: `migration/cedar-existing-backup/tenant.json`

## Recovery note

The original Cedar tenant data is preserved as JSON exports in `migration/cedar-existing-backup`. The replacement flow archives the seeded tenant in the database instead of hard-deleting it, so rollback can use either the archived tenant row or these exported files.
