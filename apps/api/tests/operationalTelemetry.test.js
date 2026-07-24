import {
  buildModuleAdoption,
  buildResendDeliveryTelemetry
} from "../src/services/operationalTelemetry.js";

describe("operational telemetry", () => {
  test("does not invent module adoption for uninstrumented modules", () => {
    const tenants = [
      { _id: "camp-a", modules: { directory: true, chat: true } },
      { _id: "camp-b", modules: { directory: true, chat: true } }
    ];
    const analyticsEvents = [
      { tenantId: "camp-a", eventType: "directory_search" }
    ];

    const adoption = buildModuleAdoption({ tenants, analyticsEvents });
    const directory = adoption.find((row) => row.moduleKey === "directory");
    const chat = adoption.find((row) => row.moduleKey === "chat");

    expect(directory).toMatchObject({
      enabledTenants: 2,
      activelyUsedTenants: 1,
      adoptionPercent: 50,
      measurementStatus: "measured"
    });
    expect(chat).toMatchObject({
      enabledTenants: 2,
      activelyUsedTenants: null,
      adoptionPercent: null,
      measurementStatus: "not_instrumented"
    });
  });

  test("builds delivery health from the latest Resend event without exposing addresses", () => {
    const events = [
      {
        _id: "evt-sent",
        eventType: "email.sent",
        emailId: "email-1",
        recipientEmail: "member@example.com",
        tenantId: "camp-a",
        occurredAt: "2026-07-13T12:00:00.000Z",
        payload: { data: { tags: [{ name: "category", value: "invite" }] } }
      },
      {
        _id: "evt-delivered",
        eventType: "email.delivered",
        emailId: "email-1",
        recipientEmail: "member@example.com",
        tenantId: "camp-a",
        occurredAt: "2026-07-13T12:01:00.000Z",
        payload: { data: { tags: [{ name: "category", value: "invite" }] } }
      }
    ];

    const result = buildResendDeliveryTelemetry({
      events,
      tenants: [{ _id: "camp-a", slug: "camp-a", name: "Camp A" }],
      now: new Date("2026-07-14T12:00:00.000Z")
    });

    expect(result.source).toBe("resend_webhooks");
    expect(result.stats).toMatchObject({ totalSent: 1, deliveryRate: 100, bounceRate: 0 });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      tenantName: "Camp A",
      emailType: "invite",
      recipientDomain: "example.com",
      status: "delivered",
      canRetry: false
    });
    expect(JSON.stringify(result)).not.toContain("member@example.com");
  });

  test("reports unavailable telemetry when no provider events exist", () => {
    const result = buildResendDeliveryTelemetry({
      events: [],
      tenants: [],
      now: new Date("2026-07-14T12:00:00.000Z")
    });

    expect(result.telemetryAvailable).toBe(false);
    expect(result.stats.deliveryRate).toBeNull();
    expect(result.stats.bounceRate).toBeNull();
    expect(result.rows).toEqual([]);
  });
});
