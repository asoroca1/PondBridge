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
    onboardingStatus: "live"
  });

  const tenantB = await Tenant.create({
    name: "Tenant B Camp",
    slug: "tenant-b",
    status: "active",
    planTier: "premium",
    onboardingStatus: "live"
  });

  const adminA = await createUserWithProfile({
    tenant: tenantA,
    email: "admin-a@example.com",
    password: "AdminPass123!",
    roles: ["tenant_admin", "user"],
    firstName: "Admin",
    lastName: "A"
  });

  const memberA = await createUserWithProfile({
    tenant: tenantA,
    email: "member-a@example.com",
    password: "MemberPass123!",
    roles: ["user"],
    firstName: "Member",
    lastName: "A"
  });

  const thirdA = await createUserWithProfile({
    tenant: tenantA,
    email: "third-a@example.com",
    password: "MemberPass123!",
    roles: ["user"],
    firstName: "Third",
    lastName: "A"
  });

  const adminB = await createUserWithProfile({
    tenant: tenantB,
    email: "admin-b@example.com",
    password: "AdminPass123!",
    roles: ["tenant_admin", "user"],
    firstName: "Admin",
    lastName: "B"
  });

  const memberB = await createUserWithProfile({
    tenant: tenantB,
    email: "member-b@example.com",
    password: "MemberPass123!",
    roles: ["user"],
    firstName: "Member",
    lastName: "B"
  });

  return {
    tenantA,
    tenantB,
    users: {
      adminA: adminA.user,
      memberA: memberA.user,
      thirdA: thirdA.user,
      adminB: adminB.user,
      memberB: memberB.user
    },
    credentials: {
      adminA: { email: "admin-a@example.com", password: "AdminPass123!" },
      memberA: { email: "member-a@example.com", password: "MemberPass123!" },
      adminB: { email: "admin-b@example.com", password: "AdminPass123!" },
      memberB: { email: "member-b@example.com", password: "MemberPass123!" }
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

describe("Legacy Cedar compat chat/forums", () => {
  test("DM creation is tenant-scoped and blocks cross-tenant user IDs", async () => {
    const { users, credentials } = await createFixtures();
    const tokenA = await loginTenant("tenant-a", credentials.adminA);

    const blocked = await request(app)
      .post("/api/t/tenant-a/conversations/dm")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ userId: String(users.memberB._id) });

    expect(blocked.status).toBe(404);
    expect(blocked.body.error?.code).toBe("USER_NOT_FOUND");

    const created = await request(app)
      .post("/api/t/tenant-a/conversations/dm")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ userId: String(users.memberA._id) });

    expect(created.status).toBe(201);
    expect(created.body.type).toBe("dm");

    const sameAgain = await request(app)
      .post("/api/t/tenant-a/conversations/dm")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ userId: String(users.memberA._id) });

    expect(sameAgain.status).toBe(200);
    expect(String(sameAgain.body._id)).toBe(String(created.body._id));
  });

  test("Conversation messages enforce tenant and membership boundaries", async () => {
    const { users, credentials } = await createFixtures();
    const tokenAdminA = await loginTenant("tenant-a", credentials.adminA);
    const tokenMemberA = await loginTenant("tenant-a", credentials.memberA);
    const tokenAdminB = await loginTenant("tenant-b", credentials.adminB);

    const createdDm = await request(app)
      .post("/api/t/tenant-a/conversations/dm")
      .set("Authorization", `Bearer ${tokenAdminA}`)
      .send({ userId: String(users.memberA._id) });

    expect(createdDm.status).toBe(201);
    const conversationId = createdDm.body._id;

    const firstMessage = await request(app)
      .post(`/api/t/tenant-a/conversations/${conversationId}/messages`)
      .set("Authorization", `Bearer ${tokenAdminA}`)
      .send({ kind: "text", text: "Welcome to the thread", clientMessageId: "msg-1" });

    expect(firstMessage.status).toBe(201);
    expect(firstMessage.body.text).toBe("Welcome to the thread");

    const deduped = await request(app)
      .post(`/api/t/tenant-a/conversations/${conversationId}/messages`)
      .set("Authorization", `Bearer ${tokenAdminA}`)
      .send({ kind: "text", text: "Welcome to the thread", clientMessageId: "msg-1" });

    expect(deduped.status).toBe(200);
    expect(String(deduped.body._id)).toBe(String(firstMessage.body._id));

    const memberARead = await request(app)
      .get(`/api/t/tenant-a/conversations/${conversationId}/messages`)
      .set("Authorization", `Bearer ${tokenMemberA}`);

    expect(memberARead.status).toBe(200);
    expect(memberARead.body.items).toHaveLength(1);
    expect(memberARead.body.items[0].text).toBe("Welcome to the thread");

    const wrongTenantPath = await request(app)
      .get(`/api/t/tenant-a/conversations/${conversationId}`)
      .set("Authorization", `Bearer ${tokenAdminB}`);

    expect(wrongTenantPath.status).toBe(403);
    expect(wrongTenantPath.body.error?.code).toBe("TENANT_SCOPE_DENIED");
  });

  test("Group creation and forums are tenant-scoped with membership checks", async () => {
    const { users, credentials } = await createFixtures();
    const tokenAdminA = await loginTenant("tenant-a", credentials.adminA);
    const tokenMemberA = await loginTenant("tenant-a", credentials.memberA);
    const tokenAdminB = await loginTenant("tenant-b", credentials.adminB);

    const invalidGroup = await request(app)
      .post("/api/t/tenant-a/conversations/group")
      .set("Authorization", `Bearer ${tokenAdminA}`)
      .send({
        name: "Cross Tenant Group",
        participantIds: [String(users.memberA._id), String(users.memberB._id)]
      });

    expect(invalidGroup.status).toBe(400);
    expect(invalidGroup.body.error?.code).toBe("INVALID_INPUT");

    const validGroup = await request(app)
      .post("/api/t/tenant-a/conversations/group")
      .set("Authorization", `Bearer ${tokenAdminA}`)
      .send({
        name: "A Team Group",
        participantIds: [String(users.memberA._id), String(users.thirdA._id)]
      });

    expect(validGroup.status).toBe(201);
    expect(validGroup.body.type).toBe("group");

    const forumA = await request(app)
      .post("/api/t/tenant-a/forums")
      .set("Authorization", `Bearer ${tokenAdminA}`)
      .send({ name: "General Updates" });

    expect(forumA.status).toBe(201);
    const forumId = forumA.body._id;

    const blockedPost = await request(app)
      .post(`/api/t/tenant-a/forums/${forumId}/posts`)
      .set("Authorization", `Bearer ${tokenMemberA}`)
      .send({ kind: "text", text: "I should not post yet" });

    expect(blockedPost.status).toBe(403);
    expect(blockedPost.body.error?.code).toBe("FORBIDDEN");

    const joined = await request(app)
      .post(`/api/t/tenant-a/forums/${forumId}/join`)
      .set("Authorization", `Bearer ${tokenMemberA}`);

    expect(joined.status).toBe(200);

    const allowedPost = await request(app)
      .post(`/api/t/tenant-a/forums/${forumId}/posts`)
      .set("Authorization", `Bearer ${tokenMemberA}`)
      .send({ kind: "text", text: "Now I can post" });

    expect(allowedPost.status).toBe(201);
    expect(allowedPost.body.text).toBe("Now I can post");

    const hiddenFromTenantB = await request(app)
      .get(`/api/t/tenant-b/forums/${forumId}`)
      .set("Authorization", `Bearer ${tokenAdminB}`);

    expect(hiddenFromTenantB.status).toBe(404);
    expect(hiddenFromTenantB.body.error?.code).toBe("NOT_FOUND");

    const forumNameInTenantB = await request(app)
      .post("/api/t/tenant-b/forums")
      .set("Authorization", `Bearer ${tokenAdminB}`)
      .send({ name: "General Updates" });

    expect(forumNameInTenantB.status).toBe(201);
  });
});
