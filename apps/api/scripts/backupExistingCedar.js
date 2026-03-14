import path from "node:path";
import {
  CEDAR_SLUG,
  EXISTING_BACKUP_DIR,
  exportTenantBackup,
  findTenantBySlug,
  writeJson,
  writeMarkdown
} from "./cedarMigrationCommon.js";

async function main() {
  const tenant = await findTenantBySlug(CEDAR_SLUG);
  if (!tenant) {
    throw new Error(`Tenant '${CEDAR_SLUG}' was not found. Nothing to back up.`);
  }

  const summary = await exportTenantBackup({
    tenant,
    outputDir: EXISTING_BACKUP_DIR
  });

  writeJson(path.join(EXISTING_BACKUP_DIR, "backup-summary.json"), summary);
  writeMarkdown(
    path.join(path.resolve(EXISTING_BACKUP_DIR, "..", ".."), "BACKUP_SUMMARY.md"),
    `# Backup Summary

- Backed up the current PondBridge Cedar tenant before replacement.
- Tenant ID: \`${summary.tenant.id}\`
- Tenant slug: \`${summary.tenant.slug}\`
- Tenant name: ${summary.tenant.name}
- Export timestamp: ${summary.exportedAt}

## Exported artifacts

${Object.entries(summary.tables)
  .map(([table, info]) => `- \`${table}\`: ${info.count} row(s) -> \`migration/cedar-existing-backup/${info.file}\``)
  .join("\n")}

- Non-Cedar tenant inventory: \`migration/cedar-existing-backup/non_cedar_tenants.json\`
- Tenant snapshot: \`migration/cedar-existing-backup/tenant.json\`

## Recovery note

The original Cedar tenant data is preserved as JSON exports in \`migration/cedar-existing-backup\`. The replacement flow archives the seeded tenant in the database instead of hard-deleting it, so rollback can use either the archived tenant row or these exported files.
`
  );

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error("[backupExistingCedar] failed", error);
  process.exit(1);
});
