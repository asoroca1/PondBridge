import request from "supertest";
import { jest } from "@jest/globals";
import {
  formatHeroImagePositionPercent,
  normalizeHeroImagePosition,
  normalizeHeroImageSize,
  parseHeroImagePosition
} from "@pondbridge/shared";

jest.setTimeout(120000);

let app;
let connectToDatabase;
let clearAllDocuments;
let hashPassword;
let Tenant;
let User;

async function createTenantRecord({
  slug,
  onboardingStatus = "live"
}) {
  return Tenant.create({
    name: `Camp ${slug}`,
    slug,
    status: "active",
    planTier: "base",
    onboardingStatus,
    theme: {
      brandPrimary: "#002b5c",
      logoUrl: "",
      heroImageUrl: "",
      heroImagePosition: "center center",
      heroImageSize: "cover"
    },
    onboardingDraft: {
      theme: {
        brandPrimary: "#002b5c",
        logoUrl: "",
        heroImageUrl: "",
        heroImagePosition: "center center",
        heroImageSize: "cover"
      }
    }
  });
}

async function createTenantAdmin(tenantId, email = "director@example.com") {
  const passwordHash = await hashPassword("AdminPass123!");
  await User.create({
    tenantId,
    email,
    passwordHash,
    roles: ["tenant_admin", "user"],
    status: "active"
  });
}

async function loginTenant(slug, email = "director@example.com", password = "AdminPass123!") {
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
  process.env.PONDBRIDGE_DISABLE_DB_MARKER_GUARD = "1";

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

describe("Hero image normalization helpers", () => {
  test("keeps preset positions and normalizes freeform percentages", () => {
    expect(normalizeHeroImagePosition("center top")).toBe("center top");
    expect(normalizeHeroImagePosition("37.37% 61.62%")).toBe("37.4% 61.6%");
    expect(normalizeHeroImagePosition("120% -15%")).toBe("100% 0%");
  });

  test("rejects malformed freeform positions to fallback", () => {
    expect(normalizeHeroImagePosition("37%61%")).toBe("center center");
    expect(normalizeHeroImagePosition("x% y%", "right center")).toBe("right center");
  });

  test("parses presets and freeform to x/y coordinates", () => {
    expect(parseHeroImagePosition("right bottom")).toEqual({ x: 100, y: 100 });
    expect(parseHeroImagePosition("25% 75%")).toEqual({ x: 25, y: 75 });
    expect(parseHeroImagePosition("bad value", { x: 40, y: 60 })).toEqual({ x: 40, y: 60 });
    expect(formatHeroImagePositionPercent(33.34, 77.76)).toBe("33.3% 77.8%");
  });

  test("normalizes hero image sizes and clamps percentage bounds", () => {
    expect(normalizeHeroImageSize("contain")).toBe("contain");
    expect(normalizeHeroImageSize("132%")).toBe("132%");
    expect(normalizeHeroImageSize("205%")).toBe("cover");
    expect(normalizeHeroImageSize("59%")).toBe("cover");
  });
});

describe("Hero image normalization through API routes", () => {
  test("PATCH /api/t/:slug/admin/settings/branding persists freeform hero values", async () => {
    const tenant = await createTenantRecord({ slug: "branding-normalize-camp", onboardingStatus: "live" });
    await createTenantAdmin(tenant._id);
    const token = await loginTenant("branding-normalize-camp");

    const response = await request(app)
      .patch("/api/t/branding-normalize-camp/admin/settings/branding")
      .set("Authorization", `Bearer ${token}`)
      .send({
        brandPrimary: "#173e72",
        logoUrl: "https://example.com/logo.png",
        heroImageUrl: "https://example.com/hero.jpg",
        heroImagePosition: "33.2% 71.8%",
        heroImageSize: "132%"
      });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.branding.heroImagePosition).toBe("33.2% 71.8%");
    expect(response.body.branding.heroImageSize).toBe("132%");

    const updatedTenant = await Tenant.findById(tenant._id);
    expect(updatedTenant.theme.heroImagePosition).toBe("33.2% 71.8%");
    expect(updatedTenant.theme.heroImageSize).toBe("132%");
  });

  test("PATCH /api/tenants/me/theme clamps freeform position and falls back invalid size", async () => {
    const tenant = await createTenantRecord({
      slug: "onboarding-theme-normalize-camp",
      onboardingStatus: "in_progress"
    });
    await createTenantAdmin(tenant._id);
    const token = await loginTenant("onboarding-theme-normalize-camp");

    const response = await request(app)
      .patch("/api/tenants/me/theme")
      .set("Authorization", `Bearer ${token}`)
      .send({
        heroImageUrl: "https://example.com/hero-updated.jpg",
        heroImagePosition: "120% -15%",
        heroImageSize: "205%"
      });

    expect(response.status).toBe(200);
    expect(response.body.tenant?.onboardingDraft?.theme?.heroImagePosition).toBe("100% 0%");
    expect(response.body.tenant?.onboardingDraft?.theme?.heroImageSize).toBe("cover");

    const updatedTenant = await Tenant.findById(tenant._id);
    expect(updatedTenant.onboardingDraft.theme.heroImagePosition).toBe("100% 0%");
    expect(updatedTenant.onboardingDraft.theme.heroImageSize).toBe("cover");
  });
});
