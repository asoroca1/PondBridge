import request from "supertest";
import { jest } from "@jest/globals";

jest.setTimeout(120000);

let app;
let connectToDatabase;
let clearAllDocuments;
let hashPassword;
let User;

beforeAll(async () => {
  process.env.JWT_SECRET = "test-jwt-secret";
  process.env.JWT_EXPIRES_IN = "1h";
  process.env.BCRYPT_ROUNDS = "4";
  process.env.FRONTEND_ORIGIN = "http://localhost:5173";
  process.env.APP_BASE_DOMAIN = "pondbridge.test";

  ({ connectToDatabase } = await import("../src/db/connect.js"));
  ({ clearAllDocuments } = await import("../src/db/supabaseDocumentModel.js"));
  ({ hashPassword } = await import("../src/utils/auth.js"));
  ({ User } = await import("../src/models/User.js"));
  ({ default: app } = await import("../src/app.js"));

  await connectToDatabase();
});

afterEach(async () => {
  await clearAllDocuments();
});

afterAll(() => {});

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
  expect(response.body.token).toBeTruthy();
  return response.body.token;
}

describe("Super provisioning", () => {
  test("tenant slug strips leading camp prefix for domain keys", async () => {
    await createSuperAdmin();
    const superToken = await loginSuper();

    const createTenant = await request(app)
      .post("/api/super/tenants")
      .set("Authorization", `Bearer ${superToken}`)
      .send({
        name: "Camp Cedar",
        slug: "camp-cedar",
        billingPlan: "legacy"
      });

    expect(createTenant.status).toBe(201);
    expect(createTenant.body.tenant.slug).toBe("cedar");
    expect(createTenant.body.tenant.customDomain).toBe("cedar.pondbridge.test");
    expect(createTenant.body.billingPlan).toBe("legacy");
  });

  test("super admin can create tenant and first director can bootstrap before launch", async () => {
    await createSuperAdmin();
    const superToken = await loginSuper();

    const createTenant = await request(app)
      .post("/api/super/tenants")
      .set("Authorization", `Bearer ${superToken}`)
      .send({
        name: "Pine Ridge Camp",
        slug: "pine-ridge",
        billingPlan: "institutional",
        directorEmail: "director@pineridge.org"
      });

    expect(createTenant.status).toBe(201);
    expect(createTenant.body.tenant.slug).toBe("pine-ridge");
    expect(createTenant.body.billingPlan).toBe("institutional");
    expect(createTenant.body.tenant.onboardingFeeAmount).toBe(450);
    expect(createTenant.body.tenant.onboardingStatus).toBe("not_started");
    expect(createTenant.body.directorInvite?.email).toBe("director@pineridge.org");
    expect(createTenant.body.directorInvite?.roleToAssign).toBe("tenant_admin");
    expect(createTenant.body.directorInvite?.mode).toBe("first_signup_bootstrap");
    expect(createTenant.body.directorInvite?.claimUrl).toContain("/director-claim");

    const registerDirector = await request(app)
      .post("/api/t/pine-ridge/auth/register")
      .send({
        firstName: "Camp",
        lastName: "Director",
        email: "director@pineridge.org",
        password: "DirectorPass123!",
        directorSignup: true
      });

    expect(registerDirector.status).toBe(201);
    expect(registerDirector.body.user.roles).toEqual(expect.arrayContaining(["tenant_admin", "user"]));

    const loginDirector = await request(app)
      .post("/api/t/pine-ridge/auth/login")
      .send({
        email: "director@pineridge.org",
        password: "DirectorPass123!"
      });

    expect(loginDirector.status).toBe(200);
    expect(loginDirector.body.user.roles).toEqual(expect.arrayContaining(["tenant_admin", "user"]));
  });

  test("founders billing plan defaults to premium tier with waived onboarding fee", async () => {
    await createSuperAdmin();
    const superToken = await loginSuper();

    const createTenant = await request(app)
      .post("/api/super/tenants")
      .set("Authorization", `Bearer ${superToken}`)
      .send({
        name: "Founders Camp",
        slug: "founders-camp",
        billingPlan: "founders"
      });

    expect(createTenant.status).toBe(201);
    expect(createTenant.body.billingPlan).toBe("founders");
    expect(createTenant.body.tenant.planTier).toBe("premium");
    expect(createTenant.body.tenant.onboardingFeeAmount).toBe(0);
    expect(createTenant.body.tenant.onboardingFeePaid).toBe(true);
  });
});
