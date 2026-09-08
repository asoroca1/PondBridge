import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import {
  AGE_POLICY_VERSION,
  LEGAL_PRIVACY_VERSION,
  LEGAL_TERMS_VERSION,
  MINIMUM_MEMBER_AGE
} from "../lib/legalAgreement.js";

const mocks = vi.hoisted(() => ({
  requestJson: vi.fn(),
  getToken: vi.fn(),
  refreshSession: vi.fn(),
  logout: vi.fn(),
  clerk: { isLoaded: true, isSignedIn: true },
  tenant: { slug: "greenlane", tenant: { name: "Camp Green Lane" } }
}));

vi.mock("@clerk/clerk-react", () => ({
  useAuth: () => ({
    isLoaded: mocks.clerk.isLoaded,
    isSignedIn: mocks.clerk.isSignedIn,
    getToken: mocks.getToken
  })
}));
vi.mock("../lib/http.js", () => ({ requestJson: mocks.requestJson }));
vi.mock("../context/AuthContext.jsx", () => ({
  useAuth: () => ({ logout: mocks.logout, refreshSession: mocks.refreshSession })
}));
vi.mock("../context/TenantContext.jsx", () => ({ useTenant: () => mocks.tenant }));

const { default: TenantAccountConfirmationPage } = await import("./TenantAccountConfirmationPage.jsx");

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="current route">{`${location.pathname}${location.search}`}</output>;
}

function renderPage(entry = "/t/greenlane/account-confirmation") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/t/:slug/account-confirmation" element={<TenantAccountConfirmationPage />} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>
  );
}

function confirmationDecision() {
  return {
    decision: {
      state: "account_confirmation_required",
      action: "confirm_account",
      nextRoute: "/t/greenlane/account-confirmation",
      confirmation: { required: true, requestId: "request-safe-id" }
    }
  };
}

beforeEach(() => {
  mocks.requestJson.mockReset();
  mocks.getToken.mockReset().mockResolvedValue("clerk-token");
  mocks.refreshSession.mockReset().mockResolvedValue({ user: { id: "member-id" } });
  mocks.logout.mockReset().mockResolvedValue(undefined);
  mocks.clerk.isLoaded = true;
  mocks.clerk.isSignedIn = true;
  mocks.tenant = { slug: "greenlane", tenant: { name: "Camp Green Lane" } };
});

describe("counted member account confirmation", () => {
  it("records a fresh explicit agreement and returns an approved member to their deep link", async () => {
    mocks.requestJson
      .mockResolvedValueOnce(confirmationDecision())
      .mockResolvedValueOnce({
        ok: true,
        confirmed: true,
        decision: { state: "active_member", nextRoute: "/t/greenlane/home" }
      });

    renderPage("/t/greenlane/account-confirmation?returnTo=%2Ft%2Fgreenlane%2Fevents%2Ffall-reunion");

    expect(await screen.findByRole("button", { name: "Confirm and enter" })).toBeEnabled();
    expect(screen.getByText(/I confirm that I am at least 14/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Terms of Service" })).toHaveAttribute("href", "/t/greenlane/legal#terms");
    expect(screen.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/t/greenlane/legal#privacy");

    await userEvent.click(screen.getByRole("button", { name: "Confirm and enter" }));

    expect(await screen.findByLabelText("current route")).toHaveTextContent(
      "/t/greenlane/events/fall-reunion"
    );
    const mutation = mocks.requestJson.mock.calls.find(([url]) => url.endsWith("/access/confirm-account"));
    expect(mutation).toBeTruthy();
    expect(mutation[1]).toMatchObject({ method: "POST", token: "clerk-token" });
    expect(mutation[1].body.legalAgreement).toMatchObject({
      accepted: true,
      ageEligibilityConfirmed: true,
      termsVersion: LEGAL_TERMS_VERSION,
      privacyVersion: LEGAL_PRIVACY_VERSION,
      minimumAge: MINIMUM_MEMBER_AGE,
      agePolicyVersion: AGE_POLICY_VERSION
    });
    expect(Number.isNaN(Date.parse(mutation[1].body.legalAgreement.acceptedAt))).toBe(false);
    expect(mocks.refreshSession).toHaveBeenCalledWith({ tenantSlug: "greenlane", strictTenantSync: true });
  });

  it("surfaces a failed save and retries only after another explicit click", async () => {
    mocks.requestJson
      .mockResolvedValueOnce(confirmationDecision())
      .mockRejectedValueOnce(new Error("Confirmation could not be saved"))
      .mockResolvedValueOnce({ confirmed: true, decision: { state: "active_member", nextRoute: "/t/greenlane/home" } });

    renderPage();
    const button = await screen.findByRole("button", { name: "Confirm and enter" });
    await userEvent.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent("Confirmation could not be saved");
    expect(mocks.requestJson.mock.calls.filter(([url]) => url.endsWith("/access/confirm-account"))).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: "Confirm and enter" }));
    expect(await screen.findByLabelText("current route")).toHaveTextContent("/t/greenlane/home");
    expect(mocks.requestJson.mock.calls.filter(([url]) => url.endsWith("/access/confirm-account"))).toHaveLength(2);
  });

  it("does not ask again after confirmation was already completed", async () => {
    mocks.requestJson.mockResolvedValueOnce({
      decision: { state: "active_member", action: "open_home", nextRoute: "/t/greenlane/home" }
    });

    renderPage("/t/greenlane/account-confirmation?returnTo=%2Ft%2Fgreenlane%2Fmy-profile");

    expect(await screen.findByLabelText("current route")).toHaveTextContent("/t/greenlane/my-profile");
    expect(mocks.requestJson.mock.calls.filter(([url]) => url.endsWith("/access/confirm-account"))).toHaveLength(0);
  });

  it("returns a fresh signup to the normal callback without creating an exception", async () => {
    mocks.requestJson.mockResolvedValueOnce({
      decision: { state: "not_member", action: "join_network", nextRoute: "/t/greenlane/home" }
    });

    renderPage("/t/greenlane/account-confirmation?returnTo=%2Ft%2Fgreenlane%2Fevents");

    expect(await screen.findByLabelText("current route")).toHaveTextContent(
      "/t/greenlane/auth/callback?returnTo=%2Ft%2Fgreenlane%2Fevents"
    );
    expect(mocks.requestJson).toHaveBeenCalledTimes(1);
  });

  it("leaves a Cedar active member on Cedar's ordinary route", async () => {
    mocks.tenant = { slug: "cedar", tenant: { name: "Camp Cedar" } };
    mocks.requestJson.mockResolvedValueOnce({
      decision: { state: "active_member", action: "open_home", nextRoute: "/t/cedar/home" }
    });

    renderPage("/t/cedar/account-confirmation");

    expect(await screen.findByLabelText("current route")).toHaveTextContent("/t/cedar/home");
    expect(mocks.requestJson.mock.calls.filter(([url]) => url.endsWith("/access/confirm-account"))).toHaveLength(0);
  });

  it("does not mutate when the signed-in identity belongs to another account", async () => {
    const mismatch = new Error("Identity mismatch");
    mismatch.payload = { error: { code: "ACCOUNT_CONFIRMATION_IDENTITY_MISMATCH" } };
    mocks.requestJson.mockRejectedValueOnce(mismatch);

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("does not match the account waiting");
    expect(mocks.requestJson.mock.calls.filter(([url]) => url.endsWith("/access/confirm-account"))).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(mocks.logout).toHaveBeenCalledTimes(1);
    expect(await screen.findByLabelText("current route")).toHaveTextContent("/t/greenlane/login");
  });
});
