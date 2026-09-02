import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertSeminarJoinEligibility,
  normalizePresenterProfileIds,
  serializeEvent,
  validateEventPublishReadiness
} from "../src/services/events.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function profile(id, overrides = {}) {
  return {
    id,
    firstName: "Dana",
    lastName: id.replace("profile-", ""),
    avatarUrl: "",
    roleAtCamp: "Counselor",
    industry: "Finance",
    ...overrides
  };
}

function seminar(overrides = {}) {
  return {
    id: "event-1",
    status: "published",
    eventType: "seminar",
    deliveryMode: "online",
    title: "Breaking into product",
    topicTitle: "Product management",
    audience: "career_explorers",
    meetingProvider: "zoom",
    hostProfileId: "profile-lead",
    startsAt: new Date(Date.now() + 60 * 60 * 1000),
    ...overrides
  };
}

describe("event presenters", () => {
  test("normalizes presenter ids, dropping blanks and duplicates in order", () => {
    expect(normalizePresenterProfileIds(["  profile-b ", "profile-a", "profile-b", "", null]))
      .toEqual(["profile-b", "profile-a"]);
    expect(normalizePresenterProfileIds(undefined)).toEqual([]);
  });

  test("rejects presenter lists past the supported limit", () => {
    const tooMany = Array.from({ length: 13 }, (_, index) => `profile-${index}`);
    expect(() => normalizePresenterProfileIds(tooMany)).toThrow(
      expect.objectContaining({ code: "EVENT_PRESENTERS_LIMIT" })
    );
  });

  test("serializes every presenter and keeps host pointing at the first", () => {
    const payload = serializeEvent(seminar(), {
      presenters: [profile("profile-lead"), profile("profile-guest")]
    });

    expect(payload.presenters.map((person) => person.id)).toEqual([
      "profile-lead",
      "profile-guest"
    ]);
    expect(payload.host.id).toBe("profile-lead");
    expect(payload.presenterProfileIds).toEqual(["profile-lead", "profile-guest"]);
  });

  test("falls back to the single host when no presenter list is loaded", () => {
    const payload = serializeEvent(seminar(), { hostProfile: profile("profile-lead") });
    expect(payload.presenters).toHaveLength(1);
    expect(payload.presenters[0].id).toBe("profile-lead");
  });

  test("a co-presenter can open the room without their own RSVP", () => {
    const payload = serializeEvent(seminar(), {
      viewerProfileId: "profile-guest",
      presenters: [profile("profile-lead"), profile("profile-guest")]
    });

    expect(payload.meetingAccess).toMatchObject({
      isPresenter: true,
      canRequestJoinLink: true
    });

    expect(
      assertSeminarJoinEligibility({
        event: seminar(),
        profile: { id: "profile-guest", status: "active" },
        presenterProfileIds: ["profile-lead", "profile-guest"]
      })
    ).toEqual({ profileId: "profile-guest", isHost: true, isPresenter: true });
  });

  test("a member who is not a presenter still needs an attending RSVP", () => {
    expect(() =>
      assertSeminarJoinEligibility({
        event: seminar(),
        profile: { id: "profile-member", status: "active" },
        presenterProfileIds: ["profile-lead", "profile-guest"],
        rsvp: { status: "maybe" }
      })
    ).toThrow(expect.objectContaining({ code: "SEMINAR_ATTENDING_RSVP_REQUIRED" }));
  });

  test("an info session with no presenter cannot be published", () => {
    expect(() =>
      validateEventPublishReadiness(seminar({ hostProfileId: "" }), {
        meetingUrl: "https://zoom.us/j/123"
      })
    ).toThrow(expect.objectContaining({ code: "SEMINAR_HOST_REQUIRED" }));
  });

  test("migration keeps presenters tenant-scoped and service-role-only", async () => {
    const sql = await fs.readFile(
      path.join(__dirname, "../../../supabase/migrations/20260824090000_add_event_presenters.sql"),
      "utf8"
    );

    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.event_presenters");
    expect(sql).toContain("UNIQUE (event_id, profile_id)");
    expect(sql).toContain("enforce_event_presenter_registration");
    expect(sql).toContain("ALTER TABLE public.event_presenters ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("REVOKE ALL ON public.event_presenters FROM anon, authenticated");
    // Existing single hosts must survive the move to a presenter list.
    expect(sql).toContain("INSERT INTO public.event_presenters");
  });
});
