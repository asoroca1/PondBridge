import { expect, test } from "@jest/globals";
import { validateSignupLegalAgreement } from "../src/services/signupConsentReceipts.js";
import { buildAcceptedLegalAgreementPayload } from "../../web/src/lib/legalAgreement.js";
import { buildClerkSignupContext } from "../../web/src/lib/clerkSignupContext.js";
const now = Date.parse("2026-09-08T23:00:00.000Z");
const receipt = () => ({ version: 1, accepted: true, ageEligibilityConfirmed: true,
  termsVersion: "2026-03-04", privacyVersion: "2026-03-04", minimumAge: 14,
  agePolicyVersion: "2026-07-14", acceptedAt: "2026-09-08T22:55:00.000Z" });
test("the actual signup metadata contract remains compatible with server recovery", () => {
  const agreement = buildAcceptedLegalAgreementPayload({
    ageEligibilityConfirmed: true, acceptedAt: receipt().acceptedAt
  });
  const context = buildClerkSignupContext("greenlane", "member", agreement);
  expect(context.tenantSlug).toBe("greenlane");
  expect(validateSignupLegalAgreement(context.signupLegalAgreement, { now })).toEqual(receipt());
  expect(buildClerkSignupContext("greenlane", "director", agreement).signupLegalAgreement).toBeUndefined();
});
test("normalizes only an exact current explicit self-attestation", () => {
  expect(validateSignupLegalAgreement(receipt(), { now })).toEqual(receipt());
  expect(validateSignupLegalAgreement({ ...receipt(), acceptedAt: "2026-09-08T22:55:00Z" }, { now })).toEqual(receipt());
});
test.each([
  ["missing", () => null], ["array", () => []],
  ["unchecked", (r) => ({ ...r, accepted: false })],
  ["string boolean", (r) => ({ ...r, accepted: "true" })],
  ["age not confirmed", (r) => ({ ...r, ageEligibilityConfirmed: false })],
  ["numeric age confirmation", (r) => ({ ...r, ageEligibilityConfirmed: 1 })],
  ["string schema version", (r) => ({ ...r, version: "1" })],
  ["stale terms", (r) => ({ ...r, termsVersion: "2026-01-01" })],
  ["stale privacy", (r) => ({ ...r, privacyVersion: "2026-01-01" })],
  ["stale age policy", (r) => ({ ...r, agePolicyVersion: "2026-01-01" })],
  ["different minimum age", (r) => ({ ...r, minimumAge: 13 })],
  ["string minimum age", (r) => ({ ...r, minimumAge: "14" })],
  ["future claim", (r) => ({ ...r, acceptedAt: "2026-09-09T23:00:00.000Z" })],
  ["before policy existed", (r) => ({ ...r, acceptedAt: "2026-07-13T23:00:00.000Z" })],
  ["invalid calendar day", (r) => ({ ...r, acceptedAt: "2026-09-31T00:00:00.000Z" })],
  ["missing timestamp", (r) => ({ ...r, acceptedAt: undefined })],
  ["unparseable timestamp", (r) => ({ ...r, acceptedAt: "yesterday" })],
  ["extra authority", (r) => ({ ...r, roles: ["tenant_admin"] })]
])("rejects %s without creating an implied receipt", (_label, change) => {
  expect(validateSignupLegalAgreement(change(receipt()), { now })).toBeNull();
});
