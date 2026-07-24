import { describe, expect, it } from "vitest";
import { tenantRoute } from "./tenantRouting.js";

describe("tenantRoute path safety", () => {
  it("keeps profile, query, and hash routes inside a path-scoped tenant", () => {
    const options = { pathname: "/t/cedar/home", host: "pondbridgealumni.com" };

    expect(tenantRoute("cedar", "/profile/member-1?from=search#contact", options)).toBe(
      "/t/cedar/profile/member-1?from=search#contact"
    );
    expect(tenantRoute("cedar", "/chat-rooms?to=member-1", options)).toBe(
      "/t/cedar/chat-rooms?to=member-1"
    );
  });

  it("does not double-prefix an already tenant-scoped route", () => {
    expect(
      tenantRoute("cedar", "/t/cedar/family-trees", {
        pathname: "/t/cedar/home",
        host: "pondbridgealumni.com"
      })
    ).toBe("/t/cedar/family-trees");
  });

  it("removes an accidental prefix on a tenant subdomain", () => {
    expect(
      tenantRoute("cedar", "/t/cedar/photo-stream", {
        pathname: "/home",
        host: "cedar.pondbridgealumni.com"
      })
    ).toBe("/photo-stream");
  });
});
