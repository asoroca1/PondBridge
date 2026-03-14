import path from "node:path";
import {
  CEDAR_SLUG,
  EXISTING_ARCHIVE_MANIFEST,
  EXISTING_BACKUP_DIR,
  IMPORT_SUMMARY_JSON,
  MAPPING_DIR,
  NEW_TENANT_MANIFEST,
  fetchTenantInventory,
  findTenantBySlug,
  readJsonIfExists,
  stableJson,
  writeJson,
  writeMarkdown
} from "./cedarMigrationCommon.js";
import { getSupabaseAdmin } from "../src/db/supabaseAdmin.js";

async function count(table, filterBuilder) {
  let query = getSupabaseAdmin().from(table).select("id", { count: "exact", head: true });
  query = filterBuilder(query);
  const { count: total, error } = await query;
  if (error) throw error;
  return Number(total || 0);
}

async function main() {
  const tenant = await findTenantBySlug(CEDAR_SLUG);
  const backupSummary = readJsonIfExists(path.join(EXISTING_BACKUP_DIR, "backup-summary.json"), {});
  const archiveManifest = readJsonIfExists(EXISTING_ARCHIVE_MANIFEST, {});
  const importSummary = readJsonIfExists(IMPORT_SUMMARY_JSON, {});
  const newTenantManifest = readJsonIfExists(NEW_TENANT_MANIFEST, {});
  const priorNonCedarTenants = readJsonIfExists(path.join(EXISTING_BACKUP_DIR, "non_cedar_tenants.json"), []);
  const currentTenants = await fetchTenantInventory();

  if (!tenant) {
    throw new Error("Validated tenant 'cedar' was not found.");
  }

  const tenantId = String(tenant._id);
  const counts = {
    users: await count("users", (query) => query.eq("tenant_id", tenantId)),
    profiles: await count("profiles", (query) => query.eq("tenant_id", tenantId)),
    conversations: await count("conversations", (query) => query.eq("tenant_id", tenantId)),
    messages: await count("messages", (query) => query.eq("tenant_id", tenantId)),
    forums: await count("forums", (query) => query.eq("tenant_id", tenantId)),
    forum_posts: await count("forum_posts", (query) => query.eq("tenant_id", tenantId)),
    photos: await count("photos", (query) => query.eq("tenant_id", tenantId)),
    newsletters: await count("newsletters", (query) => query.eq("tenant_id", tenantId)),
    family_trees: await count("family_trees", (query) => query.eq("tenant_id", tenantId)),
    activity_items: await count("activity_items", (query) => query.eq("tenant_id", tenantId))
  };

  const { data: profileRows, error: profileError } = await getSupabaseAdmin()
    .from("profiles")
    .select("id,user_id")
    .eq("tenant_id", tenantId);
  if (profileError) throw profileError;

  const { data: tenantUsers, error: userError } = await getSupabaseAdmin()
    .from("users")
    .select("id,email,roles,status,clerk_user_id")
    .eq("tenant_id", tenantId);
  if (userError) throw userError;
  const validUserIds = new Set((tenantUsers || []).map((row) => String(row.id || "")));
  const orphanedProfiles = (profileRows || []).filter((row) => !validUserIds.has(String(row.user_id || "")));

  const duplicateEmails = [];
  const seenEmails = new Set();
  for (const row of tenantUsers || []) {
    const email = String(row.email || "").trim().toLowerCase();
    if (!email) continue;
    if (seenEmails.has(email)) duplicateEmails.push(email);
    seenEmails.add(email);
  }

  const aden = (tenantUsers || []).find((row) => String(row.email || "").trim().toLowerCase() === "aden@sorocafamily.com");
  const currentNonCedarTenants = currentTenants.filter((row) => String(row.id || "") !== tenantId);
  const preservedNonCedar = priorNonCedarTenants.every((previous) =>
    currentNonCedarTenants.some((current) => String(current.id || "") === String(previous.id || ""))
  );
  const legacyStats = importSummary?.legacyStats || {};
  const archivedCounts = Object.fromEntries(
    Object.entries(backupSummary?.tables || {}).map(([key, value]) => [key, Number(value?.count || 0)])
  );
  const countComparisons = {
    users: { legacy: Number(legacyStats.users ?? 0), imported: counts.users },
    profiles: { legacy: Number(legacyStats.users ?? 0), imported: counts.profiles },
    activities: { legacy: Number(legacyStats.activities ?? 0), imported: counts.activity_items },
    forums: { legacy: Number(legacyStats.forums ?? 0), imported: counts.forums },
    forumPosts: { legacy: Number(legacyStats.forumPosts ?? 0), imported: counts.forum_posts },
    conversations: { legacy: Number(legacyStats.conversations ?? 0), imported: counts.conversations },
    messages: { legacy: Number(legacyStats.messages ?? 0), imported: counts.messages },
    photos: { legacy: Number(legacyStats.photos ?? 0), imported: counts.photos },
    newsletters: { legacy: Number(legacyStats.newsletters ?? 0), imported: counts.newsletters },
    familyTrees: { legacy: Number(legacyStats.familyTrees ?? 0), imported: counts.family_trees }
  };
  const migrationExceptions = [];
  if (countComparisons.conversations.imported !== countComparisons.conversations.legacy) {
    migrationExceptions.push(
      `Conversations imported ${countComparisons.conversations.imported} of ${countComparisons.conversations.legacy}; unresolved legacy participant references were skipped instead of creating orphaned tenant data.`
    );
  }
  if (countComparisons.forums.imported !== countComparisons.forums.legacy) {
    migrationExceptions.push(
      `Forums imported ${countComparisons.forums.imported} of ${countComparisons.forums.legacy}; one placeholder forum was created to retain a legacy forum post whose source forum row was missing.`
    );
  }
  if (countComparisons.messages.imported !== countComparisons.messages.legacy) {
    migrationExceptions.push(
      `Messages imported ${countComparisons.messages.imported} of ${countComparisons.messages.legacy}; messages whose senders were missing from legacy users were skipped.`
    );
  }
  for (const errorEntry of importSummary?.newsletters?.mediaSummary?.errors || []) {
    migrationExceptions.push(
      `Newsletter ${String(errorEntry?.newsletterId || "")} kept its legacy PDF payload because the remote file exceeded the 100 MB import safety limit.`
    );
  }

  const report = {
    validatedAt: new Date().toISOString(),
    tenant: {
      id: tenantId,
      slug: tenant.slug,
      name: tenant.name,
      status: tenant.status
    },
    archivedSeededCounts: archivedCounts,
    counts,
    countComparisons,
    archivedSeededTenant: archiveManifest?.archiveTenantPatch?.slug || null,
    importedTenantManifest: newTenantManifest,
    backupSummary,
    importSummary,
    validations: {
      cedarTenantExists: true,
      nonCedarTenantsPreserved: preservedNonCedar,
      orphanedProfiles: (orphanedProfiles || []).length,
      duplicateEmails: duplicateEmails.length,
      adenIsTenantAdmin: Boolean(
        aden &&
          Array.isArray(aden.roles) &&
          aden.roles.includes("tenant_admin") &&
          aden.clerk_user_id
      )
    },
    migrationExceptions
  };

  writeJson(path.join(MAPPING_DIR, "cedar-validation-summary.json"), report);
  writeMarkdown(
    path.join(path.resolve(MAPPING_DIR, "..", ".."), "VALIDATION_REPORT.md"),
    `# Validation Report

- Validation timestamp: ${report.validatedAt}
- Cedar tenant present: yes
- Cedar tenant ID: \`${tenantId}\`
- Archived seeded Cedar slug: \`${report.archivedSeededTenant || "n/a"}\`
- Non-Cedar tenants preserved: ${report.validations.nonCedarTenantsPreserved ? "yes" : "no"}
- Orphaned Cedar profiles: ${report.validations.orphanedProfiles}
- Duplicate Cedar emails: ${report.validations.duplicateEmails}
- Aden assigned as tenant admin with Clerk linkage: ${report.validations.adenIsTenantAdmin ? "yes" : "no"}

## Cedar record counts

${Object.entries(counts)
  .map(([key, value]) => `- \`${key}\`: ${value}`)
  .join("\n")}

## Archived seeded Cedar counts

${Object.entries(archivedCounts)
  .map(([key, value]) => `- \`${key}\`: ${value}`)
  .join("\n")}

## Source comparisons

${Object.entries(countComparisons)
  .map(([key, value]) => `- \`${key}\`: legacy ${value.legacy}, imported ${value.imported}`)
  .join("\n")}

## Notes

- The original seeded Cedar tenant was archived instead of hard-deleted.
- Prelaunch signup rows from the legacy system were intentionally preserved in audit artifacts only, because there is no like-for-like PondBridge tenant table for those records.
- Migration exceptions:
${migrationExceptions.length ? migrationExceptions.map((note) => `  - ${note}`).join("\n") : "  - none"}
- Validation details JSON: \`migration/cedar-mapping-files/cedar-validation-summary.json\`
`
  );

  console.log(stableJson(report));
}

main().catch((error) => {
  console.error("[validateCedarMigration] failed", error);
  process.exit(1);
});
