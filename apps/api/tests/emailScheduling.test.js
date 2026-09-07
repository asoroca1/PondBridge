import { jest } from "@jest/globals";

let originalFetch;

beforeAll(() => {
    process.env.NODE_ENV = "test";
    process.env.EMAIL_MODE = "resend";
    process.env.EMAIL_FROM = "PondBridge <no-reply@pondbridge.test>";
    process.env.RESEND_API_KEY = "re_test_schedule";
    process.env.RESEND_API_BASE_URL = "https://api.resend.test";
    process.env.RESEND_MAX_RETRIES = "2";
    process.env.RESEND_RETRY_BASE_DELAY_MS = "0";
    process.env.EMAIL_SUPPRESSION_ENABLED = "false";
    originalFetch = global.fetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

describe("provider-backed email scheduling", () => {
  test("reports scheduling only when Resend is configured", async () => {
    const { getEmailSchedulingStatus } = await import("../src/services/email.js");
    expect(getEmailSchedulingStatus()).toMatchObject({
      available: true,
      mode: "resend",
      configured: true
    });
  });

  test("cancels the provider message rather than only changing local state", async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ id: "provider-message-123" })
    }));
    const { cancelScheduledTransactionalEmail } = await import("../src/services/email.js");

    await expect(cancelScheduledTransactionalEmail("provider-message-123")).resolves.toMatchObject({
      ok: true,
      mode: "resend",
      messageId: "provider-message-123"
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe("https://api.resend.test/emails/provider-message-123/cancel");
    expect(options.method).toBe("POST");
    expect(options.body).toBeUndefined();
  });
});

describe("Resend retry safety", () => {
  const message = { to: "member@example.test", subject: "Audit fixture", text: "Fixture only" };
  const response = (status, body) => ({ ok: status < 300, status, json: async () => body });

  test.each([401, 422, 409])("does not retry permanent HTTP %s errors", async (status) => {
    global.fetch = jest.fn(async () => response(status, {
      name: status === 409 ? "invalid_idempotent_request" : "validation_error",
      message: "Permanent provider rejection"
    }));
    const { sendTransactionalEmail } = await import("../src/services/email.js");
    await expect(sendTransactionalEmail(message)).rejects.toMatchObject({ code: "EMAIL_PROVIDER_REJECTED" });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test("retries a lost response with the same generated idempotency key", async () => {
    global.fetch = jest.fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValue(response(200, { id: "accepted-once" }));
    const { sendTransactionalEmail } = await import("../src/services/email.js");
    await expect(sendTransactionalEmail(message)).resolves.toMatchObject({ messageId: "accepted-once" });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    const keys = global.fetch.mock.calls.map(([, options]) => options.headers["Idempotency-Key"]);
    expect(keys[0]).toMatch(/^pondbridge-request\//);
    expect(keys[1]).toBe(keys[0]);
    await sendTransactionalEmail(message);
    expect(global.fetch.mock.calls[2][1].headers["Idempotency-Key"]).not.toBe(keys[0]);
  });

  test("retries a concurrent idempotent request and preserves a caller key", async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(response(409, { name: "concurrent_idempotent_requests" }))
      .mockResolvedValue(response(200, { id: "accepted-once" }));
    const { sendTransactionalEmail } = await import("../src/services/email.js");
    await sendTransactionalEmail({ ...message, idempotencyKey: "fixture/operation-123" });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    for (const [, options] of global.fetch.mock.calls) {
      expect(options.headers["Idempotency-Key"]).toBe("fixture/operation-123");
    }
  });

  test("bounds retries after repeated service failures", async () => {
    global.fetch = jest.fn(async () => response(503, { name: "application_error" }));
    const { sendTransactionalEmail } = await import("../src/services/email.js");
    await expect(sendTransactionalEmail(message)).rejects.toMatchObject({ code: "EMAIL_PROVIDER_TEMPORARY" });
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });
});

describe("atomic Resend webhook processing", () => {
  async function fixture() {
    const { createHmac } = await import("node:crypto");
    const { env } = await import("../src/config/env.js");
    const { ResendWebhookEventModel, TenantModel } = await import("../src/db/models/index.js");
    const { processResendWebhookRequest } = await import("../src/services/resendWebhooks.js");
    const secret = Buffer.from("isolated-webhook-signing-fixture");
    env.RESEND_WEBHOOK_SECRET = `whsec_${secret.toString("base64")}`;
    const payload = JSON.stringify({ type: "email.bounced", data: {
      email_id: "email-a", to: ["member@example.test"],
      tags: { tenant: "camp-a", pondbridge_broadcast: "broadcast-a" }
    }});
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", secret).update(`event-a.${timestamp}.${payload}`).digest("base64");
    jest.spyOn(TenantModel, "findOne").mockResolvedValue({ _id: "tenant-a", slug: "camp-a" });
    return { processResendWebhookRequest, ResendWebhookEventModel, req: {
      body: Buffer.from(payload), headers: { "svix-id": "event-a", "svix-timestamp": timestamp, "svix-signature": `v1,${signature}` }
    }};
  }

  test("failed atomic processing is not acknowledged and redelivery can complete", async () => {
    const { processResendWebhookRequest, ResendWebhookEventModel, req } = await fixture();
    const process = jest.spyOn(ResendWebhookEventModel, "processAtomically")
      .mockRejectedValueOnce(new Error("database transaction rolled back"))
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    await expect(processResendWebhookRequest(req)).rejects.toThrow("database transaction rolled back");
    await expect(processResendWebhookRequest(req)).resolves.toMatchObject({ processed: 1, duplicates: 0 });
    await expect(processResendWebhookRequest(req)).resolves.toMatchObject({ processed: 0, duplicates: 1 });
    expect(process).toHaveBeenCalledWith(expect.objectContaining({
      svixId: "event-a", tenantId: "tenant-a", pondbridgeBroadcastId: "broadcast-a", recipientEmail: "member@example.test"
    }));
  });

  test("invalid signatures never reach database processing", async () => {
    const { processResendWebhookRequest, ResendWebhookEventModel, req } = await fixture();
    const process = jest.spyOn(ResendWebhookEventModel, "processAtomically");
    req.headers["svix-signature"] = "v1,aW52YWxpZA==";
    await expect(processResendWebhookRequest(req)).rejects.toMatchObject({ code: "WEBHOOK_SIGNATURE_INVALID" });
    expect(process).not.toHaveBeenCalled();
  });
});
