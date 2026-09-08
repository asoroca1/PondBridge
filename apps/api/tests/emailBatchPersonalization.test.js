import { jest } from "@jest/globals";

let originalFetch;

beforeAll(() => {
  process.env.NODE_ENV = "test";
  // Set the config floor here rather than leaning on a developer's apps/api/.env,
  // so the suite runs the same way on a fresh checkout and in CI.
  process.env.AUTH_PROVIDER = "legacy";
  process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret";
  process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://batchtest.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY || "test-service-role-key";
  process.env.EMAIL_MODE = "resend";
  process.env.EMAIL_FROM = "PondBridge <no-reply@pondbridge.test>";
  process.env.RESEND_API_KEY = "re_test_batch";
  process.env.RESEND_API_BASE_URL = "https://api.resend.test";
  process.env.RESEND_MAX_RETRIES = "0";
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

const okBatch = (count) => ({
  ok: true,
  status: 200,
  json: async () => ({
    data: Array.from({ length: count }, (_, index) => ({ id: `msg-${index}` }))
  })
});

describe("personalized broadcasts use the Resend batch API", () => {
  test("sends one request per batch instead of one per recipient", async () => {
    const recipients = Array.from({ length: 25 }, (_, index) => `member${index}@example.test`);
    global.fetch = jest.fn(async () => okBatch(25));

    const { sendBulkTransactionalEmail } = await import("../src/services/email.js");
    const result = await sendBulkTransactionalEmail({
      from: "Camp Cedar <cedar@pondbridge.test>",
      recipients,
      subject: "Summer update",
      html: "<p>Hello {{firstName}}</p>",
      text: "Hello {{firstName}}",
      batchSize: 100,
      personalizer: (recipient) => ({
        html: `<p>Hello ${recipient}</p>`,
        text: `Hello ${recipient}`,
        headers: { "List-Unsubscribe": `<https://example.test/u/${encodeURIComponent(recipient)}>` }
      })
    });

    expect(result.sentCount).toBe(25);
    expect(result.failedCount).toBe(0);
    // One batched request, not twenty-five individual sends.
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe("https://api.resend.test/emails/batch");
    const payload = JSON.parse(options.body);
    expect(payload).toHaveLength(25);
  });

  test("keeps each recipient's own body and unsubscribe header", async () => {
    global.fetch = jest.fn(async () => okBatch(2));

    const { sendBulkTransactionalEmail } = await import("../src/services/email.js");
    await sendBulkTransactionalEmail({
      from: "Camp Cedar <cedar@pondbridge.test>",
      recipients: ["ada@example.test", "grace@example.test"],
      subject: "Summer update",
      html: "<p>Hello {{firstName}}</p>",
      text: "Hello {{firstName}}",
      headers: { "List-ID": "cedar.community <community.cedar.pondbridge.test>" },
      personalizer: (recipient) => ({
        html: `<p>Hello ${recipient}</p>`,
        text: `Hello ${recipient}`,
        headers: { "List-Unsubscribe": `<https://example.test/u/${encodeURIComponent(recipient)}>` }
      })
    });

    const payload = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(payload[0]).toMatchObject({
      to: ["ada@example.test"],
      html: "<p>Hello ada@example.test</p>",
      text: "Hello ada@example.test"
    });
    expect(payload[1]).toMatchObject({
      to: ["grace@example.test"],
      html: "<p>Hello grace@example.test</p>"
    });
    // The per-recipient header wins; the shared header still rides along.
    expect(payload[0].headers["List-Unsubscribe"]).toBe(
      "<https://example.test/u/ada%40example.test>"
    );
    expect(payload[1].headers["List-Unsubscribe"]).toBe(
      "<https://example.test/u/grace%40example.test>"
    );
    expect(payload[0].headers["List-ID"]).toBe(
      "cedar.community <community.cedar.pondbridge.test>"
    );
  });

  test("shrinks the batch so a large personalized body cannot overflow the request", async () => {
    const recipients = Array.from({ length: 6 }, (_, index) => `member${index}@example.test`);
    const bigHtml = `<p>${"x".repeat(120_000)}</p>`;
    global.fetch = jest.fn(async () => okBatch(2));

    jest.resetModules();
    process.env.RESEND_BATCH_MAX_BYTES = "250000";
    const { sendBulkTransactionalEmail } = await import("../src/services/email.js");

    await sendBulkTransactionalEmail({
      from: "Camp Cedar <cedar@pondbridge.test>",
      recipients,
      subject: "Summer update",
      html: bigHtml,
      text: "plain",
      batchSize: 100,
      personalizer: () => ({ html: bigHtml, text: "plain" })
    });

    // 250KB budget over a ~120KB body means two messages per request.
    expect(global.fetch).toHaveBeenCalledTimes(3);
    for (const call of global.fetch.mock.calls) {
      expect(JSON.parse(call[1].body).length).toBeLessThanOrEqual(2);
    }
    delete process.env.RESEND_BATCH_MAX_BYTES;
  });

  test("still falls back to per-recipient sends when attachments are present", async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ id: "single-message" })
    }));

    jest.resetModules();
    const { sendBulkTransactionalEmail } = await import("../src/services/email.js");
    await sendBulkTransactionalEmail({
      from: "Camp Cedar <cedar@pondbridge.test>",
      recipients: ["ada@example.test", "grace@example.test"],
      subject: "Summer update",
      text: "Hello",
      attachments: [{ filename: "flyer.pdf", content: Buffer.from("pdf").toString("base64") }],
      personalizer: (recipient) => ({ text: `Hello ${recipient}` })
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    for (const call of global.fetch.mock.calls) {
      expect(call[0]).toBe("https://api.resend.test/emails");
    }
  });
});
