import { describe, expect, test } from "vitest";
import { hasResolvedMemberForTenant, shouldFinishTenantSignIn } from "./authRouting.js";

/**
 * The bug this pins: a director clicks the logo, and instead of going home gets
 * a flash of the sign-in screen and "Finalizing sign-in...".
 *
 * Clerk rotates its session in the background. For a moment the app is signed
 * in with no tenant-scoped member, and that state is indistinguishable from a
 * real sign-in that still needs finishing — unless something remembers that a
 * member was already resolved. A `useRef` could not: the component holding it
 * is mounted under three layouts, so an ordinary route change unmounted it and
 * reset the guard to false.
 */

const MEMBER = { tenantSlug: "cedar", roles: ["user"] };

function refreshGap(overrides = {}) {
  return {
    clerkMode: true,
    isAuthenticated: true,
    user: null,
    onAuthBootstrapRoute: false,
    resolvedUserOnce: false,
    cachedUser: MEMBER,
    slug: "cedar",
    ...overrides
  };
}

describe("finishing a tenant sign-in", () => {
  test("a refresh gap after a remount does not send the member to the callback", () => {
    // resolvedUserOnce is false precisely because the remount lost the ref.
    expect(shouldFinishTenantSignIn(refreshGap())).toBe(false);
  });

  test("a real first sign-in still goes to the callback", () => {
    expect(shouldFinishTenantSignIn(refreshGap({ cachedUser: null }))).toBe(true);
  });

  test("a signed-out browser is not asked to finish anything", () => {
    expect(shouldFinishTenantSignIn(refreshGap({ isAuthenticated: false, cachedUser: null })))
      .toBe(false);
  });

  test("arriving at a second camp is a real sign-in for that camp", () => {
    expect(shouldFinishTenantSignIn(refreshGap({ slug: "pine-ridge" }))).toBe(true);
  });

  test("the in-component guard still short-circuits on its own", () => {
    expect(shouldFinishTenantSignIn(refreshGap({ resolvedUserOnce: true, cachedUser: null })))
      .toBe(false);
  });

  test("the callback route itself never redirects to the callback route", () => {
    expect(shouldFinishTenantSignIn(refreshGap({ onAuthBootstrapRoute: true, cachedUser: null })))
      .toBe(false);
  });

  test("a resolved member ends it regardless of the cache", () => {
    expect(shouldFinishTenantSignIn(refreshGap({ user: MEMBER, cachedUser: null }))).toBe(false);
  });

  test("legacy auth never uses this path", () => {
    expect(shouldFinishTenantSignIn(refreshGap({ clerkMode: false, cachedUser: null }))).toBe(false);
  });
});

describe("recognising a cached member", () => {
  test("matches its own camp, case and spacing aside", () => {
    expect(hasResolvedMemberForTenant({ cachedUser: { tenantSlug: " Cedar " }, slug: "cedar" }))
      .toBe(true);
  });

  test("does not match a different camp", () => {
    expect(hasResolvedMemberForTenant({ cachedUser: MEMBER, slug: "pine-ridge" })).toBe(false);
  });

  test("a super admin belongs to every camp", () => {
    expect(hasResolvedMemberForTenant({
      cachedUser: { tenantSlug: "", roles: ["super_admin"] },
      slug: "pine-ridge"
    })).toBe(true);
  });

  test("no cached member, no claim", () => {
    expect(hasResolvedMemberForTenant({ cachedUser: null, slug: "cedar" })).toBe(false);
  });

  test("an unknown camp cannot be matched by a member with no camp", () => {
    expect(hasResolvedMemberForTenant({ cachedUser: { tenantSlug: "" }, slug: "" })).toBe(false);
  });
});
