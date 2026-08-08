import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertSeminarJoinEligibility,
  buildEventEmailContent,
  inferMeetingProvider,
  normalizeEventWritePayload,
  normalizeSeminarMeetingUrl,
  serializeEvent,
  validateEventPublishReadiness
} from "../src/services/events.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function seminar(overrides = {}) {
  return {
    id: "event-1",
    status: "published",
    eventType: "seminar",
    deliveryMode: "online",
    title: "Inside Investment Banking",
    topicCategory: "career",
    topicTitle: "Investment Banking",
    audience: "career_explorers",
    meetingProvider: "zoom",
    hostProfileId: "profile-host",
    startsAt: new Date(Date.now() + 60 * 60 * 1000),
    ...overrides
  };
}

describe("registered-member seminar events", () => {
  test.each([
    ["https://us02web.zoom.us/j/123", "zoom"],
    ["https://teams.microsoft.com/l/meetup-join/abc", "microsoft_teams"],
    ["https://meet.google.com/abc-defg-hij", "google_meet"],
    ["https://video.example.org/room/123", "other"]
  ])("detects meeting provider for %s", (url, provider) => {
    expect(inferMeetingProvider(url)).toBe(provider);
  });

  test("requires secure provider-matched seminar links", () => {
    expect(normalizeSeminarMeetingUrl("https://zoom.us/j/123", "zoom")).toBe(
      "https://zoom.us/j/123"
    );
    expect(() => normalizeSeminarMeetingUrl("http://zoom.us/j/123", "zoom")).toThrow(
      expect.objectContaining({ code: "SEMINAR_MEETING_URL_INVALID" })
    );
    expect(() =>
      normalizeSeminarMeetingUrl("https://teams.microsoft.com/l/meetup-join/abc", "zoom")
    ).toThrow(expect.objectContaining({ code: "SEMINAR_MEETING_PROVIDER_MISMATCH" }));
  });

  test("normalizes seminar metadata and bounded capacity", () => {
    const result = normalizeEventWritePayload({
      eventType: "seminar",
      deliveryMode: "online",
      topicCategory: "career",
      topicTitle: "  Investment Banking  ",
      audience: "career_explorers",
      meetingUrl: "https://zoom.us/j/123",
      hostProfileId: "profile-host",
      capacity: "75",
      title: "Career seminar",
      startsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    });

    expect(result).toMatchObject({
      eventType: "seminar",
      deliveryMode: "online",
      topicCategory: "career",
      topicTitle: "Investment Banking",
      audience: "career_explorers",
      meetingProvider: "zoom",
      hostProfileId: "profile-host",
      capacity: 75
    });
  });

  test("blocks incomplete seminars from publishing", () => {
    expect(() =>
      validateEventPublishReadiness(seminar({ hostProfileId: "" }), {
        meetingUrl: "https://zoom.us/j/123"
      })
    ).toThrow(expect.objectContaining({ code: "SEMINAR_HOST_REQUIRED" }));

    expect(() =>
      validateEventPublishReadiness(seminar(), { meetingUrl: "" })
    ).toThrow(expect.objectContaining({ code: "SEMINAR_MEETING_URL_REQUIRED" }));

    expect(
      validateEventPublishReadiness(seminar(), {
        meetingUrl: "https://zoom.us/j/123"
      })
    ).toEqual({ ready: true });
  });

  test("never includes a private meeting URL in member serialization", () => {
    const memberPayload = serializeEvent(seminar({ meetingUrl: "https://zoom.us/j/private" }), {
      viewerProfileId: "member-profile",
      myRsvp: { status: "attending", respondedAt: new Date() }
    });
    expect(memberPayload.meetingUrl).toBeUndefined();
    expect(memberPayload.meetingAccess).toMatchObject({
      requiresRegistration: true,
      requiresAttendingRsvp: true,
      canRequestJoinLink: true
    });

    const adminPayload = serializeEvent(seminar(), {
      includePrivateMeeting: true,
      meetingUrl: "https://zoom.us/j/private"
    });
    expect(adminPayload.meetingUrl).toBe("https://zoom.us/j/private");
  });

  test("seminar email describes the program without including the meeting link", () => {
    const content = buildEventEmailContent({
      tenant: { name: "Camp Cedar", slug: "cedar" },
      event: seminar({
        _id: "event-1",
        summary: "A practical alumni career seminar.",
        meetingUrl: "https://zoom.us/j/private"
      }),
      kind: "reminder",
      subject: "Investment Banking seminar reminder"
    });

    expect(content.text).toContain("upcoming info session");
    expect(content.text).toContain("Investment Banking");
    expect(content.text).toContain("Online");
    expect(content.html).not.toContain("zoom.us/j/private");
  });

  test("releases join access only to the registered host or an attending member", () => {
    const memberProfile = { id: "member-profile", status: "active" };
    expect(
      assertSeminarJoinEligibility({
        event: seminar(),
        profile: memberProfile,
        rsvp: { status: "attending" }
      })
    ).toEqual({ profileId: "member-profile", isHost: false });

    expect(
      assertSeminarJoinEligibility({
        event: seminar(),
        profile: { id: "profile-host", status: "active" }
      })
    ).toEqual({ profileId: "profile-host", isHost: true });

    expect(() =>
      assertSeminarJoinEligibility({
        event: seminar(),
        profile: memberProfile,
        rsvp: { status: "maybe" }
      })
    ).toThrow(expect.objectContaining({ code: "SEMINAR_ATTENDING_RSVP_REQUIRED" }));

    expect(() =>
      assertSeminarJoinEligibility({
        event: seminar(),
        profile: { id: "member-profile", status: "pending" },
        rsvp: { status: "attending" }
      })
    ).toThrow(expect.objectContaining({ code: "SEMINAR_REGISTRATION_REQUIRED" }));
  });

  test("migration keeps meeting URLs service-role-only and tenant-scoped", async () => {
    const migrationNames = [
      "20260730015621_add_registered_member_seminars.sql",
      "20260731003100_add_seminar_foreign_key_indexes.sql"
    ];
    const sql = (
      await Promise.all(
        migrationNames.map((name) =>
          fs.readFile(path.resolve(__dirname, "../../../supabase/migrations", name), "utf8")
        )
      )
    ).join("\n");

    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.event_meeting_details");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.event_join_access_logs");
    expect(sql).toContain("idx_event_join_access_event");
    expect(sql).toContain("idx_event_join_access_profile");
    expect(sql).toContain("idx_event_join_access_user");
    expect(sql).toContain("trigger_enforce_event_host_tenant_consistency");
    expect(sql).toContain("trigger_enforce_event_join_tenant_consistency");
    expect(sql).toContain("trigger_enforce_event_rsvp_registration_and_capacity");
    expect(sql).toContain("event has reached registration capacity");
    expect(sql).toContain("TO service_role");
    expect(sql).toContain("FROM anon, authenticated");
    expect(sql).not.toContain("event_meeting_details_authenticated_tenant_scope");
  });
});
