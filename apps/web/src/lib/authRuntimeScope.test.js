import { describe, expect, it } from "vitest";
import { isPublicLandingPath, needsAuthRuntime } from "./authRuntimeScope.js";

describe("isPublicLandingPath", () => {
  it("treats the host root and a bare tenant root as landing pages", () => {
    expect(isPublicLandingPath("/")).toBe(true);
    expect(isPublicLandingPath("/t/cedar")).toBe(true);
    expect(isPublicLandingPath("/t/cedar/")).toBe(true);
  });

  it("does not treat member or admin routes as landing pages", () => {
    expect(isPublicLandingPath("/home")).toBe(false);
    expect(isPublicLandingPath("/t/cedar/home")).toBe(false);
    expect(isPublicLandingPath("/t/cedar/login")).toBe(false);
    expect(isPublicLandingPath("/super/dashboard")).toBe(false);
  });
});

describe("needsAuthRuntime", () => {
  it("skips the runtime only for an anonymous visit to a landing page", () => {
    expect(
      needsAuthRuntime({ pathname: "/t/cedar", clerkEnabled: true, hasSessionSnapshot: false })
    ).toBe(false);
  });

  it("keeps the runtime for a member with a cached session on a landing page", () => {
    expect(
      needsAuthRuntime({ pathname: "/t/cedar", clerkEnabled: true, hasSessionSnapshot: true })
    ).toBe(true);
  });

  it("keeps the runtime on every non-landing route", () => {
    expect(
      needsAuthRuntime({ pathname: "/t/cedar/home", clerkEnabled: true, hasSessionSnapshot: false })
    ).toBe(true);
  });

  it("keeps the runtime when the Clerk SDK is disabled, so legacy auth still loads", () => {
    expect(
      needsAuthRuntime({ pathname: "/", clerkEnabled: false, hasSessionSnapshot: false })
    ).toBe(true);
  });
});
