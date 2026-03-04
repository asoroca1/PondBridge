import dotenv from "dotenv";
import { connectToDatabase } from "../src/db/connect.js";
import { TenantModel, UserModel, ProfileModel } from "../src/db/models/index.js";

dotenv.config({ path: new URL("../.env", import.meta.url).pathname });

const HIDDEN_TENANT_PATTERN =
  /(^|[-_.\s])(test\d*|sandbox|qa|staging|dev|demo)([-_.\s]|$)/i;

const FIRST_NAMES = [
  "Alex", "Jordan", "Taylor", "Casey", "Morgan", "Sam", "Jamie", "Riley", "Avery", "Parker",
  "Drew", "Skyler", "Reese", "Blair", "Rowan", "Hayden", "Lennox", "Sage", "Quinn", "Emerson",
  "Cameron", "Dakota", "Finley", "Ellis", "Marlowe", "Noah", "Mia", "Ethan", "Chloe", "Lucas",
  "Nora", "Owen", "Lila", "Mason", "Ruby", "Logan", "Zoe", "Levi", "Ivy", "Asher"
];

const LAST_NAMES = [
  "Rivera", "Chen", "Blake", "Davis", "Kim", "Thompson", "Martinez", "Johnson", "Patel", "Nguyen",
  "Foster", "Wright", "Adams", "Lee", "Campbell", "Scott", "Baker", "Clark", "Turner", "Harris",
  "Mitchell", "Brooks", "Ward", "Cooper", "Morris", "Perry", "Price", "Reed", "Bailey", "Cook",
  "Morgan", "Bell", "Murphy", "Rogers", "Diaz", "Reyes", "Sanders", "Hayes", "Powell", "Long"
];

const CITIES = [
  "Chicago, IL", "New York, NY", "Boston, MA", "Seattle, WA", "Austin, TX",
  "Miami, FL", "Denver, CO", "San Diego, CA", "Atlanta, GA", "Raleigh, NC"
];

const CAMP_ROLES = [
  "Camper",
  "Counselor",
  "Head Counselor",
  "Director",
  "Arts Instructor",
  "Lifeguard",
  "Nurse",
  "Program Staff",
  "Kitchen Staff",
  "Nature Guide"
];

const INDUSTRIES = [
  "Education",
  "Technology",
  "Healthcare",
  "Finance",
  "Marketing",
  "Legal",
  "Hospitality",
  "Media",
  "Construction",
  "Public Service"
];

const COLLEGES = [
  "University of Michigan",
  "UCLA",
  "NYU",
  "University of Texas at Austin",
  "Northwestern University",
  "University of Virginia",
  "Vanderbilt University",
  "Indiana University",
  "Emory University",
  "Boston University"
];

function envFlag(name, fallback = false) {
  const normalized = String(process.env[name] ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) return fallback;
  return ["1", "true", "yes", "on"].includes(normalized);
}

function pick(list, index, salt = 0) {
  return list[(index * 11 + salt * 7) % list.length];
}

