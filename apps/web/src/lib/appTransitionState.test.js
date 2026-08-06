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
