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

beforeAll(async () => {
  process.env.JWT_SECRET = "test-jwt-secret";
  process.env.JWT_EXPIRES_IN = "1h";
  process.env.BCRYPT_ROUNDS = "4";
  process.env.FRONTEND_ORIGIN = "http://localhost:5173";
  process.env.APP_BASE_DOMAIN = "pondbridge.test";
  process.env.AUTH_PROVIDER = "hybrid";
  process.env.CLERK_SECRET_KEY = "sk_test_dummy";
  process.env.HYBRID_ALLOW_LEGACY_TOKENS = "false";

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

describe("Hybrid auth mode", () => {
  test("rejects legacy JWT tokens when hybrid fallback is disabled", async () => {
    const tenant = await Tenant.create({
      name: "Hybrid Auth Camp",
      slug: "hybrid-auth-camp",
      status: "active",
      planTier: "premium",
      onboardingStatus: "live",
      settings: { signupMode: "open" }
    });

    const passwordHash = await hashPassword("AdminPass123!");
    const user = await User.create({
      tenantId: tenant._id,
      email: "director@hybrid-auth.test",
      passwordHash,
      roles: ["tenant_admin", "user"],
      status: "active"
    });

    const token = signToken({
      _id: user._id,
      tenantId: tenant._id,
      email: user.email,
      roles: user.roles
    });

    const response = await request(app)
      .get("/api/t/hybrid-auth-camp/profiles/me")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(401);
    expect(response.body.error?.code).toBe("AUTH_LEGACY_TOKEN_DISABLED");
  });
});
