import { describe, expect, test } from "vitest";
import { buildClerkSignupContext } from "./clerkSignupContext.js";
import { buildAcceptedLegalAgreementPayload } from "./legalAgreement.js";

describe("buildClerkSignupContext", () => {
  test("keeps each member signup scoped to its tenant slug", () => {
    expect(buildClerkSignupContext("cedar", "member")).toEqual({
      tenantSlug: "cedar",
      signupAudience: "member"
    });
    expect(buildClerkSignupContext("pine-ridge", "member")).toEqual({
      tenantSlug: "pine-ridge",
      signupAudience: "member"
    });
  });

  test("preserves PondBridge branding only for director signup", () => {
    expect(buildClerkSignupContext("cedar", "director")).toEqual({
      tenantSlug: "cedar",
      signupAudience: "director"
    });
  });

  test("does not send malformed tenant context to Clerk", () => {
    expect(buildClerkSignupContext("../cedar", "member")).toEqual({});
  });

  test("preserves tenant and audience context alongside accepted member consent", () => {
    const signupLegalAgreement = buildAcceptedLegalAgreementPayload({
      acceptedAt: "2026-09-08T20:00:00.000Z",
      ageEligibilityConfirmed: true
    });

    expect(buildClerkSignupContext(" Cedar ", "member", signupLegalAgreement)).toEqual({
      tenantSlug: "cedar",
      signupAudience: "member",
      signupLegalAgreement
    });
  });

  test("does not attach member consent metadata to director signup context", () => {
    const signupLegalAgreement = buildAcceptedLegalAgreementPayload({
      acceptedAt: "2026-09-08T20:00:00.000Z",
      ageEligibilityConfirmed: true
    });

    expect(buildClerkSignupContext("cedar", "director", signupLegalAgreement)).toEqual({
      tenantSlug: "cedar",
      signupAudience: "director"
    });
  });

  test("does not attach unchecked or incomplete consent metadata", () => {
    expect(buildClerkSignupContext("cedar", "member", {
      version: 1,
      accepted: false,
      ageEligibilityConfirmed: false
    })).toEqual({
      tenantSlug: "cedar",
      signupAudience: "member"
    });
  });
});
