import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

const mocks = vi.hoisted(() => ({
  requestJson: vi.fn(),
  refreshSession: vi.fn(),
  logout: vi.fn(),
  getToken: vi.fn(),
  noteTabLoginIntent: vi.fn(),
  clerk: { isLoaded: true, isSignedIn: true },
  tenant: {
    slug: "greenlane",
    loading: false,
    tenant: {
      slug: "greenlane",
      name: "Camp Green Lane",
      accessSettings: { signupMode: "open" },
    },
  },
}));

vi.mock("@clerk/clerk-react", () => ({
  useAuth: () => ({
    isLoaded: mocks.clerk.isLoaded,
    isSignedIn: mocks.clerk.isSignedIn,
    getToken: mocks.getToken,
  }),
  SignUp: () => <form aria-label="Clerk account form" />,
}));

vi.mock("../lib/http.js", () => ({ requestJson: mocks.requestJson }));
vi.mock("../context/AuthContext.jsx", () => ({
  noteTabLoginIntent: mocks.noteTabLoginIntent,
  useAuth: () => ({
    refreshSession: mocks.refreshSession,
    logout: mocks.logout,
    bootstrapError: "",
    clerkLoadTimedOut: false,
    retryBootstrap: vi.fn(),
  }),
}));
vi.mock("../context/TenantContext.jsx", () => ({ useTenant: () => mocks.tenant }));
vi.mock("../lib/authMode.js", () => ({
  clerkConfigError: () => "",
  clerkModeRequested: () => true,
  clerkUiEnabled: () => true,
}));

const { default: TenantAuthCallbackPage } = await import("./TenantAuthCallbackPage.jsx");
const { default: TenantAccessPendingPage } = await import("./TenantAccessPendingPage.jsx");
const { default: ClerkCreateAccountFlow } =
  await import("../cedar/components/ClerkCreateAccountFlow.jsx");

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="current route">{`${location.pathname}${location.search}`}</output>;
}

function renderCallback(entry) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/t/:slug/auth/callback" element={<TenantAuthCallbackPage />} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>
  );
}

function legalRequiredError() {
  const error = new Error("Legal agreement required");
  error.payload = { error: { code: "LEGAL_AGREEMENT_REQUIRED" } };
  return error;
}

beforeEach(() => {
  window.sessionStorage.clear();
  mocks.requestJson.mockReset();
  mocks.refreshSession.mockReset();
  mocks.logout.mockReset();
  mocks.getToken.mockReset().mockResolvedValue("clerk-session-token");
  mocks.clerk.isLoaded = true;
  mocks.clerk.isSignedIn = true;
  mocks.tenant.slug = "greenlane";
  mocks.tenant.loading = false;
  mocks.tenant.tenant = {
    slug: "greenlane",
    name: "Camp Green Lane",
    accessSettings: { signupMode: "open" },
  };
});

