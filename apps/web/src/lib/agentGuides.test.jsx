import { describe, expect, it } from "vitest";
import { buildDirectorGuidedAnswer } from "../pages/DirectorOnboardingAgentPage.jsx";
import { buildSuperGuidedAnswer } from "../pages/super/SuperOperationsAgentPage.jsx";

const onboardingPayload = {
  tenant: { name: "Camp Pine", onboardingStatus: "setup" },
  readiness: {
    checks: [
      { id: "headline", label: "Network message configured", ok: true },
      { id: "signup", label: "Signup policy selected", ok: false },
      { id: "billing", label: "Billing ready", ok: false }
    ]
  }
};

describe("director onboarding guided mode", () => {
  it("turns server readiness into a next step with a tenant-scoped evidence link", () => {
    const answer = buildDirectorGuidedAnswer({
      question: "What should I do next?",
      payload: onboardingPayload,
      billing: {},
      slug: "pine"
    });

    expect(answer.content).toContain("1 of 3");
    expect(answer.content).toContain("Signup policy selected");
    expect(answer.links).toEqual([
      { label: "Choose access policy", href: "/t/pine/admin/settings/access" }
    ]);
  });

  it("produces an editable welcome draft without claiming to publish it", () => {
    const answer = buildDirectorGuidedAnswer({
      question: "Draft a welcome announcement",
      payload: onboardingPayload,
      billing: {},
      slug: "pine"
    });

    expect(answer.content).toContain("Editable starting point");
    expect(answer.content).toContain("Camp Pine");
    expect(answer.links[0].href).toBe("/t/pine/admin/settings/network");
  });

  it("routes live participation questions into the alumni growth operating center", () => {
    const answer = buildDirectorGuidedAnswer({
      question: "How can I grow alumni participation?",
      payload: {
        ...onboardingPayload,
        tenant: { ...onboardingPayload.tenant, onboardingStatus: "live" }
      },
      billing: {},
      slug: "pine"
    });

    expect(answer.content).toContain("Alumni Growth");
    expect(answer.links[0]).toEqual({
      label: "Open Alumni Growth",
      href: "/t/pine/admin/growth"
    });
  });
});

describe("super operations guided mode", () => {
  it("keeps finance answers inside billing evidence", () => {
    const answer = buildSuperGuidedAnswer({
      question: "What billing items need attention?",
      role: "finance_admin",
      operationalData: {
        trendAvailable: false,
        stats: { mrr: 12500, failedPayments: 2 }
      }
    });

    expect(answer.content).toContain("$12,500");
    expect(answer.content).toContain("not a Stripe revenue ledger");
    expect(answer.links.map((item) => item.href)).toEqual([
      "/super/billing/tenants",
      "/super/billing/failed"
    ]);
  });

  it("does not expose email telemetry to the finance role", () => {
    const answer = buildSuperGuidedAnswer({
      question: "Show me email delivery health",
      role: "finance_admin",
      operationalData: { stats: {} }
    });

    expect(answer.content).toContain("outside the finance role");
    expect(answer.links).toEqual([
      { label: "Return to tenant billing", href: "/super/billing/tenants" }
    ]);
  });

  it("turns platform alerts into read-only evidence links", () => {
    const answer = buildSuperGuidedAnswer({
      question: "What needs attention?",
      role: "support_admin",
      operationalData: {
        stats: {},
        alerts: [
          { id: "billing", message: "Two camps are past due", href: "/super/billing/failed" }
        ]
      }
    });

    expect(answer.content).toContain("Two camps are past due");
    expect(answer.links[0].href).toBe("/super/billing/failed");
  });

  it("routes camp creation to the reviewed setup control for super admins", () => {
    const answer = buildSuperGuidedAnswer({
      question: "Help me add a new camp",
      role: "super_admin",
      operationalData: { stats: {} }
    });

    expect(answer.content).toContain("reviewed Add a camp form");
    expect(answer.links).toEqual([
      { label: "Start reviewed camp setup", href: "/super/tenants/create" }
    ]);
  });

  it("does not expose super-admin provisioning to support staff", () => {
    const answer = buildSuperGuidedAnswer({
      question: "Create a camp",
      role: "support_admin",
      operationalData: { stats: {} }
    });

    expect(answer.content).toContain("requires the super-admin role");
    expect(answer.links[0].href).toBe("/super/tenants");
  });
});
