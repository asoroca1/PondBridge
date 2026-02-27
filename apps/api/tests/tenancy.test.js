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

async function createUserWithProfile({ tenant, email, password, roles, firstName, lastName }) {
  const passwordHash = await hashPassword(password);

  const user = await User.create({
    tenantId: tenant ? tenant._id : null,
    email,
    passwordHash,
    roles,
    status: "active"
  });

  if (tenant) {
    const profile = await Profile.create({
      tenantId: tenant._id,
      userId: user._id,
      firstName,
      lastName,
      emails: [email],
      phones: [],
      cityState: "Chicago, IL",
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

  return { user, profile: null };
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
    lastName: "A"
  });

  await createUserWithProfile({
    tenant: tenantA,
    email: "alex-a@example.com",
    password: "MemberPass123!",
    roles: ["user"],
    firstName: "Alex",
    lastName: "ScopeA"
  });

  await createUserWithProfile({
    tenant: tenantB,
    email: "admin-b@example.com",
    password: "AdminPass123!",
    roles: ["tenant_admin", "user"],
    firstName: "Admin",
    lastName: "B"
  });

  await createUserWithProfile({
    tenant: tenantB,
    email: "alex-b@example.com",
    password: "MemberPass123!",
    roles: ["user"],
    firstName: "Alex",
    lastName: "ScopeB"
  });

  const superPasswordHash = await hashPassword("SuperPass123!");
  await User.create({
    tenantId: null,
    email: "super@example.com",
    passwordHash: superPasswordHash,
    roles: ["super_admin"],
    status: "active"
  });

  return {
    tenantA,
    tenantB,
    credentials: {
      adminA: { email: "admin-a@example.com", password: "AdminPass123!" },
      adminB: { email: "admin-b@example.com", password: "AdminPass123!" },
      super: { email: "super@example.com", password: "SuperPass123!" }
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

async function loginSuper(credentials) {
  const response = await request(app)
    .post("/api/auth/super/login")
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

describe("API tenancy isolation", () => {
  test("/profiles returns only tenant-scoped profiles", async () => {
    const { tenantA, credentials } = await createFixtures();
    const tokenA = await loginTenant("tenant-a", credentials.adminA);

    const response = await request(app)
      .get("/api/t/tenant-a/profiles")
      .set("Authorization", `Bearer ${tokenA}`);

    expect(response.status).toBe(200);
    expect(response.body.total).toBeGreaterThan(0);

    const tenantIds = response.body.items.map((item) => String(item.tenantId));
    expect(tenantIds.every((id) => id === String(tenantA._id))).toBe(true);

    const lastNames = response.body.items.map((item) => item.lastName);
    expect(lastNames).toContain("ScopeA");
    expect(lastNames).not.toContain("ScopeB");
  });

  test("/search returns only tenant-scoped profiles", async () => {
    await createFixtures();
    const tokenA = await loginTenant("tenant-a", {
      email: "admin-a@example.com",
      password: "AdminPass123!"
    });

    const response = await request(app)
      .get("/api/t/tenant-a/search?q=Alex")
      .set("Authorization", `Bearer ${tokenA}`);

    expect(response.status).toBe(200);
    expect(response.body.total).toBeGreaterThan(0);

    const lastNames = response.body.items.map((item) => item.lastName);
    expect(lastNames).toContain("ScopeA");
    expect(lastNames).not.toContain("ScopeB");
  });

  test("tenant admin cannot access tenant B admin endpoints", async () => {
    const { credentials } = await createFixtures();
    const tokenA = await loginTenant("tenant-a", credentials.adminA);

    const response = await request(app)
      .get("/api/t/tenant-b/admin/overview")
      .set("Authorization", `Bearer ${tokenA}`);

    expect(response.status).toBe(403);
    expect(response.body.error?.code).toBe("TENANT_SCOPE_DENIED");
  });

  test("tenant A token is rejected when tenant B scope is requested on /api/auth/session", async () => {
    const { credentials } = await createFixtures();
    const tokenA = await loginTenant("tenant-a", credentials.adminA);

    const response = await request(app)
      .get("/api/auth/session")
      .set("Authorization", `Bearer ${tokenA}`)
      .set("X-Tenant-Slug", "tenant-b");

    expect(response.status).toBe(403);
    expect(response.body.error?.code).toBe("TENANT_SCOPE_DENIED");
  });

  test("tenant A token is rejected on /api/tenants/me when requesting tenant B", async () => {
    const { credentials } = await createFixtures();
    const tokenA = await loginTenant("tenant-a", credentials.adminA);

    const response = await request(app)
      .get("/api/tenants/me/onboarding")
      .set("Authorization", `Bearer ${tokenA}`)
      .set("X-Tenant-Slug", "tenant-b");

    expect(response.status).toBe(403);
    expect(response.body.error?.code).toBe("TENANT_SCOPE_DENIED");
  });

  test("super admin can access both tenant A and tenant B admin endpoints", async () => {
    const { credentials } = await createFixtures();
    const superToken = await loginSuper(credentials.super);

    const [tenantAResponse, tenantBResponse] = await Promise.all([
      request(app)
        .get("/api/t/tenant-a/admin/overview")
        .set("Authorization", `Bearer ${superToken}`),
      request(app)
        .get("/api/t/tenant-b/admin/overview")
        .set("Authorization", `Bearer ${superToken}`)
    ]);

    expect(tenantAResponse.status).toBe(200);
    expect(tenantBResponse.status).toBe(200);

    expect(tenantAResponse.body.tenant.slug).toBe("tenant-a");
    expect(tenantBResponse.body.tenant.slug).toBe("tenant-b");

    expect(tenantAResponse.body.counts.profiles).toBeGreaterThan(0);
    expect(tenantBResponse.body.counts.profiles).toBeGreaterThan(0);
  });
});
