import {
  AGE_POLICY_VERSION,
  MINIMUM_MEMBER_AGE,
  isMemberEligibilityComplete,
  normalizeMemberLegalAgreement
} from "../src/services/memberEligibility.js";

describe("member age and legal eligibility", () => {
  const now = () => new Date("2026-07-14T12:00:00.000Z");

  test("requires a separate age confirmation in addition to legal acceptance", () => {
    const agreement = normalizeMemberLegalAgreement(
      { legalAgreementAccepted: true },
      { now }
    );
    expect(agreement.accepted).toBe(true);
    expect(agreement.ageEligibilityConfirmed).toBe(false);
    expect(isMemberEligibilityComplete(agreement)).toBe(false);
  });

  test("records the server-owned age threshold and policy version", () => {
    const agreement = normalizeMemberLegalAgreement(
      {
        legalAgreement: {
          accepted: true,
          acceptedAt: "2026-07-14T10:00:00.000Z",
          ageEligibilityConfirmed: true
        }
      },
      { now }
    );
    expect(isMemberEligibilityComplete(agreement)).toBe(true);
    expect(agreement.minimumAge).toBe(MINIMUM_MEMBER_AGE);
    expect(agreement.agePolicyVersion).toBe(AGE_POLICY_VERSION);
    expect(agreement.acceptedAt).toBe("2026-07-14T10:00:00.000Z");
  });

  test("does not trust a client-provided lower minimum age", () => {
    const agreement = normalizeMemberLegalAgreement(
      {
        legalAgreementAccepted: "yes",
        ageEligibilityConfirmed: "yes",
        minimumAge: 1,
        agePolicyVersion: "client-choice"
      },
      { now }
    );
    expect(agreement.minimumAge).toBe(14);
    expect(agreement.agePolicyVersion).toBe(AGE_POLICY_VERSION);
  });
});
