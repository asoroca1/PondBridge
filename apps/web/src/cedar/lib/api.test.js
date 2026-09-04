import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function jwt(exp) {
  return `header.${btoa(JSON.stringify({ exp }))}.signature`;
}

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("media deletion authentication", () => {
  let requestTenantJson;
  let storedToken;
  let sessionToken;
  let fetchMock;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv("VITE_API_BASE", "https://api.pondbridgealumni.com");
    storedToken = jwt(Math.floor(Date.now() / 1000) + 60);
    sessionToken = vi.fn();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", {
      location: { pathname: "/t/cedar/photos", hostname: "cedar.pondbridgealumni.com" },
      Clerk: { session: { getToken: sessionToken } }
    });
    vi.stubGlobal("sessionStorage", { getItem: () => null });
    vi.stubGlobal("localStorage", {
      getItem: (key) => key === "pondbridgeToken" ? storedToken :
        key === "pondbridgeTenantSlug" ? "cedar" : null
    });
    ({ requestTenantJson } = await import("./api.js"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it.each(["/photos/video-id", "/photos/photo-id", "/photos/video-id/comments/comment-id"])(
    "refreshes rejected credentials and retries DELETE %s once",
    async (path) => {
      const freshToken = jwt(Math.floor(Date.now() / 1000) + 120);
      sessionToken.mockResolvedValue(freshToken);
      fetchMock
        .mockResolvedValueOnce(jsonResponse(401, { error: { message: "Token expired" } }))
        .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

      await expect(requestTenantJson(path, { method: "DELETE" })).resolves.toEqual({ ok: true });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0][0]).toBe(`https://api.pondbridgealumni.com/api/t/cedar${path}`);
      expect(fetchMock.mock.calls[0][1]).toMatchObject({
        method: "DELETE", credentials: "include", headers: { Authorization: `Bearer ${storedToken}` }
      });
      expect(sessionToken).toHaveBeenCalledWith({ skipCache: true });
      expect(fetchMock.mock.calls[1]).toEqual([
        fetchMock.mock.calls[0][0],
        expect.objectContaining({
          method: "DELETE", credentials: "include", headers: { Authorization: `Bearer ${freshToken}` }
        })
      ]);
    }
  );

  it("gets a session token when the cached token has already expired", async () => {
    storedToken = jwt(Math.floor(Date.now() / 1000) - 60);
    sessionToken.mockResolvedValue("current-session-token");
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));

    await requestTenantJson("/photos/video-id", { method: "DELETE" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer current-session-token");
  });

  it("includes session cookies when no bearer token is available", async () => {
    storedToken = "";
    sessionToken.mockResolvedValue("");
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));
    window.location.pathname = "/photos";

    await requestTenantJson("/photos/video-id", { method: "DELETE" });

    expect(fetchMock.mock.calls[0][0]).toContain("/api/t/cedar/photos/video-id");
    expect(fetchMock.mock.calls[0][1].credentials).toBe("include");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it("preserves a permission denial without retrying the deletion", async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, { error: { message: "Cannot delete this photo" } }));

    await expect(requestTenantJson("/photos/video-id", { method: "DELETE" })).rejects.toMatchObject({
      status: 403, message: "Cannot delete this photo"
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sessionToken).not.toHaveBeenCalled();
  });

  it("surfaces a failed refresh instead of repeatedly deleting", async () => {
    sessionToken.mockResolvedValue("refreshed-token");
    fetchMock.mockResolvedValue(jsonResponse(401, { error: { message: "Sign in again" } }));

    await expect(requestTenantJson("/photos/video-id", { method: "DELETE" })).rejects.toMatchObject({
      status: 401, message: "Sign in again"
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
