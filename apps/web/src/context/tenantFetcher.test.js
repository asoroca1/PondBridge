import { describe, it, expect } from "vitest";
import { createTenantFetcher } from "./TenantContext.jsx";

/**
 * Navigating between camps faster than the network answers used to let the
 * camp you left write over the camp you arrived at — in React state, in the
 * CSS variables `applyTheme` sets, and in the host-keyed caches that survive
 * a reload. These tests hold the rule that fixes it: only the newest request
 * may write anything.
 */

function createStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    dump: () => Object.fromEntries(map)
  };
}

// A request that only resolves when the test says so, so two fetches can be
// held open at once and finished in whichever order the test wants.
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function tenantPayload(slug, brandPrimary) {
  return {
    slug,
    name: slug.toUpperCase(),
    config: { branding: { brandPrimary, logoUrl: `https://assets.example/${slug}.webp` } }
  };
}

function harness() {
  const states = [];
  const themes = [];
  const pending = new Map();
  const storage = createStorage();

  const fetcher = createTenantFetcher({
    setState: (next) => {
      const previous = states.length ? states[states.length - 1] : { loading: true, error: "", tenant: null };
      states.push(typeof next === "function" ? next(previous) : next);
    },
    request: (path) => {
      const slug = /slug=([^&]+)/.exec(path)?.[1] || "";
      const d = deferred();
      pending.set(slug, d);
      return d.promise;
    },
    theme: (config) => themes.push(config?.branding?.brandPrimary || ""),
    preloadHero: () => {},
    storage,
    getHost: () => "cedar.pondbridgealumni.com"
  });

  return {
    fetcher,
    storage,
    themes,
    states,
    settle: (slug, payload) => pending.get(slug).resolve(payload),
    fail: (slug, message) => pending.get(slug).reject(new Error(message)),
    latestTenant: () => states.filter((s) => s.tenant).at(-1)?.tenant || null
  };
}

describe("tenant fetch generations", () => {
  it("ignores the camp you left when its response lands last", async () => {
    const h = harness();

    const first = h.fetcher.fetchTenant("alpha");
    const second = h.fetcher.fetchTenant("beta");

    // Beta answers first, then alpha's slow response finally arrives.
    h.settle("beta", tenantPayload("beta", "#00ff00"));
    await second;
    h.settle("alpha", tenantPayload("alpha", "#ff0000"));
    await first;

    expect(h.latestTenant().slug).toBe("beta");
    // The theme is a global side effect, so a stale write would repaint the
    // whole app even if React state were right.
    expect(h.themes.at(-1)).toBe("#00ff00");
    expect(h.storage.getItem("pondbridgeTenantSlug")).toBe("beta");
  });

  it("does not let a stale response poison the host-keyed caches", async () => {
    const h = harness();
    const host = "cedar.pondbridgealumni.com";

    const first = h.fetcher.fetchTenant("alpha");
    const second = h.fetcher.fetchTenant("beta");
    h.settle("beta", tenantPayload("beta", "#00ff00"));
    await second;
    h.settle("alpha", tenantPayload("alpha", "#ff0000"));
    await first;

    const cachedByHost = JSON.parse(h.storage.getItem(`pondbridgeTenantConfig:${host}`));
    expect(cachedByHost.payload.slug).toBe("beta");
    expect(h.storage.getItem(`pondbridgeTenantConfig:alpha`)).toBeNull();
  });

  it("does not let a stale failure clear the camp now on screen", async () => {
    const h = harness();

    const first = h.fetcher.fetchTenant("alpha");
    const second = h.fetcher.fetchTenant("beta");
    h.settle("beta", tenantPayload("beta", "#00ff00"));
    await second;
    h.fail("alpha", "network down");
    await first;

    expect(h.latestTenant().slug).toBe("beta");
    expect(h.states.at(-1).error).toBe("");
  });

  it("retire() stops an in-flight response from writing at all", async () => {
    const h = harness();

    const first = h.fetcher.fetchTenant("alpha");
    const writesBefore = h.states.length;
    h.fetcher.retire();
    h.settle("alpha", tenantPayload("alpha", "#ff0000"));
    await first;

    expect(h.states.length).toBe(writesBefore);
    expect(h.storage.getItem("pondbridgeTenantSlug")).toBeNull();
  });

  it("still applies the newest response when nothing supersedes it", async () => {
    const h = harness();

    const only = h.fetcher.fetchTenant("alpha");
    h.settle("alpha", tenantPayload("alpha", "#ff0000"));
    await only;

    expect(h.latestTenant().slug).toBe("alpha");
    expect(h.themes.at(-1)).toBe("#ff0000");
    expect(h.storage.getItem("pondbridgeTenantSlug")).toBe("alpha");
  });
});
