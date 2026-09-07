import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * The bug, captured live on production:
 *
 *   page load    /photo-stream
 *   pushState →  /home
 *   pushState →  /login        (30ms later)
 *   HTTP 401     /api/t/cedar/photos
 *   pagehide                   (full reload, and round it goes again)
 *
 * A page load empties the in-memory token. Route data requests do not wait for
 * the auth bootstrap to put it back, so one goes out with no Authorization
 * header, earns a 401, and the app reads that as a dead session — signs the
 * member out, bounces to /login, reloads, and reopens the same window.
 *
 * The session was never dead: /api/t/cedar/me answered 200 throughout, and the
 * same /photos call answered 200 the moment a token was attached by hand.
 */

const AUTHED = { ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => ({ ok: true }) };
const UNAUTHED = { ok: false, status: 401, headers: { get: () => "application/json" }, json: async () => ({ error: { message: "Unauthorized" } }) };

let requestJson;

function installFetch(handler) {
  const calls = [];
  globalThis.fetch = vi.fn(async (url, init) => {
    calls.push(String(init?.headers?.Authorization || ""));
    return handler(calls.length, init);
  });
  return calls;
}

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  sessionStorage.clear();
  delete globalThis.window.Clerk;
  ({ requestJson } = await import("./http.js"));
});

afterEach(() => {
  vi.restoreAllMocks();
  delete globalThis.window.Clerk;
});

describe("a 401 on a request that carried no token", () => {
  test("is retried once the bootstrap produces a token, instead of surfacing", async () => {
    // This browser believes it is signed in — the cached member survives reloads.
    localStorage.setItem("pondbridgeUser", JSON.stringify({ tenantSlug: "cedar", roles: ["user"] }));

    let tokenReady = false;
    setTimeout(() => { tokenReady = true; }, 30);
    const getToken = async () => (tokenReady ? "late-token" : "");

    const calls = installFetch((n) => (n === 1 ? UNAUTHED : AUTHED));

    await expect(requestJson("/api/t/cedar/photos", { getToken })).resolves.toEqual({ ok: true });
    expect(calls[0]).toBe("");
    expect(calls[1]).toBe("Bearer late-token");
  });

  test("still surfaces when the browser has no session to wait for", async () => {
    const getToken = async () => "";
    installFetch(() => UNAUTHED);

    await expect(requestJson("/api/t/cedar/photos", { getToken })).rejects.toMatchObject({ status: 401 });
    // No cached member, no Clerk session: the 401 is the real answer, returned
    // without paying the retry delay.
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  test("gives up rather than retrying forever when the token never arrives", async () => {
    localStorage.setItem("pondbridgeUser", JSON.stringify({ tenantSlug: "cedar", roles: ["user"] }));
    const getToken = async () => "";
    installFetch(() => UNAUTHED);

    await expect(requestJson("/api/t/cedar/photos", { getToken })).rejects.toMatchObject({ status: 401 });
  });

  test("a 401 on a request that did carry a token is left alone", async () => {
    localStorage.setItem("pondbridgeUser", JSON.stringify({ tenantSlug: "cedar", roles: ["user"] }));
    // Same token back from the refresh, so the existing refresh-retry does not fire
    // either: this is a genuine rejection and must reach the caller.
    const getToken = async () => "stale-token";
    installFetch(() => UNAUTHED);

    await expect(requestJson("/api/t/cedar/photos", { getToken })).rejects.toMatchObject({ status: 401 });
  });

  test("public endpoints never wait", async () => {
    localStorage.setItem("pondbridgeUser", JSON.stringify({ tenantSlug: "cedar", roles: ["user"] }));
    installFetch(() => UNAUTHED);

    await expect(requestJson("/api/public/tenant-config", {})).rejects.toMatchObject({ status: 401 });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  test("a successful first call is untouched", async () => {
    const calls = installFetch(() => AUTHED);
    await expect(requestJson("/api/t/cedar/me", { token: "good" })).resolves.toEqual({ ok: true });
    expect(calls).toEqual(["Bearer good"]);
  });
});
