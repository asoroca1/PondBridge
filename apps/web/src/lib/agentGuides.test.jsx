import { describe, expect, it } from "vitest";
import { buildDirectorGuidedAnswer } from "../pages/DirectorOnboardingAgentPage.jsx";
import {
  buildMemberGuideAnswer,
  buildSuggestionAnswer,
  memberDiscoveryIntent
} from "../pages/MemberCampAiPage.jsx";
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

  it("turns the live dashboard snapshot into a measured daily brief", () => {
    const answer = buildDirectorGuidedAnswer({
      question: "What should I prioritize today?",
      payload: {
        ...onboardingPayload,
        tenant: { ...onboardingPayload.tenant, onboardingStatus: "live" }
      },
      billing: {},
      dashboard: {
        stats: {
          totalMembers: 218,
          newThisWeek: 7,
          profileCompletion: 74,
          pendingApprovals: 3,
          openSafetyReports: 1
        },
        actionQueue: [
          {
            title: "1 community safety report waiting",
            actionLabel: "Review reports",
            href: "/t/pine/admin/safety"
          }
        ]
      },
      slug: "pine"
    });

    expect(answer.content).toContain("218 active members");
    expect(answer.content).toContain("7 new members");
    expect(answer.content).toContain("74% complete");
    expect(answer.content).toContain("1 open safety report");
    expect(answer.links[0]).toEqual({
      label: "Review reports",
      href: "/t/pine/admin/safety"
    });
  });
});

describe("member camp AI guided mode", () => {
  const tenant = {
    name: "Camp Cedar",
    config: {
      modules: {
        chat: true,
        events: true,
        photoStream: true,
        map: true,
        familyTrees: true,
        newsletter: true
      },
      content: { newsletterName: "Cedar Chest" }
    }
  };

  it("routes a member to camp-scoped messaging without taking an action", () => {
    expect(
      buildMemberGuideAnswer({
        question: "How do I message someone?",
        slug: "cedar",
        tenant
      })
    ).toEqual({
      content: "Open Messages to continue an existing conversation, start a direct message, or join a camp forum.",
      links: [{ label: "Open Messages", href: "/t/cedar/chat-rooms?tab=personal" }]
    });
  });

  it("honors disabled member modules", () => {
    const answer = buildMemberGuideAnswer({
      question: "Show me upcoming events",
      slug: "cedar",
      tenant: {
        ...tenant,
        config: { ...tenant.config, modules: { ...tenant.config.modules, events: false } }
      }
    });

    expect(answer.content).toContain("not currently enabled");
    expect(answer.links).toEqual([]);
  });

  it("recognizes personalized and recent-member discovery requests", () => {
    expect(memberDiscoveryIntent("Who should I reconnect with?")).toBe("personalized");
    expect(memberDiscoveryIntent("Who joined recently?")).toBe("recent");
    expect(memberDiscoveryIntent("Show me upcoming events")).toBe("");
  });

  it("renders camp-scoped suggestions with safe context and profile links", () => {
    const answer = buildSuggestionAnswer({
      slug: "cedar",
      data: {
        mode: "personalized",
        items: [
          {
            id: "member-1",
            firstName: "Jamie",
            lastName: "Campbell",
            recommendation: {
              kind: "shared_profile",
              label: "Shared profile signals"
            }
          }
        ]
      }
    });

    expect(answer.content).toContain("reconnection suggestions");
    expect(answer.links).toEqual([
      {
        label: "Jamie Campbell · Shared profile signals",
        href: "/t/cedar/profile/member-1"
      }
    ]);
    expect(answer.disclaimer).toContain("excluded blocked connections");
    expect(answer.disclaimer).toContain("No member records were sent");
  });

  it("labels fallback reconnection results truthfully when no shared signal exists", () => {
    const answer = buildSuggestionAnswer({
      slug: "cedar",
      data: {
        mode: "personalized",
        items: [
          {
            id: "member-2",
            firstName: "Alex",
            lastName: "Rivera",
            recommendation: { kind: "recent_member", label: "Recently joined" }
          }
        ]
      }
    });

    expect(answer.content).toContain("couldn’t find strong shared profile signals");
    expect(answer.content).toContain("newest active members");
    expect(answer.content).not.toContain("ranked from shared profile signals");
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
