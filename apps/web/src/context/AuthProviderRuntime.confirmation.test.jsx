import { useEffect } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "./AuthContext.jsx";
import { clearAuthStorage, STORAGE_KEYS } from "../lib/storage.js";
import { clearVolatileAuthToken } from "../lib/authMemory.js";

const mocks = vi.hoisted(() => ({
  requestJson: vi.fn(),
  clerk: {
    isLoaded: true,
    isSignedIn: true,
    sessionId: "clerk-session",
    getToken: vi.fn(),
    signOut: vi.fn()
  }
}));

vi.mock("@clerk/clerk-react", () => ({
  useAuth: () => ({
    isLoaded: mocks.clerk.isLoaded,
    isSignedIn: mocks.clerk.isSignedIn,
    sessionId: mocks.clerk.sessionId,
    getToken: mocks.clerk.getToken
  }),
  useClerk: () => ({ signOut: mocks.clerk.signOut })
}));
vi.mock("../lib/http.js", () => ({ requestJson: mocks.requestJson }));

const { LegacyAuthProvider, ClerkBackedAuthProvider } = await import("./AuthProviderRuntime.jsx");

const pendingUser = {
  id: "pending-member",
  _id: "pending-member",
  tenantId: "greenlane-id",
  tenantSlug: "greenlane",
  email: "recovered@synthetic.invalid",
  roles: ["user"]
};

function confirmationError() {
  const error = new Error("Confirm your age eligibility and accept Terms and Privacy to continue.");
  error.status = 403;
  error.payload = {
    error: {
      code: "ACCOUNT_CONFIRMATION_REQUIRED",
      message: error.message,
      nextRoute: "/t/greenlane/account-confirmation"
    }
  };
  return error;
}

function unauthorizedError() {
  const error = new Error("Missing auth token");
  error.status = 401;
  error.payload = { error: { code: "AUTH_REQUIRED", message: error.message } };
  return error;
}

function AuthProbe({ onContext }) {
  const auth = useAuth();
  useEffect(() => onContext?.(auth), [auth, onContext]);
  return (
    <output aria-label="auth snapshot">{JSON.stringify({
      token: auth.token,
      userId: auth.user?.id || "",
      tenantSlug: auth.user?.tenantSlug || "",
      ready: auth.isReady,
      authenticated: auth.isAuthenticated,
      bootstrapError: auth.bootstrapError
    })}</output>
  );
}

function seedStoredLegacySession() {
  sessionStorage.setItem(STORAGE_KEYS.sessionToken, "legacy-pending-token");
  localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(pendingUser));
  localStorage.setItem(STORAGE_KEYS.legacyUser, JSON.stringify(pendingUser));
  sessionStorage.setItem("pondbridgeTabAuthSession", "1");
}

function snapshot() {
  return JSON.parse(screen.getByLabelText("auth snapshot").textContent || "{}");
}

beforeEach(() => {
  clearAuthStorage();
  clearVolatileAuthToken();
  sessionStorage.clear();
  localStorage.clear();
  window.history.replaceState({}, "", "/t/greenlane/home");
  mocks.requestJson.mockReset();
  mocks.clerk.isLoaded = true;
  mocks.clerk.isSignedIn = true;
  mocks.clerk.sessionId = "clerk-session";
  mocks.clerk.getToken.mockReset().mockResolvedValue("clerk-pending-token");
  mocks.clerk.signOut.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  clearAuthStorage();
  clearVolatileAuthToken();
  sessionStorage.clear();
  localStorage.clear();
});

describe("AuthProviderRuntime confirmation-gated sessions", () => {
  it("keeps a legacy bootstrap session and its route signal on 403 confirmation, including a remount restore", async () => {
    seedStoredLegacySession();
    mocks.requestJson.mockRejectedValue(confirmationError());

    const first = render(
      <LegacyAuthProvider><AuthProbe /></LegacyAuthProvider>
    );
    await waitFor(() => {
      expect(snapshot()).toMatchObject({
        token: "legacy-pending-token",
        userId: "pending-member",
        tenantSlug: "greenlane",
        authenticated: true,
        bootstrapError: expect.stringContaining("ACCOUNT_CONFIRMATION_REQUIRED")
      });
    });
    expect(mocks.requestJson).toHaveBeenCalledWith("/api/auth/session", expect.objectContaining({
      token: "legacy-pending-token",
      headers: { "X-Tenant-Slug": "greenlane" }
    }));

    first.unmount();
    clearVolatileAuthToken();
    const second = render(
      <LegacyAuthProvider><AuthProbe /></LegacyAuthProvider>
    );
    await waitFor(() => {
      expect(snapshot()).toMatchObject({
        token: "legacy-pending-token",
        userId: "pending-member",
        authenticated: true,
        bootstrapError: expect.stringContaining("ACCOUNT_CONFIRMATION_REQUIRED")
      });
    });
    expect(mocks.requestJson).toHaveBeenCalledTimes(2);
    second.unmount();
  });

  it("clears legacy state for an ordinary invalid session instead of treating every 401 as confirmation", async () => {
    seedStoredLegacySession();
    mocks.requestJson.mockRejectedValue(unauthorizedError());

    render(<LegacyAuthProvider><AuthProbe /></LegacyAuthProvider>);
    await waitFor(() => {
      expect(snapshot()).toMatchObject({
        token: "",
        userId: "",
        authenticated: false,
        bootstrapError: ""
      });
    });
    expect(localStorage.getItem(STORAGE_KEYS.user)).toBeNull();
    expect(sessionStorage.getItem(STORAGE_KEYS.sessionToken)).toBeNull();
  });

  it("keeps Clerk state on a non-strict confirmation refresh but rejects strict tenant sync without clearing it", async () => {
    seedStoredLegacySession();
    mocks.requestJson.mockImplementation(async (path) => {
      if (String(path).startsWith("/api/public/tenant-config")) {
        return { accessSettings: { demoAccessEnabled: false } };
      }
      throw confirmationError();
    });
    let auth = null;

    render(<ClerkBackedAuthProvider><AuthProbe onContext={(value) => { auth = value; }} /></ClerkBackedAuthProvider>);
    await waitFor(() => {
      expect(snapshot()).toMatchObject({
        token: "clerk-pending-token",
        userId: "pending-member",
        authenticated: true,
        bootstrapError: expect.stringContaining("ACCOUNT_CONFIRMATION_REQUIRED")
      });
    });

    await expect(auth.refreshSession({ tenantSlug: "greenlane", strictTenantSync: true }))
      .rejects.toMatchObject({ status: 403, payload: { error: { code: "ACCOUNT_CONFIRMATION_REQUIRED" } } });
    expect(snapshot()).toMatchObject({
      token: "clerk-pending-token",
      userId: "pending-member",
      authenticated: true,
      bootstrapError: expect.stringContaining("ACCOUNT_CONFIRMATION_REQUIRED")
    });
  });
});
