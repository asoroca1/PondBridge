import crypto from "crypto";
import dotenv from "dotenv";
import { normalizeSlug } from "@pondbridge/shared";
import { connectToDatabase } from "../src/db/connect.js";
import { ProfileModel, TenantModel, UserModel } from "../src/db/models/index.js";
import { hashPassword } from "../src/utils/auth.js";

dotenv.config({ path: new URL("../.env", import.meta.url).pathname });

const RESERVED_SUBDOMAINS = new Set(["www", "app", "api", "super"]);
const BASE_DOMAIN = "pondbridgealumni.com";
const ACCESS_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function parseArgs(argv = []) {
  const args = Array.isArray(argv) ? [...argv] : [];
  const options = {
    campName: "",
    slug: "",
    networkName: "",
    directorEmail: "",
    accessCode: ""
  };

  while (args.length) {
    const raw = String(args.shift() || "").trim();
    if (!raw) continue;
    if (!raw.startsWith("--")) {
      if (!options.campName) options.campName = raw;
      continue;
    }

    const [keyRaw, inlineValue] = raw.split("=", 2);
    const key = String(keyRaw || "").trim();
    const nextValue = inlineValue ?? String(args.shift() || "").trim();

    if (key === "--slug") options.slug = nextValue;
    if (key === "--network-name") options.networkName = nextValue;
    if (key === "--director-email") options.directorEmail = nextValue;
    if (key === "--access-code") options.accessCode = nextValue;
  }

  return options;
}

function defaultChecklistCompletedNow() {
  const nowIso = new Date().toISOString();
  return [
    { id: "name_branding", label: "Brand your network", status: "completed", completedAt: nowIso },
    { id: "welcome_message", label: "Name and welcome message", status: "completed", completedAt: nowIso },
    { id: "signup_controls", label: "Choose who can join", status: "completed", completedAt: nowIso },
    { id: "import_alumni", label: "Import your alumni list", status: "completed", completedAt: nowIso },
    { id: "modules", label: "Enable modules", status: "completed", completedAt: nowIso },
    { id: "review_launch", label: "Review and launch", status: "completed", completedAt: nowIso }
  ];
}

function cedarThemeWithoutLogo() {
  return {
    brandPrimary: "#002b5c",
    brandSecondary: "#d3dde8",
    brandAccent: "#f2b134",
    bg: "#f5f7fa",
    text: "#0f172a",
    card: "#ffffff",
    logoUrl: "",
    heroImageUrl: "",
    fontToken: "cedar_default"
  };
}

function defaultModules() {
  return {
    directory: true,
    search: true,
    photoStream: true,
    chat: true,
    map: true,
    familyTrees: true,
    relatedProfiles: true,
    newsletter: true,
    merchShop: true
  };
}

function defaultDomain(slug = "") {
  return `${String(slug || "").trim().toLowerCase()}.${BASE_DOMAIN}`;
}

function normalizeEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function generateAccessCode(length = 8) {
  let code = "";
  for (let index = 0; index < length; index += 1) {
    const randomIndex = crypto.randomInt(0, ACCESS_CODE_ALPHABET.length);
    code += ACCESS_CODE_ALPHABET[randomIndex];
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

function generateInternalDirectorPassword() {
  return `DemoDirector!${crypto.randomBytes(12).toString("hex")}`;
}

function assertInput({ campName = "", slug = "" }) {
  if (!campName) {
    throw new Error(
      "Missing camp name. Usage: npm --workspace @pondbridge/api run demo:create -- <campName> [--network-name \"Demo (Camp) Network\"]"
    );
  }
  if (!slug) {
    throw new Error("Unable to resolve slug from camp name. Provide --slug.");
  }
  if (RESERVED_SUBDOMAINS.has(slug)) {
    throw new Error(`Slug "${slug}" is reserved. Choose a different slug.`);
  }
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const campName = String(options.campName || "").trim();
  const slug = normalizeSlug(String(options.slug || campName).trim());
  assertInput({ campName, slug });

  const networkName =
    String(options.networkName || "").trim() || `Demo (${campName}) Network`;
  const directorEmail =
    normalizeEmail(options.directorEmail) || `director+${slug}@demo.pondbridge.local`;
  const accessCode = String(options.accessCode || "").trim().toUpperCase() || generateAccessCode(8);
  const accessCodeHash = await hashPassword(accessCode);
  const directorPasswordHash = await hashPassword(generateInternalDirectorPassword());
  const nowIso = new Date().toISOString();

  await connectToDatabase();

  const existing = await TenantModel.findBySlug(slug);
  if (existing) {
    throw new Error(`Tenant slug "${slug}" already exists. Use a new camp name or --slug.`);
  }

  const tenant = await TenantModel.create({
    name: campName,
    slug,
    status: "active",
    planTier: "premium",
    billingStatus: "active",
    onboardingStatus: "live",
    onboardingStep: "review_launch",
    onboardingChecklist: defaultChecklistCompletedNow(),
    onboardingProgress: {
      currentStep: 6,
      completedSteps: [1, 2, 3, 4, 5, 6],
      lastSavedAt: nowIso,
      launchedAt: nowIso
    },
    customDomain: defaultDomain(slug),
    theme: cedarThemeWithoutLogo(),
    content: {
      campType: "coed",
      networkDisplayName: networkName,
      welcomeHeadline: `Welcome to ${networkName}`,
      welcomeBody: "Explore the demo network with your team.",
      newsletterName: "Newsletter",
      ageGroups: [
        "Super Warrior",
        "Warrior",
        "Freshman",
        "Sophomore",
        "Junior",
        "Intermediate",
        "Senior I",
        "Senior II"
      ],
      staffRoles: ["Camper", "Counselor", "JC", "CIT", "Admin"],
      merchShopUrl: "",
      aboutText: `Demo environment for ${campName}.`,
      contactEmail: directorEmail,
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
      requireProfileCompletion: false,
      demoAccess: {
        enabled: true,
        codeHash: accessCodeHash,
        codeHint: `Generated ${new Date().toLocaleDateString("en-US")}`,
        directorEmail,
        directorUserId: ""
      }
    },
    modules: defaultModules(),
    accessSettings: { signupMode: "open", accessCode: "" },
    launch: {
      launchedAt: nowIso,
      launchedByUserId: null
    }
  });

  const directorUser = await UserModel.create({
    tenantId: tenant._id,
    email: directorEmail,
    passwordHash: directorPasswordHash,
    roles: ["tenant_admin", "user"],
    status: "active"
  });

  const directorProfile = await ProfileModel.create({
    tenantId: tenant._id,
    userId: directorUser._id,
    firstName: "Demo",
    lastName: "Director",
    emails: [directorEmail],
    phones: [],
    cityState: "",
    roleAtCamp: "Director",
    highSchool: "",
    colleges: [],
    collegeYears: [],
    currentJobs: [],
    pastJobs: [],
    industry: "",
    socials: {},
    avatarUrl: "",
    bio: ""
  });

  await UserModel.update(directorUser._id, { profileId: directorProfile._id });

  const updatedSettings = {
    ...(tenant.settings || {}),
    demoAccess: {
      ...(tenant.settings?.demoAccess || {}),
      enabled: true,
      codeHash: accessCodeHash,
      directorEmail,
      directorUserId: directorUser._id
    }
  };
  await TenantModel.update(tenant._id, { settings: updatedSettings });

  const domain = defaultDomain(slug);
  const appUrl = domain.endsWith(".localhost") ? `http://${domain}` : `https://${domain}`;

  console.log(`[demo:create] camp=${campName}`);
  console.log(`[demo:create] slug=${slug}`);
  console.log(`[demo:create] domain=${domain}`);
  console.log(`[demo:create] login_url=${appUrl}/login`);
  console.log(`[demo:create] access_code=${accessCode}`);
}

run().catch((error) => {
  console.error("[demo:create] failed", String(error?.message || error));
  process.exitCode = 1;
});
