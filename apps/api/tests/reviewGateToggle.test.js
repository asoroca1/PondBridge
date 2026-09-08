import request from "supertest";
import { jest } from "@jest/globals";

jest.setTimeout(120000);

let app;
let connectToDatabase;
let clearAllDocuments;
let Tenant;
let User;
let AccessRequestModel;

beforeAll(async () => {
  process.env.JWT_SECRET = "review-gate-toggle-test-secret";
  process.env.JWT_EXPIRES_IN = "1h";
  process.env.BCRYPT_ROUNDS = "4";
  process.env.FRONTEND_ORIGIN = "http://localhost:5173";
  process.env.APP_BASE_DOMAIN = "pondbridge.test";

  ({ connectToDatabase } = await import("../src/db/connect.js"));
  ({ clearAllDocuments } = await import("../src/db/supabaseDocumentModel.js"));
  ({ Tenant } = await import("../src/models/Tenant.js"));
  ({ User } = await import("../src/models/User.js"));
  ({ AccessRequestModel } = await import("../src/db/models/index.js"));
  ({ default: app } = await import("../src/app.js"));

  await connectToDatabase();
});

afterEach(async () => {
  await clearAllDocuments();
});

function registrationBody(email) {
  return {
    firstName: "New",
    lastName: "Member",
    email,
    password: "MemberPass123!",
    legalAgreementAccepted: true,
    ageEligibilityConfirmed: true
  };
}

async function createTenant(slug, settings) {
  return Tenant.create({
    name: `${slug} Camp`,
    slug,
    status: "active",
    planTier: "premium",
    billingStatus: "active",
    onboardingStatus: "live",
    settings
  });
}

describe("review gate toggle", () => {
  test("gate on queues ordinary registration and gate off auto-approves the same request", async () => {
    const tenant = await createTenant("review-gate-toggle", {
      signupMode: "open",
      requireSignupApproval: true
    });

    const email = "member@review-gate.test";
    const queued = await request(app)
      .post(`/api/t/${tenant.slug}/auth/register`)
      .send(registrationBody(email));

    expect(queued.status).toBe(403);
    expect(queued.body.error?.code).toBe("APPROVAL_REQUIRED");
    const pending = await AccessRequestModel.findOne(tenant._id, { email, status: "pending" });
    expect(pending).toBeTruthy();

    const storedTenant = await Tenant.findById(tenant._id);
    storedTenant.settings = { ...storedTenant.settings, requireSignupApproval: false };
    await storedTenant.save();

    const joined = await request(app)
      .post(`/api/t/${tenant.slug}/auth/register`)
      .send(registrationBody(email));

    expect(joined.status).toBe(201);
    expect(joined.body.user.email).toBe(email);

    const resolved = await AccessRequestModel.findById(pending._id);
    expect(resolved.status).toBe("approved");
    expect(String(resolved.approvedUserId)).toBe(String(joined.body.user.id));
    expect(resolved.reviewedByUserId).toBeNull();
  });

  test("gate on continues to require review for a new registration", async () => {
    const tenant = await createTenant("review-gate-on", {
      signupMode: "open",
      requireSignupApproval: true
    });

    const response = await request(app)
      .post(`/api/t/${tenant.slug}/auth/register`)
      .send(registrationBody("new@review-gate.test"));

    expect(response.status).toBe(403);
    expect(response.body.requestSubmitted).toBe(true);
    await expect(User.findOne({ email: "new@review-gate.test" })).resolves.toBeNull();
  });

  test("auto-approval is tenant scoped", async () => {
    const gatedTenant = await createTenant("review-gate-scoped-a", {
      signupMode: "open",
      requireSignupApproval: true
    });
    const openTenant = await createTenant("review-gate-scoped-b", {
      signupMode: "open",
      requireSignupApproval: false
    });
    const email = "same@review-gate.test";

    await request(app)
      .post(`/api/t/${gatedTenant.slug}/auth/register`)
      .send(registrationBody(email));
    const pending = await AccessRequestModel.findOne(gatedTenant._id, { email, status: "pending" });
    expect(pending).toBeTruthy();

    const joined = await request(app)
      .post(`/api/t/${openTenant.slug}/auth/register`)
      .send(registrationBody(email));

    expect(joined.status).toBe(201);
    const untouched = await AccessRequestModel.findById(pending._id);
    expect(untouched.status).toBe("pending");
    expect(String(untouched.tenantId)).toBe(String(gatedTenant._id));
  });
});
