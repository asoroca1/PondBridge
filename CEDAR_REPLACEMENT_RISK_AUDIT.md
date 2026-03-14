# Cedar Replacement Risk Audit

## Highest risks

### Cross-tenant data damage

- Risk: deleting or overwriting rows outside Camp Cedar.
- Mitigation: every backup/archive/import script scopes writes by Cedar tenant ID or by the new Cedar tenant ID only. Non-Cedar tenant inventory is exported before changes and checked again during validation.

### Identity collision across tenants

- Risk: importing Cedar users whose emails or Clerk identities already belong to other active tenants.
- Mitigation: the legacy email overlap audit found only one existing PondBridge match, `aden@sorocafamily.com`, and it exists only as a global super-admin row. No active non-Cedar tenant memberships overlap the legacy Cedar email set.

### Incorrect auth migration assumptions

- Risk: claiming password migration works when Clerk cannot consume the legacy hashes.
- Mitigation: the legacy app was inspected directly; all passwords are bcrypt `$2b$12` hashes. The installed Clerk Backend SDK and official Clerk docs both support `passwordDigest` with `passwordHasher: "bcrypt"`.

### Irreversible destructive cleanup

- Risk: hard-deleting the seeded Cedar tenant removes rollback options.
- Mitigation: the current Cedar tenant is archived instead of hard-deleted. JSON exports are also written before any mutation.

## Medium risks

### Cedar content with missing media

- Risk: some legacy S3-backed photos or newsletters fail during copy to R2.
- Mitigation: uploads are attempted item-by-item and failures are recorded. If a media copy fails, the import summary records it for manual follow-up.

### Legacy role confusion

- Risk: mapping legacy `roles: ["Admin"]` to PondBridge `tenant_admin` would create too many directors/admins.
- Mitigation: legacy admin access came from env allowlists, not the role array. Only Aden is promoted to `tenant_admin`.

### Stale Clerk tenant metadata for Aden

- Risk: overwriting Aden’s current Clerk `publicMetadata.tenantId` could interfere with other workflows.
- Mitigation: the migration links Aden’s Cedar membership by `clerk_user_id` at the app-user row level and does not rely on overwriting Clerk tenant metadata.

## Low risks

### ID collisions

- Risk: preserving legacy Mongo `_id` values collides with an unrelated PondBridge row.
- Mitigation: legacy IDs are 24-char hex strings and the data volume is small. The migration preserves IDs for reference integrity and records explicit mappings in `migration/cedar-mapping-files`.

### Prelaunch signup ambiguity

- Risk: importing prelaunch signups into the wrong PondBridge table would create misleading memberships or auth state.
- Mitigation: those rows are audited and preserved, but not imported automatically.
