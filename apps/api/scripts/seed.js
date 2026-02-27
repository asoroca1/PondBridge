import dotenv from "dotenv";
import { connectToDatabase } from "../src/db/connect.js";
import { TenantModel } from "../src/db/models/index.js";
import { UserModel } from "../src/db/models/index.js";
import { ProfileModel } from "../src/db/models/index.js";
import { hashPassword } from "../src/utils/auth.js";

dotenv.config({ path: new URL("../.env", import.meta.url).pathname });

function envFlag(name, fallback = false) {
  const normalized = String(process.env[name] ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) return fallback;
  return ["1", "true", "yes", "on"].includes(normalized);
}

async function upsertUser(tenantId, email, passwordHash, roles) {
  const existing = tenantId
    ? await UserModel.findOne(tenantId, { email })
    : await UserModel.findOne({ email });

  if (existing) {
    return UserModel.update(existing._id, { passwordHash, roles, status: "active" });
  }

  return UserModel.create({
    tenantId: tenantId || null,
    email,
    passwordHash,
    roles,
    status: "active"
  });
}

async function upsertProfile({ tenantId, userId, email, firstName, lastName, roleAtCamp, industry }) {
  const existing = await ProfileModel.findByUserId(tenantId, userId);

  const data = {
    tenantId,
    userId,
    firstName,
    lastName,
    emails: [email],
    phones: [],
    cityState: "Chicago, IL",
    roleAtCamp,
    highSchool: "",
    colleges: ["University of Michigan"],
    collegeYears: ["2022"],
    currentJobs: [{ role: "Analyst", company: "PondBridge", years: "2024-Present" }],
    pastJobs: [{ role: "Intern", company: "Cedar Outfitters", years: "2022-2023" }],
    industry,
    socials: { linkedin: "", instagram: "", facebook: "" },
    avatarUrl: "",
    bio: ""
  };

  if (existing) {
    return ProfileModel.update(existing._id, data);
  }

  return ProfileModel.create(data);
}

