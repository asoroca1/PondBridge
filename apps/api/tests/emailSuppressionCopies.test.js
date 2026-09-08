import { afterEach, beforeAll, beforeEach, describe, expect, jest, test } from "@jest/globals";

let sendTransactionalEmail;
let sendBulkTransactionalEmail;
let EmailSuppressionModel;
let originalFetch;

beforeAll(async () => {
  process.env.EMAIL_MODE = "resend";
  process.env.EMAIL_FROM = "PondBridge <no-reply@example.test>";
  process.env.RESEND_API_KEY = "synthetic-resend-key";
  process.env.RESEND_API_BASE_URL = "https://api.resend.test";
  process.env.EMAIL_SUPPRESSION_ENABLED = "true";
  ({ sendTransactionalEmail, sendBulkTransactionalEmail } = await import("../src/services/email.js"));
  ({ EmailSuppressionModel } = await import("../src/db/models/index.js"));
});
beforeEach(() => {
  originalFetch = global.fetch;
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: "synthetic-email" }) }));
  jest.spyOn(EmailSuppressionModel, "findActiveByEmails").mockImplementation(async (emails) =>
    emails.includes("blocked@example.test") ? [{ email: "blocked@example.test", status: "active" }] : []);
});
afterEach(() => { global.fetch = originalFetch; jest.restoreAllMocks(); });

const message = { to: "allowed@example.test", subject: "Synthetic fixture", text: "No actual email is sent." };

describe("suppressed copy recipients", () => {
  test.each(["cc", "bcc"])("blocks a suppressed %s before a transactional provider call", async (field) => {
    await expect(sendTransactionalEmail({ ...message, [field]: "blocked@example.test" }))
      .rejects.toMatchObject({ code: "RECIPIENT_SUPPRESSED" });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test.each(["cc", "bcc"])("blocks a suppressed %s before any bulk batch is delivered", async (field) => {
    await expect(sendBulkTransactionalEmail({ ...message, recipients: ["allowed@example.test", "other@example.test"], [field]: "blocked@example.test" }))
      .rejects.toMatchObject({ code: "RECIPIENT_SUPPRESSED" });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("does not treat Reply-To as a delivery recipient", async () => {
    await expect(sendTransactionalEmail({ ...message, replyTo: "blocked@example.test" })).resolves.toMatchObject({ ok: true });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(EmailSuppressionModel.findActiveByEmails).toHaveBeenCalledWith(["allowed@example.test"]);
  });

  test("preserves unsuppressed CC and BCC in the outgoing payload", async () => {
    await sendTransactionalEmail({ ...message, cc: "copy@example.test", bcc: "blind@example.test" });
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toMatchObject({
      to: ["allowed@example.test"], cc: ["copy@example.test"], bcc: ["blind@example.test"]
    });
  });
});
