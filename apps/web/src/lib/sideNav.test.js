import { describe, expect, it } from "vitest";
import { resolveSideNavEnabled } from "./campLabels.js";
import { isCurrentNavPath } from "../components/SideNav.jsx";
import { sideNavAllowedForPath } from "../hooks/useMemberNav.js";

describe("side nav tenant setting", () => {
  it("is off unless the director turned it on", () => {
    expect(resolveSideNavEnabled(undefined)).toBe(false);
    expect(resolveSideNavEnabled({ name: "Camp Cedar" })).toBe(false);
    expect(resolveSideNavEnabled({ config: { content: {} } })).toBe(false);
  });

  it("reads the flag off the public tenant config", () => {
    expect(resolveSideNavEnabled({ config: { content: { sideNavEnabled: true } } })).toBe(true);
  });

  it("falls back to the unwrapped tenant content", () => {
    expect(resolveSideNavEnabled({ content: { sideNavEnabled: true } })).toBe(true);
  });
});

describe("side nav current-item matching", () => {
  it("matches the exact route", () => {
    expect(isCurrentNavPath("/t/cedar/home", "/t/cedar/home")).toBe(true);
    expect(isCurrentNavPath("/t/cedar/home", "/t/cedar/search")).toBe(false);
  });

  it("ignores the query string on items that carry one", () => {
    expect(isCurrentNavPath("/t/cedar/chat-rooms?tab=personal", "/t/cedar/chat-rooms")).toBe(true);
  });

  it("ignores a trailing slash on either side", () => {
    expect(isCurrentNavPath("/t/cedar/events/", "/t/cedar/events")).toBe(true);
  });

  it("keeps the parent item lit on a detail route", () => {
    expect(isCurrentNavPath("/t/cedar/events", "/t/cedar/events/summer-reunion")).toBe(true);
  });

  it("does not light every item when the tenant is host-scoped at the root", () => {
    expect(isCurrentNavPath("/", "/photo-stream")).toBe(false);
    expect(isCurrentNavPath("/", "/")).toBe(true);
  });

  it("does not treat a prefix of another route name as a match", () => {
    expect(isCurrentNavPath("/t/cedar/event", "/t/cedar/events")).toBe(false);
  });
});

describe("routes the side nav belongs on", () => {
  it("shows on member pages", () => {
    for (const path of [
      "/t/cedar/home",
      "/t/cedar/photo-stream",
      "/t/cedar/location-map",
      "/t/cedar/events/summer-reunion",
      "/home",
      "/my-profile"
    ]) {
      expect(sideNavAllowedForPath(path)).toBe(true);
    }
  });

  it("stays out of the director console, which has its own two-level nav", () => {
    for (const path of [
      "/t/cedar/admin",
      "/t/cedar/admin/settings/features",
      "/t/cedar/admin/people",
      "/admin/billing",
      "/t/cedar/onboarding",
      "/settings/branding",
      "/super",
      "/super/settings"
    ]) {
      expect(sideNavAllowedForPath(path)).toBe(false);
    }
  });

  it("never shows member links on an auth screen", () => {
    for (const path of [
      "/t/cedar/login",
      "/t/cedar/create-account",
      "/t/cedar/forgot-password",
      "/t/cedar/auth/callback"
    ]) {
      expect(sideNavAllowedForPath(path)).toBe(false);
    }
  });

  it("stays off the public entry page", () => {
    expect(sideNavAllowedForPath("/")).toBe(false);
    expect(sideNavAllowedForPath("/t/cedar")).toBe(false);
    expect(sideNavAllowedForPath("/t/cedar/")).toBe(false);
  });
});
