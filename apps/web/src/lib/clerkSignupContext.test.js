import { describe, expect, test } from "vitest";
import { buildClerkSignupContext } from "./clerkSignupContext.js";

describe("buildClerkSignupContext", () => {
  test("keeps member signup scoped to the selected camp", () => {
    expect(buildClerkSignupContext("cedar", "member")).toEqual({
      tenantSlug: "cedar",
      signupAudience: "member"
    });
    expect(buildClerkSignupContext("pine-ridge", "member")).toEqual({
      tenantSlug: "pine-ridge",
      signupAudience: "member"
    });
  });

  test("marks initial director signup as PondBridge onboarding", () => {
    expect(buildClerkSignupContext("cedar", "director")).toEqual({
      tenantSlug: "cedar",
      signupAudience: "director"
    });
  });

  test("does not send malformed tenant context to Clerk", () => {
    expect(buildClerkSignupContext("../cedar", "member")).toEqual({});
  });
});
