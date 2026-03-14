import path from "node:path";
import {
  CEDAR_SLUG,
  EXISTING_ARCHIVE_MANIFEST,
  EXISTING_BACKUP_DIR,
  buildArchivedTenantPatch,
  findTenantBySlug,
  parseApplyFlag,
  readJsonIfExists,
  timestampSlugSuffix,
  writeJson,
  writeMarkdown
} from "./cedarMigrationCommon.js";
import { TenantModel, UserModel } from "../src/db/models/index.js";

async function main() {
  const apply = parseApplyFlag();
  const activeCedar = await findTenantBySlug(CEDAR_SLUG);
  const previousManifest = readJsonIfExists(EXISTING_ARCHIVE_MANIFEST, null);

  if (!activeCedar) {
    if (previousManifest) {
      console.log(JSON.stringify({ ok: true, status: "already_archived", manifest: previousManifest }, null, 2));
      return;
    }
    throw new Error(`Active tenant '${CEDAR_SLUG}' was not found.`);
  }

  const suffix = timestampSlugSuffix();
  const archivedPatch = buildArchivedTenantPatch(activeCedar, { suffix });
  const affectedUsers = await UserModel.find(String(activeCedar._id), {}, { select: ["id", "email", "status"] });
  const summary = {
    apply,
    archivedAt: new Date().toISOString(),
    sourceTenant: {
      id: String(activeCedar._id),
      slug: String(activeCedar.slug || ""),
      name: String(activeCedar.name || ""),
      status: String(activeCedar.status || "")
    },
    archiveTenantPatch: archivedPatch,
    userRowsToSetInactive: affectedUsers.length
  };

  if (apply) {
    await UserModel.updateMany(String(activeCedar._id), {}, { status: "inactive" });
    const result = await TenantModel.update(String(activeCedar._id), archivedPatch);
    summary.archivedTenant = {
      id: String(result._id || activeCedar._id),
      slug: archivedPatch.slug,
      name: archivedPatch.name,
      status: archivedPatch.status
    };
    writeJson(EXISTING_ARCHIVE_MANIFEST, summary);
  }

  writeMarkdown(
    path.join(path.resolve(EXISTING_BACKUP_DIR, "..", ".."), "CEDAR_REMOVAL_SUMMARY.md"),
    `# Cedar Removal Summary

- Strategy: archive, not hard delete.
- Dry run: ${apply ? "no" : "yes"}
- Original tenant ID: \`${summary.sourceTenant.id}\`
- Original tenant slug: \`${summary.sourceTenant.slug}\`
- Archived slug target: \`${summary.archiveTenantPatch.slug}\`
- User memberships set inactive: ${summary.userRowsToSetInactive}

## Why archive instead of delete

The existing PondBridge Cedar tenant only contained seeded/demo data. Archiving it with a new slug and inactive status preserves a rollback path, avoids the production hard-delete path, and frees the canonical \`cedar\` slug for the migrated replacement tenant.

## Database changes

${apply ? "- Updated the original Cedar tenant to an archived slug and inactive status." : "- No database writes were performed."}
${apply ? "\n- Set every user row attached to the archived Cedar tenant to `inactive` to avoid accidental cross-tenant identity conflicts later." : ""}

## Artifacts

- Backup exports: \`migration/cedar-existing-backup/*\`
- Archive manifest: \`migration/cedar-existing-backup/cedar-archive-manifest.json\`
`
  );

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error("[archiveOrRemoveExistingCedar] failed", error);
  process.exit(1);
});
