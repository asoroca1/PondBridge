import { beforeEach, expect, jest, test } from "@jest/globals";
const rpc = jest.fn();
const send = jest.fn();
const findHeld = jest.fn();
const findBroadcast = jest.fn();
const updateBroadcast = jest.fn();
const eligibility = jest.fn();
const tenant = { _id: "camp-a", slug: "camp-a", status: "active" };
const actor = { status: "active", tenantId: "camp-a", roles: ["tenant_admin"] };
const env = { EMAIL_MODE: "mock", RESEND_BATCH_ENABLED: true, RESEND_BATCH_MAX_BYTES: 5000000 };
jest.unstable_mockModule("../src/services/identityUsers.js", () => ({ applySuperConsoleRolePolicy: (roles) => roles }));
jest.unstable_mockModule("../src/config/env.js", () => ({ env }));
jest.unstable_mockModule("../src/db/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => ({ rpc }) }));
jest.unstable_mockModule("../src/db/models/index.js", () => ({
  TenantModel: { findById: async () => tenant }, UserModel: { findById: async () => actor },
  AlumniContactModel: { find: findHeld }, EmailBroadcastModel: { findOne: findBroadcast, create: async (doc) => doc, updateScoped: updateBroadcast }
}));
jest.unstable_mockModule("../src/services/email.js", () => ({ sendBulkTransactionalEmail: send, buildTenantEmailBranding: () => ({ from: "Camp <camp@example.test>" }) }));
jest.unstable_mockModule("../src/services/emailPreferences.js", () => ({
  COMMUNITY_UPDATES_TOPIC: "community_updates", resolveEmailRecipientEligibility: eligibility,
  buildEmailPreferenceUrls: ({ email }) => ({ manageUrl: `https://example.test/unsubscribe/${email}`, oneClickUrl: `https://example.test/one-click/${email}` })
}));
const { processBroadcastJob } = await import("../src/services/broadcastJobs.js");
const { runJobStep, publicJob, jobFingerprint } = await import("../src/services/durableJobs.js");
function fixture(count = 40) {
  return { id: "job-a", tenant_id: "camp-a", actor_user_id: "admin-a", lease_token: "lease-a", kind: "broadcast", total: count, cursor: 0, state: {},
    payload: { recipients: Array.from({ length: count }, (_, i) => `person${i}@example.test`), names: {},
      composed: { html: "<p>Hello {{firstName}} {{unsubscribeUrl}}</p>", text: "Hello {{firstName}} {{unsubscribeUrl}}" }, broadcast: { subject: "Camp news" } } };
}
beforeEach(() => {
  jest.clearAllMocks(); env.EMAIL_MODE = "mock"; env.RESEND_BATCH_ENABLED = true;
  actor.tenantId = "camp-a";
  rpc.mockResolvedValue({ data: true }); findHeld.mockResolvedValue([]); findBroadcast.mockResolvedValue({ stats: {} });
  eligibility.mockImplementation(async ({ recipients }) => ({ deliverableRecipients: recipients }));
  send.mockImplementation(async ({ recipients }) => ({ sentCount: recipients.length, failedCount: 0, suppressedCount: 0 }));
});
test("600 recipients use fifteen stable bounded chunks with correct aggregate progress", async () => {
  const job = fixture(600);
  for (let i = 0; i < 15; i++) await runJobStep(job);
  expect(job.cursor).toBe(600); expect(job.state).toEqual({ accepted: 600, skipped: 0 });
  expect(send).toHaveBeenCalledTimes(15);
  expect(new Set(send.mock.calls.flatMap(([args]) => args.recipients)).size).toBe(600);
  expect(send.mock.calls.every(([args]) => args.recipients.length === 40 && args.requireUnchangedRecipients)).toBe(true);
  expect(send.mock.calls.map(([args]) => args.idempotencyKey)).toEqual(Array.from({ length: 15 }, (_, i) => `durable-broadcast/job-a/${i * 40}`));
  expect(job.state.prepared).toBeUndefined();
});
test("unknown provider outcome retries frozen payload with identical key", async () => {
  const job = fixture(); send.mockRejectedValueOnce(new Error("connection lost"));
  await expect(processBroadcastJob(job, { tenant })).rejects.toMatchObject({ retryable: true });
  const prepared = structuredClone(job.state.prepared);
  await processBroadcastJob(job, { tenant });
  expect(job.state.prepared).toEqual(prepared);
  expect(send.mock.calls[0][0].idempotencyKey).toBe(send.mock.calls[1][0].idempotencyKey);
  expect(send.mock.calls[0][0].personalizer("person0@example.test")).toEqual(send.mock.calls[1][0].personalizer("person0@example.test"));
});
test("transport change after uncertain attempt fails closed", async () => {
  const job = fixture(); send.mockRejectedValueOnce(new Error("connection lost"));
  await expect(processBroadcastJob(job, { tenant })).rejects.toThrow();
  env.RESEND_BATCH_ENABLED = false;
  await expect(processBroadcastJob(job, { tenant })).rejects.toMatchObject({ code: "BROADCAST_TRANSPORT_CHANGED_REVIEW_REQUIRED", retryable: false });
  expect(send).toHaveBeenCalledTimes(1);
});
test("changed preferences after uncertain attempt stop instead of reindexing provider keys", async () => {
  const job = fixture(); send.mockRejectedValueOnce(new Error("connection lost"));
  await expect(processBroadcastJob(job, { tenant })).rejects.toThrow();
  eligibility.mockResolvedValue({ deliverableRecipients: [] });
  await expect(processBroadcastJob(job, { tenant })).rejects.toMatchObject({ code: "RECIPIENT_ELIGIBILITY_CHANGED_REVIEW_REQUIRED" });
  expect(send).toHaveBeenCalledTimes(1);
});
test("suppression lookup failure prevents any provider call", async () => {
  eligibility.mockRejectedValue(new Error("db down"));
  await expect(processBroadcastJob(fixture(), { tenant })).rejects.toMatchObject({ retryable: true });
  expect(send).not.toHaveBeenCalled();
});
test("partial provider acceptance persists counts and stops automatic replay", async () => {
  send.mockResolvedValue({ sentCount: 10, failedCount: 30, suppressedCount: 0 });
  const job = fixture();
  await expect(processBroadcastJob(job, { tenant })).resolves.toEqual({ terminal: true });
  expect(rpc.mock.calls.at(-1)[1]).toMatchObject({ p_cursor: 40, p_error: "PERMANENT:BROADCAST_PARTIAL_ACCEPTANCE_REVIEW_REQUIRED" });
  expect(job.cursor).toBe(40); expect(job.state.accepted).toBe(10);
});
test("changed actor tenant prevents sending", async () => {
  actor.tenantId = "other-camp";
  await expect(runJobStep(fixture())).rejects.toMatchObject({ code: "JOB_ACTOR_NO_LONGER_AUTHORIZED" });
  expect(send).not.toHaveBeenCalled();
});
test("lost checkpoint lease prevents provider send and public status omits PII", async () => {
  rpc.mockResolvedValue({ data: false });
  const job = fixture();
  await expect(processBroadcastJob(job, { tenant })).rejects.toMatchObject({ code: "JOB_LEASE_LOST" });
  expect(send).not.toHaveBeenCalled(); expect(JSON.stringify(publicJob(job))).not.toContain("example.test");
  expect(jobFingerprint({ b: 1, a: 2 })).toBe(jobFingerprint({ a: 2, b: 1 }));
});
