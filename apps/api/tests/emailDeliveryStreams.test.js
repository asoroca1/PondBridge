import { afterEach, beforeAll, beforeEach, expect, jest, test } from "@jest/globals";
import { verificationCodeTemplate, passwordResetCodeTemplate, magicLinkTemplate } from "../src/services/emailTemplates.js";

let mail, env, EmailSuppressionModel, originalFetch;
beforeAll(async () => {
  process.env.EMAIL_MODE = "resend";
  process.env.EMAIL_FROM = "PondBridge <mail@example.test>";
  process.env.EMAIL_AUTH_FROM = "PondBridge <accounts@auth.example.test>";
  process.env.EMAIL_BULK_FROM = "PondBridge <updates@updates.example.test>";
  process.env.RESEND_API_KEY = "synthetic-resend-key";
  process.env.RESEND_API_BASE_URL = "https://api.resend.test";
  process.env.EMAIL_SUPPRESSION_ENABLED = "true";
  mail = await import("../src/services/email.js");
  ({ env } = await import("../src/config/env.js"));
  ({ EmailSuppressionModel } = await import("../src/db/models/index.js"));
});
beforeEach(() => {
  originalFetch = global.fetch;
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: "synthetic-email" }) }));
  jest.spyOn(EmailSuppressionModel, "findActiveByEmails").mockResolvedValue([]);
});
afterEach(() => { global.fetch = originalFetch; jest.restoreAllMocks(); });

const tenant = { slug: "greenlane", name: "Camp Green Lane", settings: {}, theme: { logoUrl: "https://cdn.example.test/logo.png" } };

test("verification codes use the authenticated stream and retain camp sender identity", async () => {
  await mail.sendVerificationCodeEmail({ tenant, email: "fixture@example.test", code: "000000" });
  const payload = JSON.parse(global.fetch.mock.calls[0][1].body);
  expect(payload.from).toContain("greenlane@auth.example.test");
  expect(payload.from).toContain("Camp Green Lane");
  expect(payload.html).not.toContain("<img");
  expect(payload.text).toContain("If you did not request this code");
});

test("bulk and authentication branding use separate domains with a backwards compatible default", () => {
  expect(mail.buildTenantEmailBranding(tenant, { stream: "bulk" }).from).toContain("@updates.example.test>");
  expect(mail.buildTenantEmailBranding(tenant).from).toContain("@example.test>");
  expect(mail.buildPondBridgeEmailBranding({ stream: "auth" }).from).toContain("accounts@auth.example.test");
  const saved = env.EMAIL_AUTH_FROM;
  try {
    env.EMAIL_AUTH_FROM = "";
    expect(mail.buildTenantEmailBranding(tenant, { stream: "auth" }).from).toContain("@example.test>");
  } finally { env.EMAIL_AUTH_FROM = saved; }
});

test("a bulk send makes no provider call when suppression storage is unavailable", async () => {
  EmailSuppressionModel.findActiveByEmails.mockRejectedValue(new Error("Synthetic database outage"));
  await expect(mail.sendBulkTransactionalEmail({ recipients: ["fixture@example.test"], subject: "Fixture", text: "Fixture" }))
    .rejects.toMatchObject({ code: "EMAIL_SUPPRESSION_UNAVAILABLE" });
  expect(global.fetch).not.toHaveBeenCalled();
});

test.each([
  ["verification", verificationCodeTemplate, { brandName: "Camp & Friends", code: "000000" }],
  ["reset", passwordResetCodeTemplate, { brandName: "Camp & Friends", code: "000000" }],
  ["sign-in", magicLinkTemplate, { tenantName: "Camp & Friends", link: "https://camp.example.test/sign-in" }]
])("%s security email works without remote images and has no notification opt-out wording", (_label, render, args) => {
  const message = render({ ...args, logoUrl: "https://cdn.example.test/logo.png" });
  expect(message.html).not.toContain("<img");
  expect(message.html).not.toContain("notification preferences");
  expect(message.html).not.toContain("Unsubscribe");
  expect(message.html).toContain("Camp &amp; Friends");
  expect(message.text).toMatch(/If you (did not|didn't) request/);
});


test("durable batch sends refuse changed suppression eligibility before generating provider keys", async () => {
  EmailSuppressionModel.findActiveByEmails.mockResolvedValue([{ email: "fixture@example.test" }]);
  await expect(mail.sendBulkTransactionalEmail({ recipients: ["fixture@example.test"], subject: "Fixture", text: "Fixture", requireUnchangedRecipients: true }))
    .rejects.toMatchObject({ code: "EMAIL_RECIPIENT_SET_CHANGED" });
  expect(global.fetch).not.toHaveBeenCalled();
});
