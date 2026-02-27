import request from "supertest";
import { jest } from "@jest/globals";

jest.setTimeout(120000);

let app;
let connectToDatabase;
let clearAllDocuments;
let hashPassword;
let signToken;
let generateObjectId;
let Tenant;
let User;

async function createTenant(slug = "") {
  const safeSlug = String(slug || "").trim() || `super-auth-boundary-${generateObjectId().slice(-8)}`;
  return Tenant.create({
    name: "Super Auth Boundary Camp",
    slug: safeSlug,
    status: "active",
    planTier: "premium",
    onboardingStatus: "live",
    settings: { signupMode: "open" }
  });
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
  ({ generateObjectId } = await import("../src/utils/objectId.js"));
  ({ Tenant } = await import("../src/models/Tenant.js"));
  ({ User } = await import("../src/models/User.js"));
  ({ default: app } = await import("../src/app.js"));

  await connectToDatabase();
});

afterEach(async () => {
  await clearAllDocuments();
});

afterAll(() => {});

describe("Super auth boundary", () => {
  test("ignores forged super role claims in legacy token payload", async () => {
    const tenant = await createTenant();
    const passwordHash = await hashPassword("AdminPass123!");
    const tenantAdmin = await User.create({
      tenantId: tenant._id,
      email: "tenant-admin@example.com",
      passwordHash,
      roles: ["tenant_admin", "user"],
      status: "active"
    });

    const forgedToken = signToken({
      _id: tenantAdmin._id,
      tenantId: tenant._id,
      email: tenantAdmin.email,
      roles: ["super_admin"]
    });

    const response = await request(app)
      .get("/api/super/notifications")
      .set("Authorization", `Bearer ${forgedToken}`);

    expect(response.status).toBe(403);
    expect(response.body.error?.code).toBe("ROLE_FORBIDDEN");
  });

  test("rejects legacy token subjects without an application membership", async () => {
    const tenant = await createTenant("super-auth-boundary-2");
    const forgedToken = signToken({
      _id: generateObjectId(),
      tenantId: tenant._id,
      email: "ghost@example.com",
      roles: ["super_admin"]
    });

    const response = await request(app)
      .get("/api/super/notifications")
      .set("Authorization", `Bearer ${forgedToken}`);

    expect(response.status).toBe(401);
    expect(response.body.error?.code).toBe("AUTH_MEMBERSHIP_REQUIRED");
  });

  test("allows a legitimate persisted super admin membership", async () => {
    const passwordHash = await hashPassword("SuperPass123!");
    const superUser = await User.create({
      tenantId: null,
      email: "super@example.com",
      passwordHash,
      roles: ["super_admin"],
      status: "active"
    });

    const token = signToken({
      _id: superUser._id,
      tenantId: null,
      email: superUser.email,
      roles: ["super_admin"]
    });

    const response = await request(app)
      .get("/api/super/notifications")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("generatedAt");
  });
});
