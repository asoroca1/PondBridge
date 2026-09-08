import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import usePersonActions from "./usePersonActions.js";

function renderActions({ request = vi.fn(), reload = vi.fn() } = {}) {
  const hook = renderHook(() => usePersonActions({ request, reload }));
  return { ...hook, request, reload };
}

describe("usePersonActions approval feedback", () => {
  test("keeps a consent-pending single approval actionable after it is saved", async () => {
    const request = vi.fn().mockResolvedValue({ awaitingConsent: true });
    const { result, reload } = renderActions({ request });

    let outcome;
    await act(async () => {
      outcome = await result.current.approve({
        requestId: "recovered-request",
        fullName: "Robin Raskin"
      });
    });

    expect(request).toHaveBeenCalledWith("/members/approvals/recovered-request/approve", { method: "POST" });
    expect(outcome).toEqual({
      ok: true,
      message: "Robin Raskin approved. They must finish account confirmation before gaining access. No further approval is needed."
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test("reports partial bulk approval as actionable failure while retaining the consent count", async () => {
    const request = vi.fn().mockResolvedValue({
      decided: 2,
      awaitingConsent: 3,
      remaining: 0,
      failed: [{ requestId: "blocked-request", code: "RECOVERED_SIGNUP_CONSENT_REQUIRED" }]
    });
    const { result, reload } = renderActions({ request });

    let outcome;
    await act(async () => {
      outcome = await result.current.decideMany("approve", {
        scope: "selected",
        people: [{ requestId: "first" }, { requestId: "second" }, { requestId: "blocked-request" }]
      });
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("2 people approved.");
    expect(outcome.message).toContain("3 must finish account confirmation before gaining access; no further approval is needed.");
    expect(outcome.message).toContain("1 could not be processed. Account confirmation is blocking these requests.");
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test("stops an all-queue approval pass that makes no progress and explains the remaining work", async () => {
    const request = vi.fn().mockResolvedValue({
      decided: 0,
      awaitingConsent: 42,
      remaining: 42,
      failed: [{ requestId: "consent-blocked", code: "RECOVERED_SIGNUP_CONSENT_REQUIRED" }]
    });
    const { result, reload } = renderActions({ request });

    let outcome;
    await act(async () => {
      outcome = await result.current.decideMany("approve", { scope: "all" });
    });

    expect(request).toHaveBeenCalledTimes(1);
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("42 must finish account confirmation before gaining access; no further approval is needed.");
    expect(outcome.message).toContain("Some requests still need attention; processing stopped to avoid repeating failed actions.");
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test("does not claim an all-queue action completed when the forty-pass guard leaves requests", async () => {
    const request = vi.fn().mockResolvedValue({ decided: 1, remaining: 1 });
    const { result, reload } = renderActions({ request });

    let outcome;
    await act(async () => {
      outcome = await result.current.decideMany("approve", { scope: "all" });
    });

    expect(request).toHaveBeenCalledTimes(40);
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("Some requests still need attention; processing stopped to avoid repeating failed actions.");
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
