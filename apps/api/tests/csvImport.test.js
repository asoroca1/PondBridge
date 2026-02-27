import request from "supertest";
import { jest } from "@jest/globals";

jest.setTimeout(120000);

let app;
let connectToDatabase;
let clearAllDocuments;
let hashPassword;
let Tenant;
let User;
let Profile;

async function createUserWithProfile({ tenant, email, password, roles, firstName, lastName, cityState }) {
  const passwordHash = await hashPassword(password);

  const user = await User.create({
    tenantId: tenant ? tenant._id : null,
    email,
    passwordHash,
    roles,
    status: "active"
  });

  if (!tenant) return { user, profile: null };

  const profile = await Profile.create({
    tenantId: tenant._id,
    userId: user._id,
    firstName,
    lastName,
    emails: [email],
    phones: [],
    cityState: cityState || "Chicago, IL",
    roleAtCamp: roles.includes("tenant_admin") ? "Director" : "Camper",
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

  user.profileId = profile._id;
  await user.save();

  return { user, profile };
}

async function createFixtures() {
  const tenantA = await Tenant.create({
    name: "Tenant A Camp",
    slug: "tenant-a",
    status: "active",
    planTier: "premium",
    onboardingStatus: "live"
  });

  const tenantB = await Tenant.create({
    name: "Tenant B Camp",
    slug: "tenant-b",
    status: "active",
    planTier: "premium",
    onboardingStatus: "live"
  });

  await createUserWithProfile({
    tenant: tenantA,
    email: "admin-a@example.com",
    password: "AdminPass123!",
    roles: ["tenant_admin", "user"],
    firstName: "Admin",
    lastName: "A",
    cityState: "Chicago, IL"
  });

  await createUserWithProfile({
    tenant: tenantA,
    email: "existing-a@example.com",
    password: "MemberPass123!",
    roles: ["user"],
    firstName: "Jordan",
    lastName: "Existing",
    cityState: "Denver, CO"
  });

  await createUserWithProfile({
    tenant: tenantB,
    email: "admin-b@example.com",
    password: "AdminPass123!",
    roles: ["tenant_admin", "user"],
    firstName: "Admin",
    lastName: "B",
    cityState: "Austin, TX"
  });

  await createUserWithProfile({
    tenant: tenantB,
    email: "member-b@example.com",
    password: "MemberPass123!",
    roles: ["user"],
    firstName: "Taylor",
    lastName: "ScopeB",
    cityState: "Austin, TX"
  });

  return {
    tenantA,
    credentials: {
      adminA: { email: "admin-a@example.com", password: "AdminPass123!" },
      adminB: { email: "admin-b@example.com", password: "AdminPass123!" }
    }
  };
}

async function loginTenant(slug, credentials) {
  const response = await request(app)
    .post(`/api/t/${slug}/auth/login`)
    .send({ email: credentials.email, password: credentials.password });

  expect(response.status).toBe(200);
  expect(response.body.token).toBeTruthy();
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

describe("Tenant CSV import", () => {
  test("imports with create/update/duplicate/error reporting and failure CSV download", async () => {
    await createFixtures();
    const tokenA = await loginTenant("tenant-a", {
      email: "admin-a@example.com",
      password: "AdminPass123!"
    });

    const csvContent = [
      "firstName,lastName,email,phone,cityState,roleAtCamp,gradYear",
      "Sam,New,sam.new@example.com,5551110000,Denver CO,Camper,2022",
      "Jordan,Existing,existing-a@example.com,5552220000,Denver CO,Staff,2018",
      "Sam,New,someone.else@example.com,5553330000,Denver CO,Camper,2022",
      "No,Email,not-an-email,5554440000,Denver CO,Camper,2024"
    ].join("\n");

    const importResponse = await request(app)
      .post("/api/tenants/me/import-csv")
      .set("Authorization", `Bearer ${tokenA}`)
      .set("X-Tenant-Slug", "tenant-a")
      .field("enableFuzzyMatch", "false")
      .attach("file", Buffer.from(csvContent, "utf8"), "tenant-a-import.csv");

    expect(importResponse.status).toBe(200);
    expect(importResponse.body.importSummary.createdCount).toBe(1);
    expect(importResponse.body.importSummary.updatedCount).toBe(1);
    expect(importResponse.body.importSummary.skippedDuplicates).toBe(1);
    expect(importResponse.body.importSummary.errorCount).toBe(1);
    expect(importResponse.body.importSummary.failureCsvDownloadPath).toContain("/failures.csv");

    const tenantAProfiles = await request(app)
      .get("/api/t/tenant-a/profiles")
      .set("Authorization", `Bearer ${tokenA}`);

    expect(tenantAProfiles.status).toBe(200);
    const tenantAEmails = tenantAProfiles.body.items.flatMap((item) => item.emails || []);
    expect(tenantAEmails).toContain("sam.new@example.com");
    expect(tenantAEmails).not.toContain("member-b@example.com");

    const existingProfile = tenantAProfiles.body.items.find(
      (item) => (item.emails || []).includes("existing-a@example.com")
    );
    expect(existingProfile).toBeTruthy();
    expect(existingProfile.phones).toContain("5552220000");

    const reportId = importResponse.body.importSummary.reportId;
    const failuresResponse = await request(app)
      .get(`/api/t/tenant-a/admin/imports/${reportId}/failures.csv`)
      .set("Authorization", `Bearer ${tokenA}`);

    expect(failuresResponse.status).toBe(200);
    expect(failuresResponse.headers["content-type"]).toContain("text/csv");
    expect(failuresResponse.text).toContain("rowNumber,code,message");
    expect(failuresResponse.text).toContain("VALIDATION_ERROR");
  });

  test("tenant admin cannot import into another tenant", async () => {
    const { credentials } = await createFixtures();
    const tokenA = await loginTenant("tenant-a", credentials.adminA);

    const csvContent = [
      "firstName,lastName,email,phone,cityState,roleAtCamp,gradYear",
      "Alex,Unauthorized,alex.unauthorized@example.com,5559990000,Denver CO,Camper,2020"
    ].join("\n");

    const response = await request(app)
      .post("/api/tenants/me/import-csv")
      .set("Authorization", `Bearer ${tokenA}`)
      .set("X-Tenant-Slug", "tenant-b")
      .attach("file", Buffer.from(csvContent, "utf8"), "wrong-tenant.csv");

    expect(response.status).toBe(403);
    expect(response.body.error?.code).toBe("TENANT_SCOPE_DENIED");
  });

  test("legacy admin import endpoint returns explicit deprecation response", async () => {
    await createFixtures();
    const tokenA = await loginTenant("tenant-a", {
      email: "admin-a@example.com",
      password: "AdminPass123!"
    });

    const response = await request(app)
      .post("/api/t/tenant-a/admin/import-csv")
      .set("Authorization", `Bearer ${tokenA}`);

    expect(response.status).toBe(410);
    expect(response.body.error?.code).toBe("MEMBER_IMPORT_DISABLED");
  });
});
