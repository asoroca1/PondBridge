import {
  normalizeTenantMobileNotificationPrefs,
  normalizeUserMobileNotificationPreferences,
  tenantAllowsAutomaticMobileNotification
} from "../src/services/mobileNotifications.js";

describe("mobile notification controls", () => {
  test("keeps backward-compatible defaults while honoring explicit tenant switches", () => {
    expect(normalizeTenantMobileNotificationPrefs({}).mobileEnabled).toBe(true);
    expect(normalizeTenantMobileNotificationPrefs({ pushEnabled: false }).pushEnabled).toBe(false);
    expect(normalizeUserMobileNotificationPreferences({ categories: { events: false } })).toMatchObject({
      pushEnabled: true,
      categories: { announcements: true, events: false, community: true, account: true, admin: true }
    });
  });

  test("applies each director-controlled automatic trigger", () => {
    expect(tenantAllowsAutomaticMobileNotification({ approvalRequests: false }, "approval_request_submitted")).toBe(false);
    expect(tenantAllowsAutomaticMobileNotification({ newMemberJoined: false }, "member_joined")).toBe(false);
    expect(tenantAllowsAutomaticMobileNotification({ memberFlagged: false }, "content_report_created")).toBe(false);
    expect(tenantAllowsAutomaticMobileNotification({ memberFlagged: false }, "member_flagged")).toBe(false);
    expect(tenantAllowsAutomaticMobileNotification({ memberFlagged: true }, "member_flagged")).toBe(true);
  });

  test("the camp-level mobile kill switch stops every automatic kind", () => {
    expect(tenantAllowsAutomaticMobileNotification({ mobileEnabled: false }, "member_joined")).toBe(false);
    expect(tenantAllowsAutomaticMobileNotification({ mobileEnabled: false }, "content_report_created")).toBe(false);
    expect(tenantAllowsAutomaticMobileNotification({ mobileEnabled: false }, "future_kind")).toBe(false);
  });
});
