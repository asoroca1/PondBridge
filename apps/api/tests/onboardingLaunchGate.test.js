import request from "supertest";
import { jest } from "@jest/globals";
import { generateObjectId } from "../src/utils/objectId.js";

jest.setTimeout(120000);

let app;
let connectToDatabase;
let clearAllDocuments;
let hashPassword;
let Tenant;
let User;
let Profile;

async function createReadyTenant({ slug, billingStatus = "past_due", onboardingFeePaid = false }) {
  return Tenant.create({
    name: `Camp ${slug}`,
    slug,
    status: "active",
    planTier: "base",
    onboardingStatus: "in_progress",
    onboardingStep: "review_launch",
    billingStatus,
    onboardingFeeAmount: 1200,
    onboardingFeePaid,
    theme: {
      logoUrl: "https://example.com/logo.png"
    },
    content: {
      networkDisplayName: `${slug} Alumni Network`,
      welcomeHeadline: "Welcome",
      welcomeBody: "Hello alumni"
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
      familyTrees: false,
      map: true,
      chat: true,
      relatedProfiles: true,
      newsletter: true,
      merchShop: true
    },
    onboardingDraft: {
      theme: {
        logoUrl: "https://example.com/logo.png"
      },
      content: {
        networkDisplayName: `${slug} Alumni Network`,
        welcomeHeadline: "Welcome",
        welcomeBody: "Hello alumni"
      },
      settings: {
        signupMode: "open",
        allowedEmailDomains: [],
        allowSearchByDefault: true,
        allowDirectoryBrowse: true,
        requireProfileCompletion: false
      },
      modules: {
        directory: true,
        search: true,
        familyTrees: false,
        map: true,
        chat: true,
        relatedProfiles: true,
        newsletter: true,
        merchShop: true
      }
    }
  });
}

async function seedProfiles(tenantId, count = 5) {
  const docs = [];
  for (let index = 0; index < count; index += 1) {
    const seededUser = await User.create({
      tenantId,
      email: `seed-${String(tenantId).slice(0, 8)}-${index}@example.com`,
      passwordHash: "seed-password-hash",
      roles: ["user"],
      status: "active"
    });
    docs.push({
      tenantId,
      userId: seededUser._id,
      firstName: `Seed${index}`,
      lastName: "Member",
      emails: [`seed${index}@example.com`],
      phones: [],
      cityState: "Chicago, IL",
      roleAtCamp: "Camper",
      highSchool: "",
      colleges: [],
      collegeYears: [],
      currentJobs: [],
      pastJobs: [],
      industry: "",
      socials: { linkedin: "", instagram: "", facebook: "" },
      avatarUrl: "",
      bio: ""
    });
  }
  await Profile.insertMany(docs);
}

async function createTenantAdmin(tenantId, email) {
  const passwordHash = await hashPassword("AdminPass123!");
  await User.create({
    tenantId,
    email,
    passwordHash,
    roles: ["tenant_admin", "user"],
    status: "active"
  });
}

async function loginTenant(slug, email, password) {
  const response = await request(app)
    .post(`/api/t/${slug}/auth/login`)
    .send({ email, password });

  expect(response.status).toBe(200);
  return response.body.token;
}

async function createSuperAdmin() {
  const passwordHash = await hashPassword("SuperPass123!");
  await User.create({
    tenantId: null,
    email: "super@example.com",
    passwordHash,
    roles: ["super_admin"],
    status: "active"
  });
}

async function loginSuper() {
  const response = await request(app)
    .post("/api/auth/super/login")
    .send({ email: "super@example.com", password: "SuperPass123!" });

  expect(response.status).toBe(200);
  return response.body.token;
}

beforeAll(async () => {
  process.env.JWT_SECRET = "test-jwt-secret";
  process.env.JWT_EXPIRES_IN = "1h";
  process.env.BCRYPT_ROUNDS = "4";
  process.env.FRONTEND_ORIGIN = "http://localhost:5173";
  process.env.APP_BASE_DOMAIN = "pondbridge.test";

  ({ connectToDatabase } = await import("../src/db/connect.js"));
  ({ clearAllDocuments } = await import("../src/db/supabaseDocumentModel.js"));
  ({ hashPassword } = await import("../src/utils/auth.js"));
  ({ Tenant } = await import("../src/models/Tenant.js"));
  ({ User } = await import("../src/models/User.js"));
  ({ Profile } = await import("../src/models/Profile.js"));
  ({ default: app } = await import("../src/app.js"));

  await connectToDatabase();
});

afterEach(async () => {
  await clearAllDocuments();
});

afterAll(() => {});

describe("Onboarding launch billing gate", () => {
  test("tenant admin launch is blocked when billing is not ready", async () => {
    const tenant = await createReadyTenant({
      slug: "launch-gate-camp",
      billingStatus: "past_due",
      onboardingFeePaid: false
    });

    await seedProfiles(tenant._id, 5);
    await createTenantAdmin(tenant._id, "director@launchgate.test");

    const token = await loginTenant("launch-gate-camp", "director@launchgate.test", "AdminPass123!");

    const response = await request(app)
      .post("/api/tenants/me/launch")
      .set("Authorization", `Bearer ${token}`)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error?.code).toBe("LAUNCH_BLOCKED");
    expect(response.body.error?.details?.blockers?.some((blocker) => blocker.id === "billing")).toBe(true);
  });

  test("director wizard launch is blocked when billing is not ready", async () => {
    const tenant = await createReadyTenant({
      slug: "launch-wizard-bypass",
      billingStatus: "past_due",
      onboardingFeePaid: false
    });

    await seedProfiles(tenant._id, 5);
    await createTenantAdmin(tenant._id, "director@wizardbypass.test");

    const token = await loginTenant("launch-wizard-bypass", "director@wizardbypass.test", "AdminPass123!");

    const response = await request(app)
      .post("/api/tenants/me/launch")
      .set("Authorization", `Bearer ${token}`)
      .send({
        mode: "director_wizard",
        legalAgreementAccepted: true
      });

    expect(response.status).toBe(400);
    expect(response.body.error?.code).toBe("LAUNCH_BLOCKED");
    expect(response.body.error?.details?.blockers?.some((blocker) => blocker.id === "billing")).toBe(true);
  });

  test("super admin can override billing gate on launch", async () => {
    const tenant = await createReadyTenant({
      slug: "launch-override-camp",
      billingStatus: "past_due",
      onboardingFeePaid: false
    });

    await seedProfiles(tenant._id, 5);
    await createSuperAdmin();

    const superToken = await loginSuper();

    const response = await request(app)
      .post("/api/tenants/me/launch")
      .set("Authorization", `Bearer ${superToken}`)
      .send({ tenantId: String(tenant._id), superAdminOverride: true });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.onboarding.tenant.onboardingStatus).toBe("live");
    expect(response.body.onboarding.launchMeta?.superAdminOverride).toBe(true);
  });
});
