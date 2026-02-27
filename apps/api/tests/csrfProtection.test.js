import request from "supertest";
import { jest } from "@jest/globals";

jest.setTimeout(120000);

let app;
let connectToDatabase;
let clearAllDocuments;
let hashPassword;
let signToken;
let Tenant;
let User;

async function createTenantAndAdmin() {
  const tenant = await Tenant.create({
    name: "CSRF Camp",
    slug: "csrf-camp",
    status: "active",
    planTier: "premium",
    onboardingStatus: "live",
    settings: { signupMode: "open" }
  });

  const passwordHash = await hashPassword("AdminPass123!");
  const admin = await User.create({
    tenantId: tenant._id,
    email: "director@csrf-camp.test",
    passwordHash,
    roles: ["tenant_admin", "user"],
    status: "active"
  });

  return { tenant, admin };
}

beforeAll(async () => {
  process.env.JWT_SECRET = "test-jwt-secret";
  process.env.JWT_EXPIRES_IN = "1h";
  process.env.BCRYPT_ROUNDS = "4";
  process.env.FRONTEND_ORIGIN = "http://localhost:5173";
  process.env.APP_BASE_DOMAIN = "pondbridge.test";
  process.env.AUTH_PROVIDER = "legacy";

  ({ connectToDatabase } = await import("../src/db/connect.js"));
  ({ clearAllDocuments } = await import("../src/db/supabaseDocumentModel.js"));
  ({ hashPassword, signToken } = await import("../src/utils/auth.js"));
  ({ Tenant } = await import("../src/models/Tenant.js"));
  ({ User } = await import("../src/models/User.js"));
  ({ default: app } = await import("../src/app.js"));

  await connectToDatabase();
});

afterEach(async () => {
  await clearAllDocuments();
});

afterAll(() => {});

describe("CSRF protection", () => {
  test("blocks cookie-authenticated mutating requests without Origin/Referer", async () => {
    const { admin } = await createTenantAndAdmin();
    const token = signToken({
      _id: admin._id,
      tenantId: admin.tenantId,
      email: admin.email,
      roles: admin.roles
    });

    const response = await request(app)
      .post("/api/t/csrf-camp/admin/settings/pause")
      .set("Cookie", `pondbridge_auth=${token}`)
      .send({ paused: true });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("Origin not allowed");
  });

  test("allows bearer-authenticated mutating requests without Origin", async () => {
    const { admin } = await createTenantAndAdmin();
    const token = signToken({
      _id: admin._id,
      tenantId: admin.tenantId,
      email: admin.email,
      roles: admin.roles
    });

    const response = await request(app)
      .post("/api/t/csrf-camp/admin/settings/pause")
      .set("Authorization", `Bearer ${token}`)
      .send({ paused: true });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });
});
