import crypto from "crypto";
import request from "supertest";

// Force legacy auth only for this script process so we can run end-to-end
// provisioning and sample-account checks in local/dev without Clerk UI steps.
process.env.AUTH_PROVIDER = "legacy";
process.env.JWT_SECRET = process.env.JWT_SECRET || `dev-jwt-${crypto.randomBytes(12).toString("hex")}`;
process.env.BCRYPT_ROUNDS = process.env.BCRYPT_ROUNDS || "10";

function fail(message, payload) {
  const error = new Error(message);
  error.payload = payload;
  throw error;
}

async function expectStatus(reqPromise, expectedStatuses, label) {
  const expected = Array.isArray(expectedStatuses) ? expectedStatuses : [expectedStatuses];
  const response = await reqPromise;
  if (!expected.includes(response.status)) {
    fail(`${label} failed (${response.status})`, {
      status: response.status,
      body: response.body,
      text: response.text
    });
  }
  return response;
}

function tokenFromSignupUrl(signupUrl = "") {
  try {
    const query = signupUrl.split("?")[1] || "";
    const params = new URLSearchParams(query);
    return String(params.get("inviteToken") || "").trim();
  } catch {
    return "";
  }
}

function stamp() {
  return new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 12);
}

function randomSuffix() {
  return crypto.randomBytes(3).toString("hex");
}

