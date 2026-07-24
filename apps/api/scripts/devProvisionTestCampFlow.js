import crypto from "crypto";
import request from "supertest";
import { assertReviewedMigrationTarget } from "./applyPlatformAuditSchema.js";

// Force legacy auth only for this script process so we can run end-to-end
// provisioning and sample-account checks in local/dev without Clerk UI steps.
process.env.AUTH_PROVIDER = "legacy";
process.env.JWT_SECRET = process.env.JWT_SECRET || `dev-jwt-${crypto.randomBytes(12).toString("hex")}`;
process.env.BCRYPT_ROUNDS = process.env.BCRYPT_ROUNDS || "10";
process.env.EMAIL_MODE = "mock";

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
  assertReviewedMigrationTarget({
    targetEnvironment: process.env.PONDBRIDGE_TARGET_ENV,
    acknowledgement: process.env.PONDBRIDGE_FRESH_CAMP_REHEARSAL_ACK,
    connectionString: process.env.SUPABASE_DB_URL,
    requiredAcknowledgement: "run-fresh-camp-rehearsal-staging"
  });

  const flowStamp = `${stamp()}${randomSuffix()}`;
  const isLocalStaging = String(process.env.PONDBRIDGE_LOCAL_STAGING || "") === "1";
  const rehearsalEmailDomain = isLocalStaging
    ? "pondbridge.example.test"
    : "pondbridge.local";
  const superEmail = isLocalStaging
    ? `rehearsal-super+${flowStamp}@${rehearsalEmailDomain}`
    : "aden@sorocafamily.com";
  const superPassword = `PondBridge!${flowStamp}`;

  const campSlug = `cedar-${flowStamp.slice(-8)}`;
  const campName = `Cedar Test ${flowStamp.slice(-8)}`;
  const directorEmail = `director+${flowStamp}@${rehearsalEmailDomain}`;
  const directorPassword = `Director!${flowStamp}`;

  const sampleUsers = [
    {
      firstName: "Jordan",
      lastName: "Camper",
      email: `camper1+${flowStamp}@${rehearsalEmailDomain}`,
      password: `Camper1!${flowStamp}`,
      cityState: "Chicago, IL",
      roleAtCamp: "Camper"
    },
    {
      firstName: "Taylor",
      lastName: "Counselor",
      email: `staff1+${flowStamp}@${rehearsalEmailDomain}`,
      password: `Staff1!${flowStamp}`,
      cityState: "Denver, CO",
      roleAtCamp: "Counselor"
    },
    {
      firstName: "Riley",
      lastName: "Alum",
      email: `camper2+${flowStamp}@${rehearsalEmailDomain}`,
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
  const usesFirstSignupBootstrap = directorInvite.mode === "first_signup_bootstrap";
  if (!directorInviteToken && !usesFirstSignupBootstrap) {
    fail("Director claim response did not expose a supported claim mode", createTenant.body);
  }

  if (directorInviteToken) {
    await expectStatus(
      request(app)
        .post(`/api/t/${tenantSlug}/auth/invite/verify`)
        .send({ inviteToken: directorInviteToken }),
      200,
      "Verify director invite"
    );
  }

  const directorRegister = await expectStatus(
    request(app)
      .post(`/api/t/${tenantSlug}/auth/register`)
      .send({
        firstName: "Camp",
        lastName: "Director",
        email: directorEmail,
        password: directorPassword,
        ...(directorInviteToken
          ? { inviteToken: directorInviteToken }
          : { directorSignup: true }),
        legalAgreementAccepted: true,
        ageEligibilityConfirmed: true,
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
          contactEmail: `admin@${rehearsalEmailDomain}`,
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

  const inviteCsvLines = [
    "firstName,lastName,email,cityState,roleAtCamp",
    `InviteOne,Member,invite1+${flowStamp}@${rehearsalEmailDomain},Chicago IL,Camper`,
    `InviteTwo,Member,invite2+${flowStamp}@${rehearsalEmailDomain},Denver CO,Camper`,
    `InviteThree,Member,invite3+${flowStamp}@${rehearsalEmailDomain},Austin TX,Camper`,
    `InviteFour,Member,invite4+${flowStamp}@${rehearsalEmailDomain},Miami FL,Camper`,
    `InviteFive,Member,invite5+${flowStamp}@${rehearsalEmailDomain},Boston MA,Camper`
  ];
  const inviteCsv = `${inviteCsvLines.join("\n")}\n`;

  const invitePreview = await expectStatus(
    request(app)
      .post(`/api/t/${tenantSlug}/admin/invites/preview`)
      .set("Authorization", `Bearer ${directorToken}`)
      .field("roleToAssign", "user")
      .attach("file", Buffer.from(inviteCsv, "utf8"), "initial-invitations.csv"),
    200,
    "Preview initial invitation wave"
  );
  if (Number(invitePreview.body?.summary?.readyCount || 0) !== 5) {
    fail("Invitation preview did not produce five ready recipients", invitePreview.body);
  }

  const inviteSend = await expectStatus(
    request(app)
      .post(`/api/t/${tenantSlug}/admin/invites/send`)
      .set("Authorization", `Bearer ${directorToken}`)
      .field("roleToAssign", "user")
      .field("previewToken", String(invitePreview.body?.previewToken || ""))
      .attach("file", Buffer.from(inviteCsv, "utf8"), "initial-invitations.csv"),
    201,
    "Send reviewed initial invitation wave"
  );
  if (Number(inviteSend.body?.createdCount || 0) !== 5 || Number(inviteSend.body?.sentCount || 0) !== 5) {
    fail("Reviewed invitation wave was not fully created and delivered in mock mode", inviteSend.body);
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
          legalAgreementAccepted: true,
          ageEligibilityConfirmed: true,
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
  const isolationTenantId = String(isolationTenant.body?.tenant?._id || isolationTenant.body?.tenant?.id || "");
  if (!isolationSlug || !isolationTenantId) {
    fail("Isolation tenant creation response missing id/slug", isolationTenant.body);
  }

  let targetAiCapabilities = null;
  let controlAiCapabilities = null;
  let killedAiCapabilities = null;
  await expectStatus(
    request(app)
      .patch("/api/super/analytics/flags/camp_ai_search_v1")
      .set("Authorization", `Bearer ${superToken}`)
      .send({
        state: "pilot",
        killSwitch: false,
        tenantIds: [tenantId],
        excludedTenantIds: [isolationTenantId]
      }),
    200,
    "Enable Camp Search AI target/control pilot"
  );
  try {
    targetAiCapabilities = await expectStatus(
      request(app)
        .get(`/api/t/${tenantSlug}/search/ai/capabilities`)
        .set("Authorization", `Bearer ${superToken}`),
      200,
      "Target camp AI search capability"
    );
    controlAiCapabilities = await expectStatus(
      request(app)
        .get(`/api/t/${isolationSlug}/search/ai/capabilities`)
        .set("Authorization", `Bearer ${superToken}`),
      200,
      "Control camp AI search capability"
    );
    if (!targetAiCapabilities.body?.featureEnabled || controlAiCapabilities.body?.featureEnabled) {
      fail("Camp Search AI target/control boundary failed", {
        target: targetAiCapabilities.body,
        control: controlAiCapabilities.body
      });
    }

    await expectStatus(
      request(app)
        .patch("/api/super/analytics/flags/camp_ai_search_v1")
        .set("Authorization", `Bearer ${superToken}`)
        .send({
          state: "pilot",
          killSwitch: true,
          tenantIds: [tenantId],
          excludedTenantIds: [isolationTenantId]
        }),
      200,
      "Activate Camp Search AI kill switch"
    );
    killedAiCapabilities = await expectStatus(
      request(app)
        .get(`/api/t/${tenantSlug}/search/ai/capabilities`)
        .set("Authorization", `Bearer ${superToken}`),
      200,
      "Target camp AI search kill-switch capability"
    );
    if (killedAiCapabilities.body?.featureEnabled || killedAiCapabilities.body?.rolloutReason !== "kill_switch") {
      fail("Camp Search AI kill switch did not fail closed", killedAiCapabilities.body);
    }
  } finally {
    await expectStatus(
      request(app)
        .patch("/api/super/analytics/flags/camp_ai_search_v1")
        .set("Authorization", `Bearer ${superToken}`)
        .send({
          state: "disabled",
          killSwitch: true,
          tenantIds: [],
          excludedTenantIds: []
        }),
      200,
      "Restore Camp Search AI disabled state"
    );
  }

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
        credentialsLogged: false
      },
      director: {
        email: directorEmail,
        credentialsLogged: false
      },
      samples: createdSampleUsers.map((user) => ({
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        cityState: user.cityState,
        roleAtCamp: user.roleAtCamp,
        credentialsLogged: false
      }))
    },
    checks: {
      directorPreLaunchBlocked: blockedLaunch.body?.error?.code === "LAUNCH_BLOCKED",
      crossTenantIsolation: crossTenantCode === "TENANT_SCOPE_DENIED",
      invitationPreviewReady: Number(invitePreview.body?.summary?.readyCount || 0) === 5,
      invitationWaveSent:
        Number(inviteSend.body?.createdCount || 0) === 5 && Number(inviteSend.body?.sentCount || 0) === 5,
      aiSearchTargetEnabled: Boolean(targetAiCapabilities?.body?.featureEnabled),
      aiSearchControlDisabled: !Boolean(controlAiCapabilities?.body?.featureEnabled),
      aiSearchKillSwitch: killedAiCapabilities?.body?.rolloutReason === "kill_switch",
      aiSearchRestoredDisabled: true,
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
