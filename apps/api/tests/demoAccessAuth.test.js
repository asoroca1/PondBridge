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

async function createDemoFixture({ slug = "demo-code-camp", code = "DEMO-1234" } = {}) {
  const accessCodeHash = await hashPassword(code);
  const passwordHash = await hashPassword("DemoDirectorPass123!");
  const tenant = await Tenant.create({
    name: "Demo Code Camp",
    slug,
    status: "active",
    planTier: "premium",
    onboardingStatus: "live",
    billingStatus: "active",
    settings: {
      demoAccess: {
        enabled: true,
        codeHash: accessCodeHash,
        directorEmail: `director@${slug}.test`,
        directorUserId: ""
      }
    }
  });

  const user = await User.create({
    tenantId: tenant._id,
    email: `director@${slug}.test`,
    passwordHash,
    roles: ["tenant_admin", "user"],
    status: "active"
  });

  const profile = await Profile.create({
    tenantId: tenant._id,
    userId: user._id,
    firstName: "Demo",
    lastName: "Director",
    emails: [user.email],
    phones: [],
    cityState: "",
    roleAtCamp: "Director",
    highSchool: "",
    colleges: [],
    collegeYears: [],
    currentJobs: [],
    pastJobs: [],
    industry: "",
    socials: { nickname: "DD" },
    avatarUrl: "https://cdn.pondbridge.test/demo-director.png",
    bio: ""
  });

  user.profileId = profile._id;
  await user.save();

  return { tenant, user, profile, code };
}

describe("Demo access auth", () => {
  test("rejects password login for demo-access-only tenants", async () => {
    const { tenant, user } = await createDemoFixture({ slug: "demo-code-password-block", code: "QWER-1234" });

    const response = await request(app)
      .post(`/api/t/${tenant.slug}/auth/login`)
      .send({ email: user.email, password: "DemoDirectorPass123!" });

    expect(response.status).toBe(403);
    expect(response.body.error?.code).toBe("DEMO_ACCESS_ONLY");
  });

  test("accepts valid demo access code and returns director session", async () => {
    const { tenant, user, code } = await createDemoFixture();

    const patchTenant = await Tenant.findById(tenant._id);
    patchTenant.settings = {
      ...(patchTenant.settings || {}),
      demoAccess: {
        ...(patchTenant.settings?.demoAccess || {}),
        directorUserId: user._id
      }
    };
    await patchTenant.save();

    const response = await request(app)
      .post(`/api/t/${tenant.slug}/auth/demo-access`)
      .send({ code });

    expect(response.status).toBe(200);
    expect(response.body.token).toBeTruthy();
    expect(response.body.user?.roles || []).toEqual(expect.arrayContaining(["tenant_admin", "user"]));
    expect(response.body.user?.firstName).toBe("Demo");
    expect(response.body.user?.lastName).toBe("Director");
    expect(response.body.user?.nickname).toBe("DD");
    expect(response.body.user?.avatarUrl).toBe("https://cdn.pondbridge.test/demo-director.png");
  });

  test("demo access token can load tenant-scoped auth session", async () => {
    const { tenant, user, code } = await createDemoFixture({ slug: "demo-code-session" });

    const patchTenant = await Tenant.findById(tenant._id);
    patchTenant.settings = {
      ...(patchTenant.settings || {}),
      demoAccess: {
        ...(patchTenant.settings?.demoAccess || {}),
        directorUserId: user._id
      }
    };
    await patchTenant.save();

    const loginResponse = await request(app)
      .post(`/api/t/${tenant.slug}/auth/demo-access`)
      .send({ code });

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.token).toBeTruthy();

    const sessionResponse = await request(app)
      .get("/api/auth/session")
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .set("X-Tenant-Slug", tenant.slug);

    expect(sessionResponse.status).toBe(200);
    expect(sessionResponse.body.user?.id).toBeTruthy();
    expect(sessionResponse.body.user?.tenantSlug).toBe(tenant.slug);
    expect(sessionResponse.body.user?.firstName).toBe("Demo");
    expect(sessionResponse.body.user?.lastName).toBe("Director");
    expect(sessionResponse.body.user?.avatarUrl).toBe("https://cdn.pondbridge.test/demo-director.png");
  });

  test("rejects invalid demo access code", async () => {
    const { tenant } = await createDemoFixture({ slug: "demo-code-invalid", code: "ABCD-1234" });

    const response = await request(app)
      .post(`/api/t/${tenant.slug}/auth/demo-access`)
      .send({ code: "WRONG-9999" });

    expect(response.status).toBe(401);
    expect(response.body.error?.code).toBe("AUTH_FAILED");
  });

  test("returns disabled error when demo access is not configured", async () => {
    await Tenant.create({
      name: "Regular Camp",
      slug: "regular-camp",
      status: "active",
      planTier: "premium",
      onboardingStatus: "live",
      settings: {}
    });

    const response = await request(app)
      .post("/api/t/regular-camp/auth/demo-access")
      .send({ code: "ABCD-1234" });

    expect(response.status).toBe(403);
    expect(response.body.error?.code).toBe("DEMO_ACCESS_DISABLED");
  });
});
