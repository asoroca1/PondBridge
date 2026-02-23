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

async function createTenant({ slug, name }) {
  return Tenant.create({
    name: name || `Camp ${slug}`,
    slug,
    status: "active",
    planTier: "premium",
    onboardingStatus: "live",
    settings: { signupMode: "open" },
    modules: { search: true }
  });
}

async function createTenantUser(tenantId, email, password = "SearchPass123!", roles = ["tenant_admin", "user"]) {
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
  roleAtCamp = "Camper",
  industry = "Technology",
  currentJobs = []
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
    currentJobs,
    pastJobs: [],
    industry,
    socials: { linkedin: "", instagram: "", facebook: "" },
    avatarUrl: "",
    bio: ""
  });
}

async function loginTenant(slug, email, password = "SearchPass123!") {
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

describe("Fuzzy search and autocomplete", () => {
  test("navbar names endpoint returns typo-tolerant matches", async () => {
    const tenant = await createTenant({ slug: "search-fuzzy-a" });
    const admin = await createTenantUser(tenant._id, "director@search-a.test");

    await createProfile({
      tenantId: tenant._id,
      userId: admin._id,
      firstName: "Jordan",
      lastName: "Camper",
      email: "jordan@search-a.test",
      cityState: "Boston, MA",
      roleAtCamp: "Director",
      industry: "Finance",
      currentJobs: [{ role: "Analyst", company: "Blackstone", isCurrent: true }]
    });

    const userB = await createTenantUser(tenant._id, "taylor@search-a.test", "SearchPass123!", ["user"]);
    await createProfile({
      tenantId: tenant._id,
      userId: userB._id,
      firstName: "Taylor",
      lastName: "Counselor",
      email: "taylor@search-a.test",
      roleAtCamp: "Counselor",
      industry: "Healthcare",
      currentJobs: [{ role: "Nurse", company: "Northwestern Medicine", isCurrent: true }]
    });

    const token = await loginTenant("search-fuzzy-a", "director@search-a.test");

    const byTypo = await request(app)
      .get("/api/t/search-fuzzy-a/search/names?q=jrdan%20campr&limit=8")
      .set("Authorization", `Bearer ${token}`);

    expect(byTypo.status).toBe(200);
    expect(Array.isArray(byTypo.body.items)).toBe(true);
    expect(byTypo.body.items.length).toBeGreaterThan(0);
    expect(byTypo.body.items[0].firstName).toBe("Jordan");
    expect(byTypo.body.items[0].lastName).toBe("Camper");
  });

  test("users search is tenant-isolated and supports fuzzy job/company matching", async () => {
    const tenantA = await createTenant({ slug: "search-fuzzy-tenant-a", name: "Tenant A" });
    const tenantB = await createTenant({ slug: "search-fuzzy-tenant-b", name: "Tenant B" });

    const adminA = await createTenantUser(tenantA._id, "admin@tenant-a.test");
    await createProfile({
      tenantId: tenantA._id,
      userId: adminA._id,
      firstName: "Jordan",
      lastName: "Camper",
      email: "admin@tenant-a.test",
      roleAtCamp: "Director",
      industry: "Finance",
      currentJobs: [{ role: "Analyst", company: "Blackstone", isCurrent: true }]
    });

    const memberA = await createTenantUser(tenantA._id, "alex@tenant-a.test", "SearchPass123!", ["user"]);
    await createProfile({
      tenantId: tenantA._id,
      userId: memberA._id,
      firstName: "Alex",
      lastName: "Pines",
      email: "alex@tenant-a.test",
      roleAtCamp: "Camper",
      industry: "Technology",
      currentJobs: [{ role: "Engineer", company: "PondBridge", isCurrent: true }]
    });

    const memberB = await createTenantUser(tenantB._id, "jordan@tenant-b.test", "SearchPass123!", ["user"]);
    await createProfile({
      tenantId: tenantB._id,
      userId: memberB._id,
      firstName: "Jordan",
      lastName: "Beta",
      email: "jordan@tenant-b.test",
      roleAtCamp: "Camper",
      industry: "Retail",
      currentJobs: [{ role: "Manager", company: "Blue Lake", isCurrent: true }]
    });

    const tokenA = await loginTenant("search-fuzzy-tenant-a", "admin@tenant-a.test");

    const fuzzyByCompany = await request(app)
      .get("/api/t/search-fuzzy-tenant-a/search/users?q=blakston&limit=20")
      .set("Authorization", `Bearer ${tokenA}`);

    expect(fuzzyByCompany.status).toBe(200);
    expect(Array.isArray(fuzzyByCompany.body.items)).toBe(true);
    expect(
      fuzzyByCompany.body.items.some(
        (item) => String(item.firstName || "") === "Jordan" && String(item.lastName || "") === "Camper"
      )
    ).toBe(true);
    expect(
      fuzzyByCompany.body.items.some(
        (item) => String(item.firstName || "") === "Jordan" && String(item.lastName || "") === "Beta"
      )
    ).toBe(false);
  });

  test("search can recover fuzzy matches from supplemental profile fields", async () => {
    const tenant = await createTenant({ slug: "search-fuzzy-supplemental", name: "Supplemental Camp" });
    const admin = await createTenantUser(tenant._id, "admin@supplemental.test");
    await createProfile({
      tenantId: tenant._id,
      userId: admin._id,
      firstName: "Casey",
      lastName: "Rivers",
      email: "admin@supplemental.test",
      roleAtCamp: "Counselor",
      industry: "Education",
      currentJobs: [{ role: "Teacher", company: "Lake School", isCurrent: true }]
    });

    const user = await createTenantUser(tenant._id, "ember@supplemental.test", "SearchPass123!", ["user"]);
    await Profile.create({
      tenantId: tenant._id,
      userId: user._id,
      firstName: "Ember",
      lastName: "Cole",
      emails: ["ember@supplemental.test"],
      phones: [],
      cityState: "Boulder, CO",
      roleAtCamp: "Camper",
      highSchool: "West Ridge Academy",
      colleges: [],
      collegeYears: [],
      currentJobs: [{ role: "Developer", company: "PondBridge", isCurrent: true }],
      pastJobs: [{ role: "Lab Assistant", company: "Harvard Research", years: "2018-2020" }],
      industry: "Technology",
      socials: { linkedin: "", instagram: "", facebook: "" },
      avatarUrl: "",
      bio: ""
    });

    const token = await loginTenant("search-fuzzy-supplemental", "admin@supplemental.test");
    const response = await request(app)
      .get("/api/t/search-fuzzy-supplemental/search/users?q=harverd%20reserch&limit=20")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.items)).toBe(true);
    expect(
      response.body.items.some(
        (item) => String(item.firstName || "") === "Ember" && String(item.lastName || "") === "Cole"
      )
    ).toBe(true);
  });
});