function parseArgs(argv = []) {
  const options = {
    slug: "",
    count: 50,
    dryRun: false,
    allowLive: false,
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || "").trim();
    if (token === "--help" || token === "-h") {
      options.help = true;
      continue;
    }
    if (token === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (token === "--allow-live") {
      options.allowLive = true;
      continue;
    }
    if (token === "--slug") {
      options.slug = String(argv[i + 1] || "").trim().toLowerCase();
      i += 1;
      continue;
    }
    if (token.startsWith("--slug=")) {
      options.slug = token.split("=").slice(1).join("=").trim().toLowerCase();
      continue;
    }
    if (token === "--count") {
      options.count = Number(argv[i + 1] || 0);
      i += 1;
      continue;
    }
    if (token.startsWith("--count=")) {
      options.count = Number(token.split("=").slice(1).join("="));
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (!Number.isFinite(options.count) || options.count < 1) {
    throw new Error("--count must be a positive integer.");
  }
  options.count = Math.min(Math.trunc(options.count), 1000);

  return options;
}

function printUsage() {
  console.log("Usage:");
  console.log("  npm --workspace @pondbridge/api run seed:camp-profiles -- --slug <tenant-slug> [--count 50] [--allow-live] [--dry-run]");
  console.log("");
  console.log("Examples:");
  console.log("  npm --workspace @pondbridge/api run seed:camp-profiles -- --slug cedar --count 50 --allow-live");
  console.log("  npm --workspace @pondbridge/api run seed:camp-profiles -- --slug demo --count 50");
}

function isHiddenTenant(tenant = {}) {
  const slug = String(tenant.slug || "").trim().toLowerCase();
  const name = String(tenant.name || "").trim();
  return HIDDEN_TENANT_PATTERN.test(slug) || HIDDEN_TENANT_PATTERN.test(name);
}

function buildProfile(index, tenantSlug) {
  const firstName = pick(FIRST_NAMES, index, 1);
  const lastName = pick(LAST_NAMES, index, 2);
  const cityState = pick(CITIES, index, 3);
  const roleAtCamp = pick(CAMP_ROLES, index, 4);
  const industry = pick(INDUSTRIES, index, 5);
  const college = pick(COLLEGES, index, 6);
  const collegeYear = String(2008 + (index % 15));
  const email = `fake.${tenantSlug}.${String(index).padStart(3, "0")}@seed.pondbridge.local`;

  return {
    firstName,
    lastName,
    email,
    cityState,
    roleAtCamp,
    industry,
    highSchool: `${cityState.split(",")[0]} High School`,
    colleges: [college],
    collegeYears: [collegeYear],
    currentJobs: [
      {
        role: `${industry} Professional`,
        company: `${lastName} Group`,
        years: "2022-Present"
      }
    ],
    pastJobs: [
      {
        role: "Summer Staff",
        company: `${String(tenantSlug || "").toUpperCase()} Camp`,
        years: "2018-2021"
      }
    ],
    bio: `Fictional seed profile ${index} for tenant ${tenantSlug}.`
  };
}

async function listActiveTenantSlugs() {
  const tenants = await TenantModel.find(
    { status: "active" },
    { sort: { slug: 1 }, select: ["slug", "name", "status", "onboardingStatus"] }
  );
  return tenants.map((tenant) => ({
    slug: String(tenant.slug || ""),
    name: String(tenant.name || ""),
    onboardingStatus: String(tenant.onboardingStatus || "")
  }));
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  if (!args.slug) {
    printUsage();
    throw new Error("Missing required argument: --slug <tenant-slug>");
  }

  const nodeEnv = String(process.env.NODE_ENV || "").trim().toLowerCase();
  const allowProdSeed = envFlag("PONDBRIDGE_ALLOW_PROD_SEED", false);
  if (nodeEnv === "production" && !allowProdSeed) {
    throw new Error(
      "Refusing to run seed in production without PONDBRIDGE_ALLOW_PROD_SEED=1."
    );
  }

  await connectToDatabase();

  const tenant = await TenantModel.findBySlug(args.slug);
  if (!tenant) {
    const activeTenants = await listActiveTenantSlugs();
    const knownSlugs = activeTenants.map((item) => item.slug).filter(Boolean).join(", ");
    throw new Error(
      `Tenant "${args.slug}" not found. Active tenant slugs: ${knownSlugs || "(none)"}`
    );
  }

  if (String(tenant.status || "").toLowerCase() !== "active") {
    throw new Error(
      `Tenant "${tenant.slug}" is not active (status=${tenant.status || "unknown"}).`
    );
  }

  const hiddenTenant = isHiddenTenant(tenant);
  if (!hiddenTenant && !args.allowLive) {
    throw new Error(
      `Refusing to seed non-demo tenant "${tenant.slug}" without --allow-live.`
    );
  }

  if (args.dryRun) {
    console.log("[seed:camp-profiles] Dry run complete.");
    console.log(
      `[seed:camp-profiles] Would upsert ${args.count} profiles into tenant "${tenant.slug}" (${tenant._id}).`
    );
    return;
  }

  let createdUsers = 0;
  let updatedUsers = 0;
  let createdProfiles = 0;
  let updatedProfiles = 0;

  for (let index = 1; index <= args.count; index += 1) {
    const fake = buildProfile(index, tenant.slug);

    let user = await UserModel.findOne(tenant._id, { email: fake.email });
    if (!user) {
      user = await UserModel.create({
        tenantId: tenant._id,
        email: fake.email,
        roles: ["user"],
        status: "active"
      });
      createdUsers += 1;
    } else {
      user = await UserModel.update(user._id, {
        roles: Array.isArray(user.roles) && user.roles.length > 0 ? user.roles : ["user"],
        status: "active"
      });
      updatedUsers += 1;
    }

    const profilePayload = {
      tenantId: tenant._id,
      userId: user._id,
      firstName: fake.firstName,
      lastName: fake.lastName,
      emails: [fake.email],
      phones: [`555-${String(200 + index).padStart(3, "0")}-${String(4000 + index).padStart(4, "0")}`],
      cityState: fake.cityState,
      roleAtCamp: fake.roleAtCamp,
      highSchool: fake.highSchool,
      colleges: fake.colleges,
      collegeYears: fake.collegeYears,
      currentJobs: fake.currentJobs,
      pastJobs: fake.pastJobs,
      industry: fake.industry,
      socials: { linkedin: "", instagram: "", facebook: "", nickname: "" },
      avatarUrl: "",
      bio: fake.bio,
      status: "active"
    };

    const existingProfile = await ProfileModel.findByUserId(tenant._id, user._id);
    let profile = null;
    if (!existingProfile) {
      profile = await ProfileModel.create(profilePayload);
      createdProfiles += 1;
    } else {
      profile = await ProfileModel.update(existingProfile._id, profilePayload);
      updatedProfiles += 1;
    }

    if (String(user.profileId || "") !== String(profile._id || "")) {
      await UserModel.update(user._id, { profileId: profile._id });
    }
  }

  console.log("[seed:camp-profiles] Complete.");
  console.log(`[seed:camp-profiles] Tenant: ${tenant.slug} (${tenant._id})`);
  console.log(`[seed:camp-profiles] Requested count: ${args.count}`);
  console.log(`[seed:camp-profiles] Users created/updated: ${createdUsers}/${updatedUsers}`);
  console.log(`[seed:camp-profiles] Profiles created/updated: ${createdProfiles}/${updatedProfiles}`);
}

run().catch((error) => {
  console.error("[seed:camp-profiles] Error:", error?.message || error);
  process.exit(1);
});