describe("signed-in tenant callback", () => {
  it("accepts an email-matched Green Lane invite without a URL token and waits for director approval", async () => {
    mocks.requestJson.mockImplementation(async (url) => {
      if (url === "/api/t/greenlane/access/decision") {
        return { decision: { state: "invited", action: "accept_invite" } };
      }
      if (url === "/api/t/greenlane/access/invite/accept") {
        return { pendingApproval: true };
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    renderCallback("/t/greenlane/auth/callback");

    expect(await screen.findByLabelText("current route")).toHaveTextContent(
      "/t/greenlane/request-access"
    );
    expect(mocks.requestJson).toHaveBeenCalledWith(
      "/api/t/greenlane/access/invite/accept",
      expect.objectContaining({
        method: "POST",
        token: "clerk-session-token",
        body: expect.objectContaining({ inviteToken: "" }),
      })
    );
    expect(
      mocks.requestJson.mock.calls.filter(([url]) => url.endsWith("/access/invite/accept"))
    ).toHaveLength(1);
    expect(mocks.refreshSession).not.toHaveBeenCalled();
  });

  it("surfaces a failed invite acceptance for retry without issuing a duplicate mutation", async () => {
    mocks.requestJson.mockImplementation(async (url) => {
      if (url === "/api/t/greenlane/access/decision") {
        return { decision: { state: "invited", action: "accept_invite" } };
      }
      if (url === "/api/t/greenlane/access/invite/accept") {
        throw new Error("Network connection was interrupted");
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    renderCallback("/t/greenlane/auth/callback");

    expect(await screen.findByRole("heading", { name: "Sign in issue" })).toBeInTheDocument();
    expect(screen.getByText("Network connection was interrupted")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Retry sign-in" })).toHaveAttribute(
      "href",
      "/t/greenlane/login"
    );
    await waitFor(() => {
      expect(
        mocks.requestJson.mock.calls.filter(([url]) => url.endsWith("/access/invite/accept"))
      ).toHaveLength(1);
    });
  });

  it("returns a missing legal agreement to consent while preserving the intended route", async () => {
    mocks.requestJson.mockImplementation(async (url) => {
      if (url === "/api/t/greenlane/access/decision") {
        return { decision: { state: "invited", action: "accept_invite" } };
      }
      if (url === "/api/t/greenlane/access/invite/accept") throw legalRequiredError();
      throw new Error(`Unexpected request: ${url}`);
    });

    renderCallback("/t/greenlane/auth/callback?returnTo=%2Ft%2Fgreenlane%2Fhome");

    const route = await screen.findByLabelText("current route");
    expect(route).toHaveTextContent("/t/greenlane/create-account?");
    expect(route).toHaveTextContent("returnTo=%2Ft%2Fgreenlane%2Fhome");
    expect(route).toHaveTextContent("legalRequired=1");
  });

  it("persists real consent for a recovered pending request before showing the waiting page", async () => {
    window.sessionStorage.setItem(
      "pondbridgeLegalAgreement:greenlane",
      JSON.stringify({
        accepted: true,
        acceptedAt: "2026-09-08T20:00:00.000Z",
        termsVersion: "2026-03-04",
        privacyVersion: "2026-03-04",
        ageEligibilityConfirmed: true,
        minimumAge: 14,
        agePolicyVersion: "2026-07-14",
      })
    );
    mocks.requestJson.mockImplementation(async (url) => {
      if (url === "/api/t/greenlane/access/decision") {
        return {
          decision: {
            state: "access_pending",
            action: "wait_for_approval",
            request: { id: "request-1", requiresConsent: true },
          },
        };
      }
      if (url === "/api/t/greenlane/access/request-access") return { ok: true };
      throw new Error(`Unexpected request: ${url}`);
    });

    renderCallback("/t/greenlane/auth/callback");

    expect(await screen.findByLabelText("current route")).toHaveTextContent(
      "/t/greenlane/request-access"
    );
    expect(mocks.requestJson).toHaveBeenCalledWith(
      "/api/t/greenlane/access/request-access",
      expect.objectContaining({
        method: "POST",
        token: "clerk-session-token",
        body: {
          legalAgreement: expect.objectContaining({
            accepted: true,
            ageEligibilityConfirmed: true,
            acceptedAt: "2026-09-08T20:00:00.000Z",
          }),
        },
      })
    );
  });

  it("sends a recovered pending request without consent to the legal agreement", async () => {
    mocks.requestJson.mockResolvedValue({
      decision: {
        state: "access_pending",
        action: "wait_for_approval",
        request: { id: "request-1", requiresConsent: true },
      },
    });

    renderCallback("/t/greenlane/auth/callback");

    expect(await screen.findByLabelText("current route")).toHaveTextContent(
      "/t/greenlane/create-account?legalRequired=1"
    );
    expect(
      mocks.requestJson.mock.calls.some(([url]) => url.endsWith("/access/request-access"))
    ).toBe(false);
  });

  it("activates a director-approved request after real consent and continues into the network", async () => {
    window.sessionStorage.setItem("pondbridgeLegalAgreement:greenlane", JSON.stringify({
      accepted: true, ageEligibilityConfirmed: true, acceptedAt: "2026-09-08T22:00:00.000Z"
    }));
    let completed = false;
    mocks.requestJson.mockImplementation(async (url) => {
      if (url === "/api/t/greenlane/access/decision") {
        return completed
          ? { decision: { state: "active_member", action: "go_home", nextRoute: "/t/greenlane/home" } }
          : { decision: { state: "access_pending", action: "wait_for_approval", request: { requiresConsent: true, directorApproved: true } } };
      }
      if (url === "/api/t/greenlane/access/request-access") {
        completed = true;
        return { ok: true, pendingApproval: false };
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    mocks.refreshSession.mockResolvedValue({ user: { id: "activated-member" } });
    renderCallback("/t/greenlane/auth/callback");
    expect(await screen.findByLabelText("current route")).toHaveTextContent("/t/greenlane/home");
    expect(mocks.refreshSession).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem("pondbridgeLegalAgreement:greenlane")).toBeNull();
  });

  it("shows a saved director approval with a working confirmation action on the waiting page", async () => {
    mocks.requestJson.mockResolvedValue({ decision: {
      state: "access_pending", action: "wait_for_approval", request: { requiresConsent: true, directorApproved: true }
    } });
    render(<MemoryRouter initialEntries={["/t/greenlane/request-access"]}>
      <Routes><Route path="/t/:slug/request-access" element={<TenantAccessPendingPage />} />
        <Route path="*" element={<LocationProbe />} /></Routes>
    </MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Approved — finish your account setup" })).toBeInTheDocument();
    expect(screen.queryByText(/Nothing else to do on your end/)).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("link", { name: "Finish account confirmation" }));
    expect(await screen.findByLabelText("current route")).toHaveTextContent("/t/greenlane/create-account?legalRequired=1");
  });

  it("keeps Cedar's gate-off invite flow out of the approval queue", async () => {
    let decisionRead = 0;
    mocks.requestJson.mockImplementation(async (url) => {
      if (url === "/api/t/cedar/access/decision") {
        decisionRead += 1;
        return decisionRead === 1
          ? { decision: { state: "invited", action: "accept_invite" } }
          : {
              decision: {
                state: "active_member",
                action: "go_home",
                nextRoute: "/t/cedar/home",
              },
            };
      }
      if (url === "/api/t/cedar/access/invite/accept") return { pendingApproval: false };
      throw new Error(`Unexpected request: ${url}`);
    });
    mocks.refreshSession.mockResolvedValue({ user: { id: "cedar-member" } });

    renderCallback("/t/cedar/auth/callback");

    expect(await screen.findByLabelText("current route")).toHaveTextContent("/t/cedar/home");
    expect(screen.getByLabelText("current route")).not.toHaveTextContent("request-access");
    expect(mocks.refreshSession).toHaveBeenCalledTimes(1);
  });
});

describe("signed-in legal agreement recovery", () => {
  it("lets an already signed-in person accept the agreement before returning to callback", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter
        initialEntries={[
          "/t/greenlane/create-account?legalRequired=1&returnTo=%2Ft%2Fgreenlane%2Fhome",
        ]}
      >
        <Routes>
          <Route path="/t/:slug/create-account" element={<ClerkCreateAccountFlow />} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    );

    const agreement = await screen.findByRole("checkbox");
    expect(screen.getByRole("heading", { name: "Create Account" })).toBeInTheDocument();
    expect(screen.getByText(/Agree to the Terms of Service/)).toBeInTheDocument();
    const continueButton = screen.getByRole("button", { name: "Continue to director review" });
    expect(continueButton).toBeDisabled();

    await user.click(agreement);
    expect(
      screen.queryByText(/Agree to the Terms of Service and Privacy Policy/)
    ).not.toBeInTheDocument();
    expect(continueButton).toBeEnabled();
    await user.click(continueButton);

    expect(await screen.findByLabelText("current route")).toHaveTextContent(
      "/t/greenlane/auth/callback?returnTo=%2Ft%2Fgreenlane%2Fhome"
    );
    expect(window.sessionStorage.getItem("pondbridgeLegalAgreement:greenlane")).toContain(
      '"accepted":true'
    );
  });
});
