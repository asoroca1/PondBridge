import { describe, expect, it, vi } from "vitest";
import {
  ACCOUNT_CONFIRMATION_REQUIRED_EVENT,
  buildAccountConfirmationPath,
  dispatchAccountConfirmationRequired,
  isAccountConfirmationRequired,
  normalizeAccountConfirmationReturnTo
} from "./accountConfirmation.js";

describe("account confirmation routing", () => {
  it("preserves only ordinary local routes for the active tenant", () => {
    expect(normalizeAccountConfirmationReturnTo("/t/greenlane/events/1?view=full#details", "greenlane"))
      .toBe("/t/greenlane/events/1?view=full#details");
    expect(normalizeAccountConfirmationReturnTo("https://attacker.example", "greenlane")).toBe("");
    expect(normalizeAccountConfirmationReturnTo("//attacker.example", "greenlane")).toBe("");
    expect(normalizeAccountConfirmationReturnTo("/t/cedar/home", "greenlane")).toBe("");
    expect(normalizeAccountConfirmationReturnTo("/t/greenlane/account-confirmation", "greenlane")).toBe("");
    expect(buildAccountConfirmationPath("greenlane", "/t/cedar/home"))
      .toBe("/t/greenlane/account-confirmation");
  });

  it("recognizes both API payloads and bootstrap error strings", () => {
    expect(isAccountConfirmationRequired({ error: { code: "ACCOUNT_CONFIRMATION_REQUIRED" } })).toBe(true);
    expect(isAccountConfirmationRequired("ACCOUNT_CONFIRMATION_REQUIRED: Finish setup")).toBe(true);
    expect(isAccountConfirmationRequired({ error: { code: "AUTH_REQUIRED" } })).toBe(false);
  });

  it("announces a protected API gate with its tenant boundary", () => {
    const listener = vi.fn();
    window.addEventListener(ACCOUNT_CONFIRMATION_REQUIRED_EVENT, listener);
    dispatchAccountConfirmationRequired("/api/t/greenlane/members", {
      error: { nextRoute: "/t/greenlane/account-confirmation" }
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].detail).toEqual({
      tenantSlug: "greenlane",
      nextRoute: "/t/greenlane/account-confirmation"
    });
    window.removeEventListener(ACCOUNT_CONFIRMATION_REQUIRED_EVENT, listener);
  });
});
