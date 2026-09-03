import { afterEach, describe, expect, it, vi } from "vitest";
// The Pages Function lives outside the web workspace, but this is the only vitest
// project in the repo, so the edge behaviour is covered from here.
import { onRequest } from "../../../../functions/brand/[[route]].js";

const HOST = "https://cedar.pondbridgealumni.com";
const LOGO = "https://cdn.example.com/cedar/logo.webp";
const ICON_192 = "https://cdn.example.com/cedar/icon-192.png";

const TENANT = {
  name: "Camp Cedar",
  theme: { logoUrl: LOGO, brandPrimary: "#002b5c", iconUrls: { 192: ICON_192 } }
};

function stubFetch(handler) {
  const spy = vi.fn(async (input) => {
    const url = typeof input === "string" ? input : input.url;
    return handler(url);
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

function call(path, { method = "GET", env = {} } = {}) {
  return onRequest({ request: new Request(`${HOST}${path}`, { method }), env });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("/brand/* edge function", () => {
  it("404s unknown paths instead of falling through to the SPA rewrite", async () => {
    const response = await call("/brand/not-an-icon.png");
    expect(response.status).toBe(404);
  });

  it("rejects non-read methods", async () => {
    const response = await call("/brand/icon-32.png", { method: "POST" });
    expect(response.status).toBe(405);
  });

  it("looks the camp up by request host and serves its icon", async () => {
    const requested = [];
    stubFetch(async (url) => {
      requested.push(url);
      if (url.includes("/api/public/tenant-config")) {
        return new Response(JSON.stringify(TENANT), {
          headers: { "Content-Type": "application/json" }
        });
      }
      return new Response("png-bytes", { headers: { "Content-Type": "image/png" } });
    });

    const response = await call("/brand/icon-192.png");

    expect(requested[0]).toBe(
      "https://api.pondbridgealumni.com/api/public/tenant-config?host=cedar.pondbridgealumni.com"
    );
    expect(requested[1]).toBe(ICON_192);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toContain("max-age=300");
    await expect(response.text()).resolves.toBe("png-bytes");
  });

  it("falls back to the raw logo when no derivative exists at that size", async () => {
    const requested = [];
    stubFetch(async (url) => {
      requested.push(url);
      if (url.includes("/api/public/tenant-config")) {
        return new Response(JSON.stringify({ name: "Camp Cedar", theme: { logoUrl: LOGO } }));
      }
      return new Response("webp-bytes", { headers: { "Content-Type": "image/webp" } });
    });

    const response = await call("/brand/icon-32.png");

    expect(requested[1]).toBe(LOGO);
    expect(response.headers.get("Content-Type")).toBe("image/webp");
  });

  it("returns no body for HEAD", async () => {
    stubFetch(async (url) =>
      url.includes("/api/public/tenant-config")
        ? new Response(JSON.stringify(TENANT))
        : new Response("png-bytes", { headers: { "Content-Type": "image/png" } })
    );

    const response = await call("/brand/icon-192.png", { method: "HEAD" });
    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
  });

  it("redirects to the platform mark when the camp has no branding", async () => {
    stubFetch(async () => new Response(JSON.stringify({ name: "Camp Cedar" })));

    const response = await call("/brand/icon-32.png");
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`${HOST}/favicon.svg`);
  });

  it("redirects to the platform mark when the tenant lookup fails", async () => {
    stubFetch(async () => new Response("nope", { status: 500 }));

    const response = await call("/brand/icon-32.png");
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`${HOST}/favicon.svg`);
  });

  it("redirects to the platform mark when the icon origin is unreachable", async () => {
    stubFetch(async (url) => {
      if (url.includes("/api/public/tenant-config")) return new Response(JSON.stringify(TENANT));
      throw new Error("origin down");
    });

    const response = await call("/brand/icon-192.png");
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`${HOST}/favicon.svg`);
  });

  it("serves a per-camp web manifest", async () => {
    stubFetch(async () => new Response(JSON.stringify(TENANT)));

    const response = await call("/brand/manifest.webmanifest");
    expect(response.headers.get("Content-Type")).toContain("application/manifest+json");

    const manifest = await response.json();
    expect(manifest.name).toBe("Camp Cedar Alumni Network");
    expect(manifest.theme_color).toBe("#002b5c");
    expect(manifest.icons).toHaveLength(2);
  });

  it("falls back to the static manifest when the camp cannot be resolved", async () => {
    stubFetch(async () => new Response("nope", { status: 404 }));

    const response = await call("/brand/manifest.webmanifest");
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`${HOST}/manifest.json`);
  });

  it("honours an explicitly configured api base", async () => {
    const requested = [];
    stubFetch(async (url) => {
      requested.push(url);
      return new Response(JSON.stringify({ name: "Camp Cedar" }));
    });

    await call("/brand/icon-32.png", { env: { PONDBRIDGE_API_BASE: "https://api.staging.test" } });
    expect(requested[0]).toBe(
      "https://api.staging.test/api/public/tenant-config?host=cedar.pondbridgealumni.com"
    );
  });
});
