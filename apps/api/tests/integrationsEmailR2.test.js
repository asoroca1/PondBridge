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

async function createTenant({ slug, name, onboardingStatus = "live" }) {
  return Tenant.create({
    name: name || `Camp ${slug}`,
    slug,
    status: "active",
    planTier: "premium",
    onboardingStatus,
    settings: { signupMode: "open" },
    modules: { search: true, chat: true, photoStream: true, newsletter: true }
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

async function createProfile({
  tenantId,
  userId,
  firstName,
  lastName,
  email,
  cityState = "Chicago, IL",
  roleAtCamp = "Camper"
}) {
  return Profile.create({
    tenantId,
    userId,
    firstName,
    lastName,
    emails: [email],
    phones: [],
    cityState,
    roleAtCamp,
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

async function loginTenant(slug, email, password = "AdminPass123!") {
  const response = await request(app)
    .post(`/api/t/${slug}/auth/login`)
    .send({ email, password });
  expect(response.status).toBe(200);
  return response.body.token;
}

beforeAll(async () => {
  process.env.JWT_SECRET = "test-jwt-secret";
  process.env.JWT_EXPIRES_IN = "1h";
  process.env.BCRYPT_ROUNDS = "4";
  process.env.FRONTEND_ORIGIN = "http://localhost:5173";
  process.env.APP_BASE_DOMAIN = "pondbridge.test";
  process.env.EMAIL_MODE = "mock";
  process.env.EMAIL_BROADCAST_BATCH_SIZE = "2";

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

describe("Email + R2 integration hardening", () => {
  test("health endpoint exposes integration readiness details", async () => {
    const response = await request(app).get("/health");
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.integrations).toBeDefined();
    expect(response.body.integrations.email).toBeDefined();
    expect(response.body.integrations.r2).toBeDefined();
    expect(typeof response.body.integrations.email.configured).toBe("boolean");
    expect(typeof response.body.integrations.r2.configured).toBe("boolean");
  });

  test("admin email send stores delivery stats", async () => {
    const tenant = await createTenant({ slug: "email-health-camp", name: "Email Health Camp" });
    const admin = await createTenantUser(tenant._id, "admin@email-health.test", "AdminPass123!", [
      "tenant_admin",
      "user"
    ]);
    await createProfile({
      tenantId: tenant._id,
      userId: admin._id,
      firstName: "Ava",
      lastName: "Admin",
      email: "admin@email-health.test",
      roleAtCamp: "Director"
    });

    const memberOne = await createTenantUser(tenant._id, "member1@email-health.test");
    await createProfile({
      tenantId: tenant._id,
      userId: memberOne._id,
      firstName: "Mia",
      lastName: "Member",
      email: "member1@email-health.test",
      roleAtCamp: "Camper"
    });

    const memberTwo = await createTenantUser(tenant._id, "member2@email-health.test");
    await createProfile({
      tenantId: tenant._id,
      userId: memberTwo._id,
      firstName: "Noah",
      lastName: "Member",
      email: "member2@email-health.test",
      roleAtCamp: "Counselor"
    });

    const token = await loginTenant("email-health-camp", "admin@email-health.test");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const response = await request(app)
      .post("/api/t/email-health-camp/admin/email/send")
      .set("Authorization", `Bearer ${token}`)
      .send({
        subject: "Weekly update",
        body: "Hello team",
        targeting: { mode: "all" }
      });

    try {
      expect(response.status).toBe(201);
      const item = response.body?.item || {};
      const delivery = item?.stats?.delivery || {};
      const attemptedCount = Number(delivery.attemptedCount || 0);
      const sentCount = Number(delivery.sentCount || 0);
      const failedCount = Number(delivery.failedCount || 0);

      expect(item.recipientCount).toBe(3);
      expect(attemptedCount).toBe(3);
      expect(sentCount + failedCount).toBe(3);
      expect(Number(delivery.batchesAttempted || 0)).toBeGreaterThanOrEqual(1);
      expect(["sent", "failed"]).toContain(String(item.status || ""));

      const emailLogs = logSpy.mock.calls
        .filter((call) => String(call?.[0] || "") === "[email:mock]")
        .map((call) => call?.[1] || {});
      expect(emailLogs.length).toBe(3);
      for (const entry of emailLogs) {
        expect(Array.isArray(entry.to)).toBe(true);
        expect(entry.to.length).toBe(1);
        expect(Array.isArray(entry.bcc)).toBe(true);
        expect(entry.bcc.length).toBe(0);
      }
    } finally {
      logSpy.mockRestore();
    }
  });

  test("presign endpoint returns typed storage errors", async () => {
    await createTenant({ slug: "r2-health-camp", name: "R2 Health Camp" });
    const response = await request(app)
      .post("/api/t/r2-health-camp/uploads/presign-public")
      .set("Origin", "http://localhost:5173")
      .send({
        fileName: "avatar.jpg",
        fileType: "image/jpeg",
        fileSize: 50 * 1024 * 1024
      });

    expect([200, 413, 503]).toContain(response.status);
    if (response.status !== 200) {
      const code = String(response.body?.error?.code || "");
      expect(["FILE_TOO_LARGE", "R2_NOT_CONFIGURED"]).toContain(code);
    } else {
      expect(typeof response.body.uploadUrl).toBe("string");
      expect(typeof response.body.objectUrl).toBe("string");
    }
  });

  test("public presign rejects missing/invalid browser origin", async () => {
    await createTenant({ slug: "r2-origin-camp", name: "R2 Origin Camp" });
    const response = await request(app)
      .post("/api/t/r2-origin-camp/uploads/presign-public")
      .send({
        fileName: "avatar.jpg",
        fileType: "image/jpeg",
        fileSize: 10_000
      });

    expect(response.status).toBe(403);
    expect(response.body.error?.code).toBe("UPLOAD_ORIGIN_FORBIDDEN");
  });

  test("public presign allows prelaunch branding scope without director invite token", async () => {
    await createTenant({ slug: "r2-branding-camp", name: "R2 Branding Camp", onboardingStatus: "not_started" });
    const response = await request(app)
      .post("/api/t/r2-branding-camp/uploads/presign-public")
      .set("Origin", "http://localhost:5173")
      .send({
        fileName: "logo.png",
        fileType: "image/png",
        fileSize: 10_000,
        scope: "branding-logo"
      });

    expect([200, 413, 503]).toContain(response.status);
    if (response.status !== 200) {
      const code = String(response.body?.error?.code || "");
      expect(["FILE_TOO_LARGE", "R2_NOT_CONFIGURED"]).toContain(code);
    }
  });
});
