import { describe, expect, it } from "vitest";
import {
  BRAND_ASSET_ROUTES,
  buildTenantManifest,
  campNetworkTitle,
  resolveApiBaseUrl,
  resolveTenantFaviconUrl,
  resolveTenantIconUrl,
  resolveTenantLogoUrl
} from "./tenantBrandAssets.js";

const ICONS = {
  32: "https://cdn.example.com/cedar/icon-32.png",
  180: "https://cdn.example.com/cedar/icon-180.png",
  192: "https://cdn.example.com/cedar/icon-192.png",
  512: "https://cdn.example.com/cedar/icon-512.png"
};

function tenant(overrides = {}) {
  return {
    name: "Camp Cedar",
    theme: { logoUrl: "https://cdn.example.com/cedar/logo.webp", brandPrimary: "#002b5c" },
    ...overrides
  };
}

describe("brand asset routes", () => {
  it("maps every icon path the served HTML references", () => {
    expect(BRAND_ASSET_ROUTES["/brand/icon-32.png"]).toEqual({ kind: "icon", size: 32 });
    expect(BRAND_ASSET_ROUTES["/brand/icon-180.png"]).toEqual({ kind: "icon", size: 180 });
    expect(BRAND_ASSET_ROUTES["/brand/icon-192.png"]).toEqual({ kind: "icon", size: 192 });
    expect(BRAND_ASSET_ROUTES["/brand/manifest.webmanifest"]).toEqual({ kind: "manifest", size: 0 });
    expect(BRAND_ASSET_ROUTES["/brand/anything-else.png"]).toBeUndefined();
  });
});

describe("resolveApiBaseUrl", () => {
  it("prefers explicit configuration and trims trailing slashes", () => {
    expect(
      resolveApiBaseUrl({ PONDBRIDGE_API_BASE: "https://api.example.com/" }, "https://cedar.example.com/")
    ).toBe("https://api.example.com");
    expect(resolveApiBaseUrl({ VITE_API_BASE: "https://api.example.com" }, "https://cedar.example.com/")).toBe(
      "https://api.example.com"
    );
  });

  it("derives the api host from the request when nothing is configured", () => {
    expect(resolveApiBaseUrl({}, "https://cedar.pondbridgealumni.com/brand/icon-32.png")).toBe(
      "https://api.pondbridgealumni.com"
    );
  });
});

describe("resolveTenantIconUrl", () => {
  it("reads generated icons from the public tenant config", () => {
    const config = { config: { branding: { iconUrls: ICONS, logoUrl: "" } } };
    expect(resolveTenantIconUrl(config, 32)).toBe(ICONS[32]);
    expect(resolveTenantIconUrl(config, 180)).toBe(ICONS[180]);
    expect(resolveTenantIconUrl(config, 512)).toBe(ICONS[512]);
  });

  it("never scales up: picks the smallest icon at or above the requested size", () => {
    const config = { theme: { iconUrls: { 192: ICONS[192], 512: ICONS[512] } } };
    expect(resolveTenantIconUrl(config, 32)).toBe(ICONS[192]);
    expect(resolveTenantIconUrl(config, 512)).toBe(ICONS[512]);
  });

  it("falls back to the largest icon when none is big enough", () => {
    const config = { theme: { iconUrls: { 32: ICONS[32] } } };
    expect(resolveTenantIconUrl(config, 512)).toBe(ICONS[32]);
  });

  it("falls back to the raw logo for camps branded before icons existed", () => {
    expect(resolveTenantIconUrl(tenant(), 32)).toBe("https://cdn.example.com/cedar/logo.webp");
    expect(resolveTenantLogoUrl(tenant())).toBe("https://cdn.example.com/cedar/logo.webp");
  });

  it("returns nothing when the camp has no branding at all", () => {
    expect(resolveTenantIconUrl({ name: "Camp Cedar" }, 32)).toBe("");
    expect(resolveTenantIconUrl(null, 32)).toBe("");
  });

  it("rejects non-http icon urls so a bad value cannot become the tab icon", () => {
    const config = { theme: { iconUrls: { 32: "javascript:alert(1)" }, logoUrl: "" } };
    expect(resolveTenantIconUrl(config, 32)).toBe("");
  });
});

describe("campNetworkTitle", () => {
  it("labels the camp exactly once", () => {
    expect(campNetworkTitle("Camp Cedar")).toBe("Camp Cedar Alumni Network");
    expect(campNetworkTitle("Cedar")).toBe("Camp Cedar Alumni Network");
    expect(campNetworkTitle("")).toBe("PondBridge");
  });
});

describe("buildTenantManifest", () => {
  it("brands the installed app and points at the per-camp icon routes", () => {
    const manifest = buildTenantManifest(tenant());
    expect(manifest.name).toBe("Camp Cedar Alumni Network");
    expect(manifest.short_name).toBe("Camp Cedar");
    expect(manifest.theme_color).toBe("#002b5c");
    expect(manifest.icons.map((icon) => icon.src)).toEqual([
      "/brand/icon-192.png",
      "/brand/icon-512.png"
    ]);
  });

  it("stays valid for a camp with no theme", () => {
    const manifest = buildTenantManifest({ name: "" });
    expect(manifest.name).toBe("PondBridge");
    expect(manifest.short_name).toBe("PondBridge");
    expect(manifest.theme_color).toBe("#404040");
  });
});

describe("director-supplied tab icon", () => {
  it("reads faviconUrl from the public config and from the raw theme", () => {
    expect(
      resolveTenantFaviconUrl({ config: { branding: { faviconUrl: "https://cdn.example.com/a.png" } } })
    ).toBe("https://cdn.example.com/a.png");
    expect(resolveTenantFaviconUrl({ theme: { faviconUrl: "https://cdn.example.com/b.png" } })).toBe(
      "https://cdn.example.com/b.png"
    );
  });

  it("ignores a faviconUrl that is not a usable absolute http(s) URL", () => {
    expect(resolveTenantFaviconUrl({ theme: { faviconUrl: "/icons/local.png" } })).toBe("");
    expect(resolveTenantFaviconUrl({ theme: { faviconUrl: "data:image/png;base64,AAAA" } })).toBe("");
    expect(resolveTenantFaviconUrl({})).toBe("");
  });

  it("prefers the camp's own square icon over its logo when no derivatives exist", () => {
    const withFavicon = tenant({
      theme: {
        logoUrl: "https://cdn.example.com/cedar/logo.webp",
        faviconUrl: "https://cdn.example.com/cedar/icon.png"
      }
    });
    expect(resolveTenantIconUrl(withFavicon, 32)).toBe("https://cdn.example.com/cedar/icon.png");
    expect(resolveTenantIconUrl(withFavicon, 180)).toBe("https://cdn.example.com/cedar/icon.png");
  });

  it("still falls back to the logo for camps that never set an icon", () => {
    expect(resolveTenantIconUrl(tenant(), 32)).toBe("https://cdn.example.com/cedar/logo.webp");
  });

  it("uses the generated derivatives ahead of both", () => {
    const branded = tenant({
      theme: {
        logoUrl: "https://cdn.example.com/cedar/logo.webp",
        faviconUrl: "https://cdn.example.com/cedar/icon.png",
        iconUrls: ICONS
      }
    });
    expect(resolveTenantIconUrl(branded, 32)).toBe(ICONS[32]);
    expect(resolveTenantIconUrl(branded, 180)).toBe(ICONS[180]);
  });
});
