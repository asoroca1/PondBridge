import { jest } from "@jest/globals";

describe("provider-backed email scheduling", () => {
  let originalFetch;

  beforeAll(() => {
    process.env.NODE_ENV = "test";
    process.env.EMAIL_MODE = "resend";
    process.env.EMAIL_FROM = "PondBridge <no-reply@pondbridge.test>";
    process.env.RESEND_API_KEY = "re_test_schedule";
    process.env.RESEND_API_BASE_URL = "https://api.resend.test";
    process.env.RESEND_MAX_RETRIES = "0";
    originalFetch = global.fetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

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
