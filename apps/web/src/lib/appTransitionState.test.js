import { describe, expect, it } from "vitest";
import { inferTransitionSlug, readTransitionBranding } from "./appTransitionState.js";

function createStorage(entries = {}) {
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(entries, key) ? entries[key] : null;
    }
  };
}

describe("app transition branding", () => {
  it("resolves a tenant from a path-scoped preview", () => {
    expect(
      inferTransitionSlug(
        {
          hostname: "codex-fall-rollout-overhaul.pondbridge.pages.dev",
          pathname: "/t/cedar/home"
        },
        createStorage()
      )
    ).toBe("cedar");
  });

  it("uses cached tenant branding for a stable reload shell", () => {
    const storage = createStorage({
      "pondbridgeTenantConfig:cedar": JSON.stringify({
        cachedAt: Date.now(),
        payload: {
          name: "Camp Cedar",
          config: {
            branding: { logoUrl: "https://assets.example/cedar.webp" },
            content: { networkName: "Camp Cedar Alumni Network" }
          }
        }
      })
    });

    expect(
      readTransitionBranding({
        locationLike: {
          hostname: "cedar.pondbridgealumni.com",
          pathname: "/home"
        },
        storage
      })
    ).toEqual({
      slug: "cedar",
      networkName: "Camp Cedar Alumni Network",
      logoUrl: "https://assets.example/cedar.webp"
    });
  });

  it("falls back to the remembered camp without failing on unavailable storage", () => {
    const brokenStorage = {
      getItem() {
        throw new Error("storage unavailable");
      }
    };

    expect(
      readTransitionBranding({
        locationLike: { hostname: "app.pondbridgealumni.com", pathname: "/home" },
        storage: brokenStorage
      }).networkName
    ).toBe("PondBridge");
  });

  // The super console has no camp behind it. It used to inherit the last camp
  // this browser visited, so refreshing the console showed that camp's name and
  // logo in the top left - sometimes a camp that no longer existed.
  it("does not brand the super console with the remembered camp", () => {
    const storage = createStorage({
      pondbridgeTenantSlug: "test29",
      "pondbridgeTenantConfig:test29": JSON.stringify({
        cachedAt: Date.now(),
        payload: {
          name: "Camp test29",
          config: { branding: { logoUrl: "https://assets.example/test29.webp" } }
        }
      })
    });

    expect(
      readTransitionBranding({
        locationLike: { hostname: "super.pondbridgealumni.com", pathname: "/super/tenants" },
        storage
      })
    ).toEqual({ slug: "", networkName: "PondBridge", logoUrl: "" });
  });

  it("does not brand a /super path served from another host", () => {
    const storage = createStorage({ pondbridgeTenantSlug: "test29" });

    expect(
      inferTransitionSlug(
        { hostname: "www.pondbridgealumni.com", pathname: "/super/dashboard" },
        storage
      )
    ).toBe("");
  });

  // A camp visit must still pick the remembered camp up, or every reload of a
  // custom-domain camp would flash the neutral shell.
  it("still remembers the camp on a non-console page", () => {
    const storage = createStorage({ pondbridgeTenantSlug: "cedar" });

    expect(
      inferTransitionSlug({ hostname: "alumni.campcedar.org", pathname: "/home" }, storage)
    ).toBe("cedar");
  });

  it("uses the camp theme logo when cached config branding is empty", () => {
    const storage = createStorage({
      "pondbridgeTenantConfig:cedar": JSON.stringify({
        cachedAt: Date.now(),
        payload: {
          name: "Camp Cedar",
          config: { branding: { logoUrl: "" } },
          theme: { logoUrl: "https://assets.example/cedar-theme.webp" }
        }
      })
    });

    expect(
      readTransitionBranding({
        locationLike: {
          hostname: "cedar.pondbridgealumni.com",
          pathname: "/home"
        },
        storage
      }).logoUrl
    ).toBe("https://assets.example/cedar-theme.webp");
  });
});
