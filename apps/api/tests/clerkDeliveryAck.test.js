import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
const verifyWebhook = jest.fn();
const send = jest.fn();
jest.unstable_mockModule("@clerk/backend/webhooks", () => ({ verifyWebhook }));
jest.unstable_mockModule("../src/config/env.js", () => ({ env: { CLERK_WEBHOOK_SIGNING_SECRET: "synthetic-signing-secret" } }));
jest.unstable_mockModule("../src/services/email.js", () => ({
  sendVerificationCodeEmail: send, sendPasswordResetCodeEmail: send,
  sendPasswordChangedEmail: send, sendRelayedClerkEmail: send
}));
jest.unstable_mockModule("../src/services/logger.js", () => ({ logLine: jest.fn() }));
const empty = { acrossTenants: () => ({ find: async () => [] }) };
jest.unstable_mockModule("../src/db/models/index.js", () => ({
  TenantModel: {}, UserModel: { findMembershipsByEmail: async () => [] },
  InviteModel: empty, AccessRequestModel: empty
}));
const { processClerkWebhookRequest, verificationDispatchFingerprint } = await import("../src/services/clerkWebhooks.js");
let sequence = 0;
let event;
const request = { method: "POST", headers: { "svix-id": "synthetic-event" }, body: Buffer.from("{}") };
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  event = { type: "email.created", timestamp: Date.now(), data: {
    id: `email-${++sequence}`, to_email_address: `member${sequence}@example.test`, slug: "verification_code", data: { otp_code: "123456" }
  } };
  verifyWebhook.mockResolvedValue(event);
  send.mockResolvedValue({ ok: true, mode: "resend" });
});

afterEach(() => { jest.useRealTimers(); });
async function settledAfterBurst(promise) {
  const outcome = promise.then((value) => ({ value }), (error) => ({ error }));
  await jest.advanceTimersByTimeAsync(3000);
  const result = await outcome;
  if (result.error) throw result.error;
  return result.value;
}

describe("Clerk acknowledges only provider acceptance", () => {
  test("waits for the provider instead of acknowledging a volatile timer", async () => {
    let accept;
    send.mockReturnValue(new Promise((resolve) => { accept = resolve; }));
    let settled = false;
    const pending = processClerkWebhookRequest(request).then((value) => { settled = true; return value; });
    await jest.advanceTimersByTimeAsync(3000);
    expect(settled).toBe(false);
    accept({ ok: true, mode: "resend" });
    await expect(pending).resolves.toMatchObject({ accepted: true, delivered: false, mode: "resend" });
  });

  test("failure is returned to Clerk and retry uses the same non-secret provider key", async () => {
    send.mockRejectedValueOnce(new Error("Provider temporarily unavailable"));
    await expect(settledAfterBurst(processClerkWebhookRequest(request))).rejects.toThrow("Provider temporarily unavailable");
    await expect(settledAfterBurst(processClerkWebhookRequest(request))).resolves.toMatchObject({ accepted: true });
    expect(send).toHaveBeenCalledTimes(2);
    const keys = send.mock.calls.map(([payload]) => payload.idempotencyKey);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[0]).not.toContain("123456");
    expect(keys[0]).not.toContain(event.data.to_email_address);
  });

  test("expired code events are ignored without persisting or sending a code", async () => {
    event.timestamp = Date.now() - 11 * 60 * 1000;
    await expect(processClerkWebhookRequest(request)).resolves.toMatchObject({ ignored: true, reason: "code_event_expired" });
    expect(send).not.toHaveBeenCalled();
  });

  test("a signature rejection never reaches a send", async () => {
    verifyWebhook.mockRejectedValue(new Error("Signature invalid"));
    await expect(processClerkWebhookRequest(request)).rejects.toMatchObject({ code: "CLERK_WEBHOOK_SIGNATURE_INVALID" });
    expect(send).not.toHaveBeenCalled();
  });

  test("concurrent duplicate deliveries share provider acceptance", async () => {
    let accept;
    send.mockReturnValue(new Promise((resolve) => { accept = resolve; }));
    const one = processClerkWebhookRequest(request);
    const two = processClerkWebhookRequest(request);
    await jest.advanceTimersByTimeAsync(3000);
    accept({ ok: true, mode: "resend" });
    await Promise.all([one, two]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  test("separate non-code account events do not share a deduplication key", () => {
    const input = { recipientEmail: "member@example.test", kind: "password_changed", emailId: "one" };
    expect(verificationDispatchFingerprint(input)).not.toBe(verificationDispatchFingerprint({ ...input, emailId: "two" }));
  });
});

test("a code burst sends only the newest event and acknowledges every waiter after acceptance", async () => {
  const old = structuredClone(event);
  const latest = structuredClone(event);
  latest.data.id += "-latest"; latest.data.data.otp_code = "654321"; latest.timestamp += 1;
  verifyWebhook.mockResolvedValueOnce(old).mockResolvedValueOnce(latest);
  let accepted;
  send.mockReturnValue(new Promise((resolve) => { accepted = resolve; }));
  let acknowledgments = 0;
  const one = processClerkWebhookRequest(request).then(() => { acknowledgments++; });
  const two = processClerkWebhookRequest(request).then(() => { acknowledgments++; });
  await jest.advanceTimersByTimeAsync(2999);
  expect(send).not.toHaveBeenCalled(); expect(acknowledgments).toBe(0);
  await jest.advanceTimersByTimeAsync(1);
  expect(send).toHaveBeenCalledTimes(1); expect(send.mock.calls[0][0].code).toBe("654321");
  expect(acknowledgments).toBe(0);
  accepted({ ok: true, mode: "resend" }); await Promise.all([one, two]);
  expect(acknowledgments).toBe(2);
});
test("a failed coalesced send rejects all waiting webhooks", async () => {
  const latest = structuredClone(event); latest.data.data.otp_code = "654321"; latest.timestamp += 1;
  verifyWebhook.mockResolvedValueOnce(event).mockResolvedValueOnce(latest);
  send.mockRejectedValue(new Error("provider down"));
  const results = Promise.allSettled([processClerkWebhookRequest(request), processClerkWebhookRequest(request)]);
  await jest.advanceTimersByTimeAsync(3000);
  expect((await results).map((result) => result.status)).toEqual(["rejected", "rejected"]);
  expect(send).toHaveBeenCalledTimes(1);
});
