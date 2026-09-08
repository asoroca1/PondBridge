import { jest, beforeEach, test, expect } from "@jest/globals";

const requestFind = jest.fn();
const userFind = jest.fn();
const buildMessage = jest.fn();
const buildConsentPendingMessage = jest.fn();
const send = jest.fn();
const save = jest.fn();
const read = jest.fn();

jest.unstable_mockModule("../src/db/models/index.js", () => ({
  AccessRequestModel: { findOne: requestFind },
  UserModel: { findOne: userFind }
}));
jest.unstable_mockModule("../src/services/email.js", () => ({
  buildAccessApprovalEmail: buildMessage,
  buildAccessConsentPendingEmail: buildConsentPendingMessage,
  sendTransactionalEmail: send
}));
jest.unstable_mockModule("../src/services/durableJobs.js", () => ({
  jobError: (code, retryable = false) => Object.assign(new Error(code), { code, retryable }),
  jobFingerprint: () => "transport-hash",
  readJobByKey: read,
  registerJobHandler: jest.fn(),
  saveJob: save
}));

const { processApprovalEmailJob } = await import("../src/services/approvalEmailJobs.js");
const tenant = { _id: "camp-a", slug: "camp-a", name: "Camp A", status: "active" };
const baseJob = {
  id: "job-a", tenant_id: "camp-a", total: 1, cursor: 0, state: {},
  payload: { requestId: "request-a", approvedUserId: "user-a", email: "member@example.test", firstName: "Member" }
};
const prepared = {
  from: "Camp A <accounts@auth.example.test>", to: "member@example.test", subject: "Approved",
  text: "Approved", html: "<p>Approved</p>", tags: [], transport: "transport-hash",
  idempotencyKey: "access-approval/request-a"
};
const consentPendingPayload = {
  version: 1,
  phase: "consent_pending",
  requestId: "request-a",
  recoveredClerkUserId: "user_recovered",
  email: "member@example.test",
  firstName: "Member",
  directorApprovedAt: "2026-09-08T22:20:00.000Z"
};
const consentPendingRequest = {
  _id: "request-a",
  status: "pending",
  email: "member@example.test",
  recoveredClerkUserId: "user_recovered",
  directorApprovedAt: "2026-09-08T22:20:00.000Z",
  directorApprovedByUserId: "director-a",
  profilePayload: { socials: { signupRecovery: { clerkUserId: "user_recovered" } } }
};

beforeEach(() => {
  jest.clearAllMocks();
  requestFind.mockResolvedValue({ _id: "request-a", status: "approved", approvedUserId: "user-a" });
  userFind.mockResolvedValue({ _id: "user-a", tenantId: "camp-a", status: "active", email: "member@example.test" });
  buildMessage.mockReturnValue({ ...prepared });
  buildConsentPendingMessage.mockReturnValue({ ...prepared, subject: "Finish setup" });
  save.mockResolvedValue(undefined);
  send.mockResolvedValue({ messageId: "provider-message-a" });
});

test("freezes one exact provider request before a transient attempt and reuses it on retry", async () => {
  send.mockRejectedValueOnce(Object.assign(new Error("temporary"), { code: "EMAIL_PROVIDER_TEMPORARY", statusCode: 503 }));
  await expect(processApprovalEmailJob({ ...baseJob }, { tenant })).rejects.toMatchObject({
    code: "APPROVAL_EMAIL_PROVIDER_UNAVAILABLE", retryable: true
  });
  expect(save).toHaveBeenCalledWith(expect.anything(), {
    state: { prepared: expect.objectContaining({ idempotencyKey: "access-approval/request-a", transport: "transport-hash" }) }
  });
  expect(send).toHaveBeenCalledWith(expect.objectContaining({
    idempotencyKey: "access-approval/request-a", suppressionFailClosed: true
  }));

  const result = await processApprovalEmailJob({ ...baseJob, state: { prepared } }, { tenant });
  expect(buildMessage).toHaveBeenCalledTimes(1);
  expect(result).toEqual({ cursor: 1, state: {
    accepted: 1, skipped: 0, outcome: "provider_accepted", providerMessageId: "provider-message-a"
  } });
});

