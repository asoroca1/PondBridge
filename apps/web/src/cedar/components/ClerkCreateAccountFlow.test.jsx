import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  AGE_POLICY_VERSION,
  LEGAL_AGREEMENT_VERSION,
  LEGAL_PRIVACY_VERSION,
  LEGAL_TERMS_VERSION,
  MINIMUM_MEMBER_AGE
} from "../../lib/legalAgreement.js";

const mocks = vi.hoisted(() => ({
  signUpProps: null,
  requestJson: vi.fn(),
  navigate: vi.fn(),
  tenant: {
    slug: "greenlane",
    loading: false,
    tenant: { slug: "greenlane", name: "Camp Green Lane", accessSettings: { signupMode: "open" } }
  },
  clerk: { isLoaded: true, isSignedIn: false }
}));

vi.mock("@clerk/clerk-react", () => ({
  useAuth: () => ({
    isLoaded: mocks.clerk.isLoaded,
    isSignedIn: mocks.clerk.isSignedIn,
    getToken: vi.fn()
  }),
  SignUp: (props) => {
    mocks.signUpProps = props;
    return <form aria-label="Clerk account form" />;
  }
}));
vi.mock("../../lib/http.js", () => ({ requestJson: mocks.requestJson }));
vi.mock("../../context/AuthContext.jsx", () => ({
  noteTabLoginIntent: vi.fn(),
  useAuth: () => ({
    bootstrapError: "",
    clerkLoadTimedOut: false,
    retryBootstrap: vi.fn(),
    logout: vi.fn()
  })
}));
vi.mock("../../context/TenantContext.jsx", () => ({ useTenant: () => mocks.tenant }));
vi.mock("../../lib/tenantRouting.js", () => ({ tenantRoute: (slug, path) => `/t/${slug}${path}` }));
vi.mock("../../lib/campLabels.js", () => ({ resolveNetworkDisplayName: (tenant) => tenant?.name || "your camp" }));
vi.mock("../../lib/nativeApp.js", () => ({ isNativeApp: () => false }));
vi.mock("../../lib/pendingAccessGrant.js", () => ({
  readPendingAccessGrant: () => null,
  storePendingAccessGrant: vi.fn()
}));

const { default: ClerkCreateAccountFlow } = await import("./ClerkCreateAccountFlow.jsx");

function renderFlow() {
  return render(
    <MemoryRouter initialEntries={["/t/greenlane/create-account"]}>
      <Routes>
        <Route path="/t/:slug/create-account" element={<ClerkCreateAccountFlow />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  window.sessionStorage.clear();
  mocks.signUpProps = null;
  mocks.requestJson.mockReset();
  mocks.navigate.mockReset();
  mocks.clerk.isLoaded = true;
  mocks.clerk.isSignedIn = false;
});

describe("Clerk member consent capture", () => {
  it("does not send accepted metadata while the checkbox is unchecked", () => {
    renderFlow();

    expect(mocks.signUpProps.unsafeMetadata).toEqual({
      tenantSlug: "greenlane",
      signupAudience: "member"
    });
    expect(mocks.signUpProps.unsafeMetadata.signupLegalAgreement).toBeUndefined();
  });

  it("persists one explicit agreement in Clerk metadata with tenant context", async () => {
    const user = userEvent.setup();
    renderFlow();
    const checkbox = screen.getByRole("checkbox");

    await user.click(checkbox);

    const metadata = mocks.signUpProps.unsafeMetadata;
    expect(metadata).toMatchObject({
      tenantSlug: "greenlane",
      signupAudience: "member",
      signupLegalAgreement: {
        version: LEGAL_AGREEMENT_VERSION,
        accepted: true,
        termsVersion: LEGAL_TERMS_VERSION,
        privacyVersion: LEGAL_PRIVACY_VERSION,
        agePolicyVersion: AGE_POLICY_VERSION,
        minimumAge: MINIMUM_MEMBER_AGE,
        ageEligibilityConfirmed: true,
        acceptedAt: expect.any(String)
      }
    });
    expect(window.sessionStorage.getItem("pondbridgeLegalAgreement:greenlane")).toContain(
      `"acceptedAt":"${metadata.signupLegalAgreement.acceptedAt}"`
    );
  });

  it("keeps the accepted metadata object and timestamp stable across rerenders", async () => {
    const user = userEvent.setup();
    const view = renderFlow();

    await user.click(screen.getByRole("checkbox"));
    const firstContext = mocks.signUpProps.unsafeMetadata;
    const firstAgreement = firstContext.signupLegalAgreement;

    view.rerender(
      <MemoryRouter initialEntries={["/t/greenlane/create-account"]}>
        <Routes>
          <Route path="/t/:slug/create-account" element={<ClerkCreateAccountFlow />} />
        </Routes>
      </MemoryRouter>
    );

    expect(mocks.signUpProps.unsafeMetadata).toBe(firstContext);
    expect(mocks.signUpProps.unsafeMetadata.signupLegalAgreement).toBe(firstAgreement);
    expect(mocks.signUpProps.unsafeMetadata.signupLegalAgreement.acceptedAt).toBe(
      firstAgreement.acceptedAt
    );
  });

  it("removes both pending storage and Clerk metadata when unchecked", async () => {
    const user = userEvent.setup();
    renderFlow();
    const checkbox = screen.getByRole("checkbox");

    await user.click(checkbox);
    await user.click(checkbox);

    expect(window.sessionStorage.getItem("pondbridgeLegalAgreement:greenlane")).toBeNull();
    expect(mocks.signUpProps.unsafeMetadata).toEqual({
      tenantSlug: "greenlane",
      signupAudience: "member"
    });
    expect(mocks.signUpProps.unsafeMetadata.signupLegalAgreement).toBeUndefined();
  });

  it("recovers a pending agreement without changing its original timestamp", () => {
    const acceptedAt = "2026-09-08T20:00:00.000Z";
    window.sessionStorage.setItem(
      "pondbridgeLegalAgreement:greenlane",
      JSON.stringify({
        version: LEGAL_AGREEMENT_VERSION,
        accepted: true,
        acceptedAt,
        termsVersion: LEGAL_TERMS_VERSION,
        privacyVersion: LEGAL_PRIVACY_VERSION,
        agePolicyVersion: AGE_POLICY_VERSION,
        minimumAge: MINIMUM_MEMBER_AGE,
        ageEligibilityConfirmed: true
      })
    );

    renderFlow();

    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(mocks.signUpProps.unsafeMetadata.signupLegalAgreement.acceptedAt).toBe(acceptedAt);
  });
});