async function run() {
  const nodeEnv = String(process.env.NODE_ENV || "").trim().toLowerCase();
  const allowProdSeed = envFlag("PONDBRIDGE_ALLOW_PROD_SEED", false);
  const allowLegacyDemoDelete = envFlag("PONDBRIDGE_SEED_DELETE_LEGACY_DEMO", false);

  if (nodeEnv === "production" && !allowProdSeed) {
    throw new Error(
      "Refusing to run seed in production without PONDBRIDGE_ALLOW_PROD_SEED=1."
    );
  }

  await connectToDatabase();

  const defaultChecklist = [
    { id: "name_branding", label: "Brand your network", status: "not_started", completedAt: null },
    { id: "welcome_message", label: "Name and welcome message", status: "not_started", completedAt: null },
    { id: "signup_controls", label: "Choose who can join", status: "not_started", completedAt: null },
    { id: "import_alumni", label: "Import your alumni list", status: "not_started", completedAt: null },
    { id: "modules", label: "Enable modules", status: "not_started", completedAt: null },
    { id: "review_launch", label: "Review and launch", status: "not_started", completedAt: null }
  ];

  const cedarTheme = {
    brandPrimary: "#002b5c",
    brandSecondary: "#d3dde8",
    brandAccent: "#f2b134",
    bg: "#f5f7fa",
    text: "#0f172a",
    card: "#ffffff",
    logoUrl: "",
    heroImageUrl: "",
    typography: "Inter",
    fontFamily: "Inter",
    fontToken: "cedar_default"
  };

  // Remove legacy demo tenant if it exists.
  const legacyDemoTenant = await TenantModel.findBySlug("demo-camp");
  if (legacyDemoTenant?._id && allowLegacyDemoDelete) {
    const demoTid = legacyDemoTenant._id;
    await Promise.all([
      ProfileModel.deleteMany(demoTid, {}),
      UserModel.deleteMany(demoTid, {})
    ]);
    await TenantModel.delete(demoTid);
  } else if (legacyDemoTenant?._id && !allowLegacyDemoDelete) {
    console.log(
      "[seed] Skipping legacy demo tenant deletion (set PONDBRIDGE_SEED_DELETE_LEGACY_DEMO=1 to enable)."
    );
  }

  const tenantData = {
    name: "Camp Cedar",
    slug: "cedar",
    status: "active",
    planTier: "premium",
    billingStatus: "active",
    stripeCustomerId: "",
    stripeSubscriptionId: "",
    stripePriceId: "",
    onboardingStatus: "live",
    onboardingFeeAmount: 2500,
    onboardingFeePaid: true,
    onboardingFeeInvoiceId: "",
    onboardingStep: "review_launch",
    onboardingChecklist: defaultChecklist.map((item) => ({
      ...item,
      status: "completed",
      completedAt: new Date().toISOString()
    })),
    onboardingProgress: {
      currentStep: 6,
      completedSteps: [1, 2, 3, 4, 5, 6],
      lastSavedAt: new Date().toISOString(),
      launchedAt: new Date().toISOString(),
      lastImportStats: {
        imported: 3,
        skipped: 0,
        rowsRead: 3
      }
    },
    theme: cedarTheme,
    content: {
      networkDisplayName: "Camp Cedar Alumni Network",
      welcomeHeadline: "Welcome to Camp Cedar Alumni Network",
      welcomeBody: "Reconnect with campers, staff, and directors from every era.",
      aboutText: "Camp Cedar alumni can reconnect, share memories, and support each other.",
      contactEmail: "admin@campcedar.local",
      supportUrl: "",
      footerLinks: []
    },
    settings: {
      signupMode: "open",
      accessCodeHash: "",
      accessCodeHint: "",
      allowedEmailDomains: [],
      allowSearchByDefault: true,
      allowDirectoryBrowse: true,
      requireProfileCompletion: false
    },
    modules: {
      directory: true,
      search: true,
      photoStream: true,
      chat: true,
      map: true,
      familyTrees: true,
      relatedProfiles: true,
      newsletter: true,
      merchShop: true
    },
    accessSettings: { signupMode: "open", accessCode: "" },
    launch: {
      launchedAt: new Date().toISOString(),
      launchedByUserId: null
    }
  };

  // Upsert the tenant
  const existingTenant = await TenantModel.findBySlug("cedar");
  const legacyTenant = existingTenant ? null : await TenantModel.findBySlug("camp-cedar");
  const tenant = existingTenant
    ? await TenantModel.update(existingTenant._id, tenantData)
    : legacyTenant
      ? await TenantModel.update(legacyTenant._id, tenantData)
      : await TenantModel.create(tenantData);

  const tenantAdminPassword = await hashPassword("Pondbridge123!");
  const memberPassword = await hashPassword("Pondbridge123!");
  const superAdminPassword = await hashPassword("SuperAdmin123!");

  const tenantAdminUser = await upsertUser(
    tenant._id,
    "admin@campcedar.local",
    tenantAdminPassword,
    ["tenant_admin", "user"]
  );

  const memberOne = await upsertUser(
    tenant._id,
    "camper1@campcedar.local",
    memberPassword,
    ["user"]
  );

  const memberTwo = await upsertUser(
    tenant._id,
    "staff1@campcedar.local",
    memberPassword,
    ["user"]
  );

  await upsertUser(
    null,
    "superadmin@pondbridge.local",
    superAdminPassword,
    ["super_admin"]
  );

  const adminProfile = await upsertProfile({
    tenantId: tenant._id,
    userId: tenantAdminUser._id,
    email: tenantAdminUser.email,
    firstName: "Cedar",
    lastName: "Admin",
    roleAtCamp: "Director",
    industry: "Education"
  });

  const memberOneProfile = await upsertProfile({
    tenantId: tenant._id,
    userId: memberOne._id,
    email: memberOne.email,
    firstName: "Jordan",
    lastName: "Camper",
    roleAtCamp: "Camper",
    industry: "Finance"
  });

  const memberTwoProfile = await upsertProfile({
    tenantId: tenant._id,
    userId: memberTwo._id,
    email: memberTwo.email,
    firstName: "Taylor",
    lastName: "Counselor",
    roleAtCamp: "Staff",
    industry: "Health"
  });

  await UserModel.update(tenantAdminUser._id, { profileId: adminProfile._id });
  await UserModel.update(memberOne._id, { profileId: memberOneProfile._id });
  await UserModel.update(memberTwo._id, { profileId: memberTwoProfile._id });

  console.log("Seed complete");
  console.log("Tenant URL: http://localhost:5173/t/cedar");
  console.log("Tenant admin login: admin@campcedar.local / Pondbridge123!");
  console.log("Member login: camper1@campcedar.local / Pondbridge123!");
  console.log("Super admin login: superadmin@pondbridge.local / SuperAdmin123!");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
