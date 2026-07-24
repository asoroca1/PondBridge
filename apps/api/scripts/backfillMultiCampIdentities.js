import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { assertReviewedMigrationTarget } from "./applyPlatformAuditSchema.js";
import {
  IdentityModel,
  TenantMembershipModel,
  UserModel
} from "../src/db/models/index.js";
import {
  buildMultiCampIdentityBackfillPlan,
  summarizeMultiCampIdentityBackfillPlan
} from "../src/services/multiCampIdentityMigration.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

async function loadAllUsers() {
  const users = [];
  const limit = 1000;
  for (let page = 0; page < 500; page += 1) {
    const batch = await UserModel.find({}, { limit, offset: page * limit, sort: { createdAt: 1 } });
    users.push(...batch);
    if (batch.length < limit) break;
  }
  return users;
}

async function applyPlan(plan) {
  let identitiesCreated = 0;
  let membershipsCreated = 0;
  let existingRows = 0;
  for (const planned of plan.identities) {
    let identity = planned.clerkUserId
      ? await IdentityModel.findOne({ clerkUserId: planned.clerkUserId })
      : null;
    if (!identity) identity = await IdentityModel.findOne({ primaryEmail: planned.primaryEmail });
    if (!identity) {
      identity = await IdentityModel.create({
        clerkUserId: planned.clerkUserId || null,
        primaryEmail: planned.primaryEmail,
        verifiedEmails: planned.verifiedEmails,
        platformRoles: planned.platformRoles,
        status: "active",
        metadata: { migration: "legacy_users_v1" }
      });
      identitiesCreated += 1;
    } else {
      existingRows += 1;
    }

    for (const membership of planned.memberships) {
      const existing = await TenantMembershipModel.findOne({ legacyUserId: membership.legacyUserId });
      if (existing) {
        existingRows += 1;
        continue;
      }
      await TenantMembershipModel.create({
        ...membership,
        identityId: identity._id
      });
      membershipsCreated += 1;
    }
  }
  return { identitiesCreated, membershipsCreated, existingRows };
}

async function run() {
  const users = await loadAllUsers();
  const plan = buildMultiCampIdentityBackfillPlan(users);
  const summary = summarizeMultiCampIdentityBackfillPlan(plan);
  const apply = process.argv.includes("--apply");
  if (!apply) {
    console.log(JSON.stringify({ mode: "dry-run", apply: false, ...summary }, null, 2));
    return;
  }
  assertReviewedMigrationTarget({
    targetEnvironment: process.env.PONDBRIDGE_TARGET_ENV,
    acknowledgement: process.env.PONDBRIDGE_MULTI_CAMP_BACKFILL_ACK,
    connectionString: process.env.SUPABASE_DB_URL,
    requiredAcknowledgement: "apply-multi-camp-backfill-staging"
  });
  if (summary.collisionCount > 0) {
    throw new Error("Backfill is blocked until every hashed identity collision is reviewed and resolved.");
  }
  const applied = await applyPlan(plan);
  console.log(JSON.stringify({ mode: "apply", apply: true, ...summary, applied }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  run().catch((error) => {
    console.error(`[multi-camp-backfill] ${error.message}`);
    process.exitCode = 1;
  });
}
