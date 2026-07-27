import { describe, expect, it } from "vitest";
import { routePreloadKey } from "./routePreload.js";

describe("route intent preloading", () => {
  it("normalizes tenant-prefixed member destinations", () => {
    expect(routePreloadKey("/t/cedar/home")).toBe("home");
    expect(routePreloadKey("/t/cedar/my-profile")).toBe("profile");
    expect(routePreloadKey("/t/cedar/profile/member-1")).toBe("publicProfile");
  });

  it("covers navigation destinations that previously showed a route fallback", () => {
    expect(routePreloadKey("/photo-stream")).toBe("photos");
    expect(routePreloadKey("/chat/thread-1")).toBe("chat");
    expect(routePreloadKey("/events/event-1")).toBe("eventDetail");
    expect(routePreloadKey("/family-trees/new")).toBe("familyTreeCreate");
    expect(routePreloadKey("/admin/dashboard")).toBe("directorDashboard");
  });

  it("does not warm unrelated or external-looking paths", () => {
    expect(routePreloadKey("/legal")).toBe("");
    expect(routePreloadKey("https://example.com/home")).toBe("");
  });
});