test("missing provider acceptance ID remains retryable under the same key", async () => {
  send.mockResolvedValue({});
  await expect(processApprovalEmailJob({ ...baseJob }, { tenant })).rejects.toMatchObject({
    code: "APPROVAL_EMAIL_PROVIDER_UNAVAILABLE", retryable: true
  });
  expect(send).toHaveBeenCalledTimes(1);
});

test("hard suppression is a visible permanent failure and is never represented as accepted", async () => {
  send.mockRejectedValue(Object.assign(new Error("suppressed"), { code: "RECIPIENT_SUPPRESSED", statusCode: 409 }));
  await expect(processApprovalEmailJob({ ...baseJob }, { tenant })).rejects.toMatchObject({
    code: "APPROVAL_EMAIL_RECIPIENT_SUPPRESSED", retryable: false
  });
});

test("stale member state skips delivery before provider access", async () => {
  userFind.mockResolvedValue({ _id: "user-a", tenantId: "camp-a", status: "inactive", email: "member@example.test" });
  const result = await processApprovalEmailJob({ ...baseJob }, { tenant });
  expect(result.state).toMatchObject({ accepted: 0, skipped: 1, outcome: "APPROVED_MEMBER_NO_LONGER_ACTIVE" });
  expect(send).not.toHaveBeenCalled();
});

test("a consent-pending preapproval sends one frozen setup notice without requiring an active member", async () => {
  requestFind.mockResolvedValue(consentPendingRequest);
  const job = { ...baseJob, payload: consentPendingPayload };

  const result = await processApprovalEmailJob(job, { tenant });

  expect(userFind).not.toHaveBeenCalled();
  expect(buildConsentPendingMessage).toHaveBeenCalledWith({ tenant, email: "member@example.test", firstName: "Member" });
  expect(save).toHaveBeenCalledWith(expect.anything(), {
    state: { prepared: expect.objectContaining({ idempotencyKey: "access-preapproval/request-a", transport: "transport-hash" }) }
  });
  expect(send).toHaveBeenCalledWith(expect.objectContaining({
    idempotencyKey: "access-preapproval/request-a", suppressionFailClosed: true
  }));
  expect(result.state).toMatchObject({ accepted: 1, skipped: 0, outcome: "provider_accepted" });
});

test.each([
  ["request is no longer pending", { ...consentPendingRequest, status: "approved" }],
  ["recovered Clerk identity changed", { ...consentPendingRequest, recoveredClerkUserId: "user_other" }],
  ["recipient email changed", { ...consentPendingRequest, email: "other@example.test" }],
  ["director preapproval timestamp changed", { ...consentPendingRequest, directorApprovedAt: "2026-09-08T22:21:00.000Z" }],
  ["consent was already completed", { ...consentPendingRequest, profilePayload: { socials: {
    signupRecovery: { clerkUserId: "user_recovered" }, legalAgreement: { accepted: true, ageEligibilityConfirmed: true }
  } } }]]
)("consent-pending delivery is cancelled before provider access when %s", async (_label, staleRequest) => {
  requestFind.mockResolvedValue(staleRequest);
  const result = await processApprovalEmailJob({ ...baseJob, payload: consentPendingPayload }, { tenant });
  expect(result.state).toMatchObject({ accepted: 0, skipped: 1, outcome: "PREAPPROVAL_NO_LONGER_CURRENT" });
  expect(buildConsentPendingMessage).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});

test("a consent-pending retry reuses the frozen setup message and preapproval key", async () => {
  requestFind.mockResolvedValue(consentPendingRequest);
  const frozen = { ...prepared, subject: "Finish setup", idempotencyKey: "access-preapproval/request-a", transport: "transport-hash" };
  const result = await processApprovalEmailJob({ ...baseJob, payload: consentPendingPayload, state: { prepared: frozen } }, { tenant });
  expect(buildConsentPendingMessage).not.toHaveBeenCalled();
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: "access-preapproval/request-a" }));
  expect(result.state).toMatchObject({ accepted: 1, outcome: "provider_accepted" });
});
