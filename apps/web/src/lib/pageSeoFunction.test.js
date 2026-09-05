import { afterEach, describe, expect, it, vi } from "vitest";
// The Pages Function lives outside the web workspace, but this is the only vitest
// project in the repo, so the edge behaviour is covered from here.
import { looksLikeAppRoute, onRequest } from "../../../../functions/_middleware.js";

const TENANT = {
  name: "Camp Green Lane",
  theme: { iconUrls: { 512: "https://cdn.example.com/greenlane/icon-512.png" } }
};

const INVITE_PATH = "/create-account?inviteToken=abc123&email=member%40example.com";

// A stand-in for the runtime HTMLRewriter: records the handlers a call registers and
// runs them over a fake head so the rewritten markup can be asserted on.
function stubRewriter() {
  const calls = [];
  class FakeRewriter {
    constructor() {
      this.handlers = [];
    }

    on(selector, handler) {
      this.handlers.push({ selector, handler });
      return this;
    }

    transform(response) {
      const rendered = { title: "", appended: [], attributes: {} };
      for (const { selector, handler } of this.handlers) {
        handler.element({
          setInnerContent: (value) => {
            rendered.title = value;
          },
          append: (markup) => rendered.appended.push(markup),
          setAttribute: (_name, value) => {
            rendered.attributes[selector] = value;
          }
        });
      }
      calls.push(rendered);
      return response;
    }
  }
  vi.stubGlobal("HTMLRewriter", FakeRewriter);
  return calls;
}

function stubFetch(tenant) {
  const spy = vi.fn(async () =>
    tenant
      ? new Response(JSON.stringify(tenant), { headers: { "Content-Type": "application/json" } })
      : new Response("not found", { status: 404 })
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

const SHELL_HEADERS = { "Content-Type": "text/html; charset=utf-8" };

function call(url, { tenant = TENANT, contentType = "text/html; charset=utf-8", status = 200, method = "GET" } = {}) {
  stubFetch(tenant);
  return onRequest({
    request: new Request(url, { method }),
    env: {
      PONDBRIDGE_API_BASE: "https://api.pondbridgealumni.com",
      ASSETS: { fetch: async () => new Response("<html></html>", { headers: SHELL_HEADERS }) }
    },
    next: async () => new Response("<html></html>", { status, headers: { "Content-Type": contentType } })
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("tenant page SEO middleware", () => {
  it("serves an invite link titled for the camp", async () => {
    const rendered = stubRewriter();
    await call(`https://greenlane.pondbridgealumni.com${INVITE_PATH}`);

    expect(rendered).toHaveLength(1);
    expect(rendered[0].title).toBe("Camp Green Lane Alumni Network");
    expect(rendered[0].appended.join("\n")).toContain(
      'content="Camp Green Lane Alumni Network"'
    );
    expect(rendered[0].attributes['meta[name="apple-mobile-web-app-title"]']).toBe(
      "Camp Green Lane"
    );
  });

  it("leaves Cedar's landing page to the root handler that owns its marketing SEO", async () => {
    const rendered = stubRewriter();
    await call("https://cedar.pondbridgealumni.com/");

    expect(rendered).toHaveLength(0);
  });

  it("brands Cedar's other pages, which the root handler never sees", async () => {
    const rendered = stubRewriter();
    await call(`https://cedar.pondbridgealumni.com${INVITE_PATH}`, {
      tenant: { name: "Camp Cedar" }
    });

    expect(rendered[0].title).toBe("Camp Cedar Alumni Network");
  });

  it("passes assets through untouched", async () => {
    const rendered = stubRewriter();
    await call("https://greenlane.pondbridgealumni.com/assets/app.js", {
      contentType: "application/javascript"
    });

    expect(rendered).toHaveLength(0);
  });

  it("still serves the app shell on a deep link, which _redirects no longer covers", async () => {
    const rendered = stubRewriter();
    const response = await call(`https://greenlane.pondbridgealumni.com${INVITE_PATH}`, {
      status: 404
    });

    expect(response.status).toBe(200);
    expect(rendered[0].title).toBe("Camp Green Lane Alumni Network");
  });

  it("leaves file requests 404ing rather than answering them with a page", () => {
    expect(looksLikeAppRoute("/create-account")).toBe(true);
    expect(looksLikeAppRoute("/")).toBe(true);
    expect(looksLikeAppRoute("/t/green-lane/login")).toBe(true);
    expect(looksLikeAppRoute("/robots.txt")).toBe(false);
    expect(looksLikeAppRoute("/manifest.json")).toBe(false);
    expect(looksLikeAppRoute("/brand/icon-32.png")).toBe(false);
    expect(looksLikeAppRoute("/brand/nonsense")).toBe(false);
  });

  it("keeps a missing icon a 404 instead of handing back HTML", async () => {
    const rendered = stubRewriter();
    const response = await call("https://greenlane.pondbridgealumni.com/brand/nope.png", {
      status: 404,
      contentType: "text/plain"
    });

    expect(response.status).toBe(404);
    expect(rendered).toHaveLength(0);
  });

  it("keeps the platform copy when the host resolves to no camp", async () => {
    const rendered = stubRewriter();
    await call("https://pondbridgealumni.com/", { tenant: null });

    expect(rendered).toHaveLength(0);
  });

  it("serves the page unrewritten when the tenant lookup fails", async () => {
    const rendered = stubRewriter();
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("upstream down");
    }));

    const response = await onRequest({
      request: new Request("https://greenlane.pondbridgealumni.com/"),
      env: {},
      next: async () =>
        new Response("<html></html>", { headers: { "Content-Type": "text/html" } })
    });

    expect(response.status).toBe(200);
    expect(rendered).toHaveLength(0);
  });
});