async function main() {
  const flowStamp = `${stamp()}${randomSuffix()}`;
  const superEmail = "aden@sorocafamily.com";
  const superPassword = `PondBridge!${flowStamp}`;

  const campSlug = `cedar-${flowStamp.slice(-8)}`;
  const campName = `Cedar Test ${flowStamp.slice(-8)}`;
  const directorEmail = `director+${flowStamp}@pondbridge.local`;
  const directorPassword = `Director!${flowStamp}`;

  const sampleUsers = [
    {
      firstName: "Jordan",
      lastName: "Camper",
      email: `camper1+${flowStamp}@pondbridge.local`,
      password: `Camper1!${flowStamp}`,
      cityState: "Chicago, IL",
      roleAtCamp: "Camper"
    },
    {
      firstName: "Taylor",
      lastName: "Counselor",
      email: `staff1+${flowStamp}@pondbridge.local`,
      password: `Staff1!${flowStamp}`,
      cityState: "Denver, CO",
      roleAtCamp: "Counselor"
    },
    {
      firstName: "Riley",
      lastName: "Alum",
      email: `camper2+${flowStamp}@pondbridge.local`,
      password: `Camper2!${flowStamp}`,
      cityState: "Austin, TX",
      roleAtCamp: "Camper"
    }
  ];

  const [{ connectToDatabase }, { default: app }, { UserModel }, { hashPassword }] = await Promise.all([
    import("../src/db/connect.js"),
    import("../src/app.js"),
    import("../src/db/models/index.js"),
    import("../src/utils/auth.js")
  ]);

  await connectToDatabase();

  // Ensure allowlisted super account exists and can login in this dev run.
  let superUser = await UserModel.findSuperAdmin(superEmail);
  const superPasswordHash = await hashPassword(superPassword);

  if (!superUser) {
    superUser = await UserModel.create({
      tenantId: null,
      email: superEmail,
      passwordHash: superPasswordHash,
      roles: ["super_admin", "support_admin", "finance_admin"],
      status: "active"
    });
  } else {
    const roles = new Set(superUser.roles || []);
    roles.add("super_admin");
    roles.add("support_admin");
    roles.add("finance_admin");
    superUser = await UserModel.update(superUser._id, {
      passwordHash: superPasswordHash,
      roles: [...roles],
      status: "active"
    });
  }

  const superLogin = await expectStatus(
    request(app).post("/api/auth/super/login").send({ email: superEmail, password: superPassword }),
    200,
    "Super login"
  );
  const superToken = superLogin.body.token;

  const createTenant = await expectStatus(
    request(app)
      .post("/api/super/tenants")
      .set("Authorization", `Bearer ${superToken}`)
      .send({
        name: campName,
        slug: campSlug,
        planTier: "premium",
        onboardingFeeAmount: 2500,
        directorEmail,
        inviteExpiresInDays: 30
      }),
    201,
    "Create tenant"
  );

  const tenant = createTenant.body.tenant;
  const tenantId = String(tenant?._id || tenant?.id || "");
  const tenantSlug = String(tenant?.slug || "").trim();
  const directorInvite = createTenant.body.directorInvite || {};
  const directorInviteToken = tokenFromSignupUrl(directorInvite.signupUrl || "");

  if (!tenantSlug || !tenantId) {
    fail("Tenant creation response missing id/slug", createTenant.body);
  }
  if (!directorInviteToken) {
    fail("Director invite token was not returned", createTenant.body);
  }

  await expectStatus(
    request(app)
      .post(`/api/t/${tenantSlug}/auth/invite/verify`)
      .send({ inviteToken: directorInviteToken }),
    200,
    "Verify director invite"
  );

  const directorRegister = await expectStatus(
    request(app)
      .post(`/api/t/${tenantSlug}/auth/register`)
      .send({
        firstName: "Camp",
        lastName: "Director",
        email: directorEmail,
        password: directorPassword,
        inviteToken: directorInviteToken,
        cityState: "Chicago, IL",
        roleAtCamp: "Director"
      }),
    201,
    "Director register"
  );
  const directorToken = directorRegister.body.token;

  await expectStatus(
    request(app)
      .patch("/api/tenants/me/theme")
      .set("Authorization", `Bearer ${directorToken}`)
      .send({
        theme: {
          brandPrimary: "#0b3d78",
          logoUrl: "https://example.com/logo-dev.png",
          heroImageUrl: "https://example.com/hero-dev.jpg"
        }
      }),
    200,
    "Onboarding theme step"
  );

  await expectStatus(
    request(app)
      .patch("/api/tenants/me/content")
      .set("Authorization", `Bearer ${directorToken}`)
      .send({
        content: {
          networkDisplayName: `${campName} Alumni Network`,
          welcomeHeadline: `Welcome to ${campName} Alumni Network`,
          welcomeBody: "Reconnect with campers, staff, and directors.",
          aboutText: "A test camp for full provisioning validation.",
          contactEmail: "admin@pondbridge.local",
          supportUrl: "https://pondbridgealumni.com/support",
          footerLinks: [
            { label: "Terms", url: `https://${tenantSlug}.pondbridgealumni.com/legal` },
            { label: "Privacy", url: `https://${tenantSlug}.pondbridgealumni.com/legal` }
          ]
        }
      }),
    200,
    "Onboarding content step"
  );

  await expectStatus(
    request(app)
      .patch("/api/tenants/me/settings")
      .set("Authorization", `Bearer ${directorToken}`)
      .send({
        signupMode: "open",
        allowedEmailDomains: [],
        requireProfileCompletion: false
      }),
    200,
    "Onboarding settings step"
  );

  const seedCsvLines = [
    "firstName,lastName,email,cityState,roleAtCamp",
    `SeedOne,Member,seed1+${flowStamp}@pondbridge.local,Chicago IL,Camper`,
    `SeedTwo,Member,seed2+${flowStamp}@pondbridge.local,Denver CO,Camper`,
    `SeedThree,Member,seed3+${flowStamp}@pondbridge.local,Austin TX,Camper`,
    `SeedFour,Member,seed4+${flowStamp}@pondbridge.local,Miami FL,Camper`,
    `SeedFive,Member,seed5+${flowStamp}@pondbridge.local,Boston MA,Camper`
  ];
  const seedCsv = `${seedCsvLines.join("\n")}\n`;

  const importStep = await expectStatus(
    request(app)
      .post("/api/tenants/me/import/csv")
      .set("Authorization", `Bearer ${directorToken}`)
      .attach("file", Buffer.from(seedCsv, "utf8"), "seed-members.csv"),
    200,
    "Onboarding import step (csv)"
  );
  if (Number(importStep.body?.importSummary?.rowsRead || 0) < 5) {
    fail("CSV import did not read at least 5 rows", importStep.body);
  }

  await expectStatus(
    request(app)
      .patch("/api/tenants/me/modules")
      .set("Authorization", `Bearer ${directorToken}`)
      .send({
        modules: {
          directory: true,
          search: true,
          photoStream: true,
          chat: true,
          map: true,
          familyTrees: true,
          relatedProfiles: true,
          newsletter: true,
          merchShop: true
        }
      }),
    200,
    "Onboarding modules step"
  );

  // Confirm launch is blocked for director before payment/billing readiness.
  const blockedLaunch = await expectStatus(
    request(app)
      .post("/api/tenants/me/launch")
      .set("Authorization", `Bearer ${directorToken}`)
      .send({}),
    400,
    "Director launch blocked check"
  );
  if (blockedLaunch.body?.error?.code !== "LAUNCH_BLOCKED") {
    fail("Expected LAUNCH_BLOCKED before billing override", blockedLaunch.body);
  }

  // Dev bypass payment with super-admin override.
  const superLaunch = await expectStatus(
    request(app)
      .post("/api/tenants/me/launch")
      .set("Authorization", `Bearer ${superToken}`)
      .send({
        tenantId,
        superAdminOverride: true
      }),
    200,
    "Super launch override"
  );

  // Mark billing active/paid for cleaner dev state after launch.
  await expectStatus(
    request(app)
      .patch("/api/tenants/me/billing")
      .set("Authorization", `Bearer ${superToken}`)
      .send({
        tenantId,
        billingStatus: "active",
        onboardingFeePaid: true,
        onboardingFeeInvoiceId: `dev_bypass_${flowStamp}`
      }),
    200,
    "Set billing active for dev"
  );

  const createdSampleUsers = [];
  for (const sample of sampleUsers) {
    const inviteCreate = await expectStatus(
      request(app)
        .post(`/api/t/${tenantSlug}/access/invite/create`)
        .set("Authorization", `Bearer ${directorToken}`)
        .send({
          email: sample.email,
          roleToAssign: "user",
          expiresInDays: 30
        }),
      201,
      `Create sample invite for ${sample.email}`
    );

    const inviteToken = String(inviteCreate.body?.token || "").trim();
    if (!inviteToken) {
      fail(`Invite token missing for ${sample.email}`, inviteCreate.body);
    }

    await expectStatus(
      request(app)
        .post(`/api/t/${tenantSlug}/auth/register`)
        .send({
          firstName: sample.firstName,
          lastName: sample.lastName,
          email: sample.email,
          password: sample.password,
          inviteToken,
          cityState: sample.cityState,
          roleAtCamp: sample.roleAtCamp
        }),
      201,
      `Register sample user ${sample.email}`
    );

    const login = await expectStatus(
      request(app)
        .post(`/api/t/${tenantSlug}/auth/login`)
        .send({
          email: sample.email,
          password: sample.password
        }),
      200,
      `Login sample user ${sample.email}`
    );

    createdSampleUsers.push({
      ...sample,
      userId: String(login.body?.user?._id || login.body?.user?.id || "")
    });
  }

  // Cross-tenant isolation smoke check with a second tenant.
  const isolationTenant = await expectStatus(
    request(app)
      .post("/api/super/tenants")
      .set("Authorization", `Bearer ${superToken}`)
      .send({
        name: `Isolation Camp ${flowStamp.slice(-6)}`,
        slug: `isolation-${flowStamp.slice(-6)}`,
        planTier: "base",
        onboardingFeeAmount: 0
      }),
    201,
    "Create isolation tenant"
  );
  const isolationSlug = String(isolationTenant.body?.tenant?.slug || "").trim();

  const sampleLoginForIsolation = await expectStatus(
    request(app)
      .post(`/api/t/${tenantSlug}/auth/login`)
      .send({
        email: createdSampleUsers[0].email,
        password: createdSampleUsers[0].password
      }),
    200,
    "Login sample user for isolation check"
  );
  const sampleToken = sampleLoginForIsolation.body.token;

  const crossTenantAttempt = await expectStatus(
    request(app)
      .get(`/api/t/${isolationSlug}/profiles`)
      .set("Authorization", `Bearer ${sampleToken}`),
    403,
    "Cross-tenant isolation check"
  );
  const crossTenantCode = String(crossTenantAttempt.body?.error?.code || "");

  const onboardingOverview = await expectStatus(
    request(app)
      .get("/api/tenants/me/onboarding")
      .set("Authorization", `Bearer ${directorToken}`),
    200,
    "Fetch onboarding summary"
  );

  const result = {
    ok: true,
    authModeUsedForScript: "legacy (script-only override)",
    tenant: {
      id: tenantId,
      slug: tenantSlug,
      name: campName,
      domain: superLaunch.body?.network?.domain || createTenant.body?.network?.domain || "",
      loginUrl: superLaunch.body?.network?.loginUrl || createTenant.body?.network?.loginUrl || ""
    },
    launch: {
      live: superLaunch.body?.onboarding?.tenant?.onboardingStatus === "live",
      superAdminOverride: Boolean(superLaunch.body?.onboarding?.launchMeta?.superAdminOverride)
    },
    billing: {
      bypassedForDev: true,
      strategy: "superAdminOverride + manual active billing patch"
    },
    users: {
      superAdmin: {
        email: superEmail,
        password: superPassword
      },
      director: {
        email: directorEmail,
        password: directorPassword
      },
      samples: createdSampleUsers.map((user) => ({
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        password: user.password,
        cityState: user.cityState,
        roleAtCamp: user.roleAtCamp
      }))
    },
    checks: {
      directorPreLaunchBlocked: blockedLaunch.body?.error?.code === "LAUNCH_BLOCKED",
      crossTenantIsolation: crossTenantCode === "TENANT_SCOPE_DENIED",
      onboardingStep: onboardingOverview.body?.tenant?.onboardingStep || "",
      onboardingStatus: onboardingOverview.body?.tenant?.onboardingStatus || ""
    }
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error("Provisioning flow failed.");
  console.error(error?.message || error);
  if (error?.payload) {
    console.error(JSON.stringify(error.payload, null, 2));
  }
  process.exitCode = 1;
});
