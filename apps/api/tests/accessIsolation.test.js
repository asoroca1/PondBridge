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
let InviteModel;

async function createUserWithProfile({ tenant, email, password, roles, firstName, lastName }) {
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

async function createFixtures() {
  const tenantA = await Tenant.create({
    name: "Tenant A Camp",
    slug: "tenant-a",
    status: "active",
    planTier: "premium",
    onboardingStatus: "live",
    settings: { signupMode: "open" }
  });

  const tenantB = await Tenant.create({
    name: "Tenant B Camp",
    slug: "tenant-b",
    status: "active",
    planTier: "premium",
    onboardingStatus: "live",
    settings: { signupMode: "open" }
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
    tenant: tenantB,
    email: "member-b@example.com",
    password: "MemberPass123!",
    roles: ["user"],
    firstName: "Member",
    lastName: "B"
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
      memberB: { email: "member-b@example.com", password: "MemberPass123!" },
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
  ({ InviteModel } = await import("../src/db/models/index.js"));
  ({ default: app } = await import("../src/app.js"));

  await connectToDatabase();
});

afterEach(async () => {
  await clearAllDocuments();
});

afterAll(() => {});

describe("Access route tenant isolation", () => {
  test("tenant member token cannot query another tenant access decision", async () => {
    const { credentials } = await createFixtures();
    const tenantAToken = await loginTenant("tenant-a", credentials.adminA);

    const response = await request(app)
      .get("/api/t/tenant-b/access/decision")
      .set("Authorization", `Bearer ${tenantAToken}`);

    expect(response.status).toBe(403);
    expect(response.body.error?.code).toBe("TENANT_SCOPE_DENIED");
  });

  test("tenant member token cannot join another tenant directly", async () => {
    const { credentials } = await createFixtures();
    const tenantAToken = await loginTenant("tenant-a", credentials.adminA);

    const response = await request(app)
      .post("/api/t/tenant-b/access/join")
      .set("Authorization", `Bearer ${tenantAToken}`)
      .send({});

    expect(response.status).toBe(403);
    expect(response.body.error?.code).toBe("TENANT_SCOPE_DENIED");
  });

  test("invite token from tenant A cannot be accepted against tenant B", async () => {
    const { tenantA, tenantB, credentials } = await createFixtures();
    const adminAToken = await loginTenant("tenant-a", credentials.adminA);
    const memberBToken = await loginTenant("tenant-b", credentials.memberB);

    const createInvite = await request(app)
      .post("/api/t/tenant-a/access/invite/create")
      .set("Authorization", `Bearer ${adminAToken}`)
      .send({ email: "invitee@example.com", roleToAssign: "user", expiresInDays: 14 });

    expect(createInvite.status).toBe(201);
    expect(createInvite.body.token).toBeTruthy();
    expect(createInvite.body.invite?.id).toBeTruthy();

    const crossTenantAccept = await request(app)
      .post("/api/t/tenant-b/access/invite/accept")
      .set("Authorization", `Bearer ${memberBToken}`)
      .send({ inviteToken: createInvite.body.token });

    expect(crossTenantAccept.status).toBe(404);
    expect(crossTenantAccept.body.error?.code).toBe("INVITE_INVALID");

    const inviteRow = await InviteModel.findOne(tenantA._id, { _id: createInvite.body.invite.id });
    expect(inviteRow).toBeTruthy();
    expect(inviteRow.usedAt).toBeNull();

    const memberB = await User.findOne({ tenantId: tenantB._id, email: credentials.memberB.email });
    expect(memberB).toBeTruthy();
    expect(memberB.roles).toEqual(["user"]);
  });

  test("super admin can access access-decision endpoints across tenants without 500 errors", async () => {
    const { credentials } = await createFixtures();
    const superToken = await loginSuper(credentials.super);

    const [tenantAResponse, tenantBResponse] = await Promise.all([
      request(app)
        .get("/api/t/tenant-a/access/decision")
        .set("Authorization", `Bearer ${superToken}`),
      request(app)
        .get("/api/t/tenant-b/access/decision")
        .set("Authorization", `Bearer ${superToken}`)
    ]);

    expect(tenantAResponse.status).toBe(200);
    expect(tenantBResponse.status).toBe(200);
    expect(tenantAResponse.body.tenant.slug).toBe("tenant-a");
    expect(tenantBResponse.body.tenant.slug).toBe("tenant-b");
    expect(tenantAResponse.body.decision).toBeTruthy();
    expect(tenantBResponse.body.decision).toBeTruthy();
  });
});
