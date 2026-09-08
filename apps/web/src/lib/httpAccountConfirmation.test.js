import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let requestJson;
let resetAuthReadiness;
let requiredEvent;

beforeEach(async () => {
  vi.resetModules();
  ({ resetAuthReadiness } = await import("./authReadiness.js"));
  const confirmation = await import("./accountConfirmation.js");
  requiredEvent = confirmation.ACCOUNT_CONFIRMATION_REQUIRED_EVENT;
  ({ requestJson } = await import("./http.js"));
});

afterEach(() => {
  vi.restoreAllMocks();
  resetAuthReadiness?.();
});

describe("protected account confirmation handoff", () => {
  it("announces a cohort gate before surfacing the protected API error", async () => {
    const listener = vi.fn();
    window.addEventListener(requiredEvent, listener);
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 403,
      headers: { get: () => "application/json" },
      json: async () => ({
        error: {
          code: "ACCOUNT_CONFIRMATION_REQUIRED",
          message: "Confirm this account before continuing.",
          nextRoute: "/t/greenlane/account-confirmation"
        }
      })
    }));

    await expect(requestJson("/api/t/greenlane/members", { token: "clerk-token" }))
      .rejects.toMatchObject({ status: 403 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].detail).toMatchObject({ tenantSlug: "greenlane" });
    window.removeEventListener(requiredEvent, listener);
  });

  it("does not announce ordinary control-camp authorization failures", async () => {
    const listener = vi.fn();
    window.addEventListener(requiredEvent, listener);
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 403,
      headers: { get: () => "application/json" },
      json: async () => ({ error: { code: "TENANT_SCOPE_DENIED", message: "Wrong tenant." } })
    }));

    await expect(requestJson("/api/t/cedar/members", { token: "clerk-token" }))
      .rejects.toMatchObject({ status: 403 });
    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener(requiredEvent, listener);
  });
});
