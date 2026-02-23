import request from "supertest";
import { jest } from "@jest/globals";

jest.setTimeout(120000);

let app;
let connectToDatabase;
let clearAllDocuments;
let hashPassword;
let Tenant;
let User;

async function createTenant({ slug, planTier = "premium" }) {
  return Tenant.create({
    name: `Camp ${slug}`,
    slug,
    status: "active",
    planTier,
    onboardingStatus: "live",
    settings: { signupMode: "open" }
  });
}

async function createTenantUser(tenantId, email, password = "AdminPass123!", roles = ["user"]) {
  const passwordHash = await hashPassword(password);
  return User.create({
    tenantId,
    email,
    passwordHash,
    roles,
    status: "active"
  });
}

async function loginTenant(slug, email, password = "AdminPass123!") {
  const response = await request(app)
    .post(`/api/t/${slug}/auth/login`)
    .send({ email, password });
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
  ({ default: app } = await import("../src/app.js"));

  await connectToDatabase();
});

afterEach(async () => {
  await clearAllDocuments();
});

afterAll(() => {});

describe("Resume route security", () => {
  test("requires authentication", async () => {
    await createTenant({ slug: "resume-sec-a" });
    const response = await request(app).post("/api/t/resume-sec-a/resume/parse");
    expect(response.status).toBe(401);
    expect(response.body.error?.code).toBe("AUTH_REQUIRED");
  });

  test("enforces tenant scope with authenticated token", async () => {
    const tenantA = await createTenant({ slug: "resume-sec-a" });
    const tenantB = await createTenant({ slug: "resume-sec-b" });
    await createTenantUser(tenantA._id, "a@example.com");
    await createTenantUser(tenantB._id, "b@example.com");

    const tokenA = await loginTenant("resume-sec-a", "a@example.com");
    const response = await request(app)
      .post("/api/t/resume-sec-b/resume/parse")
      .set("Authorization", `Bearer ${tokenA}`);

    expect(response.status).toBe(403);
    expect(response.body.error?.code).toBe("TENANT_SCOPE_DENIED");
  });
});

