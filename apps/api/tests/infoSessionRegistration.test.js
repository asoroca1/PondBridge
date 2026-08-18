import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertInfoSessionRegistrationMigrationTarget } from "../scripts/applyInfoSessionRegistrationSchema.js";
import {
  buildRegistrationRoster,
  normalizeEventWritePayload,
  serializeEvent,
  summarizeRsvpRows,
  validateEventPublishReadiness,
  validateEventTimeline
} from "../src/services/events.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function session(overrides = {}) {
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
    ...overrides
  };
}

describe("info sessions without a date yet", () => {
  test("accepts a session that has no start time", () => {
    expect(validateEventTimeline({ startsAt: null })).toEqual({
      startsAt: null,
      endsAt: null,
      rsvpDeadlineAt: null
    });
  });

  test("still rejects a start time that cannot be parsed", () => {
    expect(() => validateEventTimeline({ startsAt: "next tuesday-ish" }))
      .toThrow(/valid event start/i);
  });

  test("refuses an end time with no start to measure it against", () => {
    expect(() => validateEventTimeline({ startsAt: null, endsAt: new Date().toISOString() }))
      .toThrow(/start date and time before/i);
  });

  test("keeps a registration deadline that has no start to sit before", () => {
    const deadline = new Date("2027-01-01T00:00:00.000Z");
    const result = validateEventTimeline({ startsAt: null, rsvpDeadlineAt: deadline.toISOString() });
    expect(result.startsAt).toBeNull();
    expect(result.rsvpDeadlineAt).toEqual(deadline);
  });

  test("publishes an undated info session so members can register early", () => {
    expect(() =>
      validateEventPublishReadiness(session({ startsAt: null }), {
        meetingUrl: "https://example.zoom.us/j/1234567890"
      })
    ).not.toThrow();
  });

  test("publishes without a host now that presenters register themselves", () => {
    expect(() =>
      validateEventPublishReadiness(session({ startsAt: null, hostProfileId: "" }), {
        meetingUrl: "https://example.zoom.us/j/1234567890"
      })
    ).not.toThrow();
  });

  test("tells the page whether a date has been set", () => {
    expect(serializeEvent(session({ startsAt: null })).scheduled).toBe(false);
    expect(serializeEvent(session({ startsAt: new Date() })).scheduled).toBe(true);
  });

  test("writes a null start through rather than inventing one", () => {
    const payload = normalizeEventWritePayload({ title: "Open session", startsAt: "" });
    expect(payload.startsAt).toBeNull();
  });

  test("the migration drops the not-null constraint the old schema imposed", () => {
    const sql = fs.readFileSync(
      path.resolve(__dirname, "../../../supabase/migrations/20260818162306_info_session_registration_roles.sql"),
      "utf8"
    );
    expect(sql).toMatch(/ALTER COLUMN starts_at DROP NOT NULL/);
    expect(sql).toMatch(/registration_role IN \('attendee', 'presenter'\)/);
  });
});

describe("what publishing an info session actually requires", () => {
  const meetingUrl = "https://example.zoom.us/j/1234567890";

  test("accepts the Topic dropdown on its own, since the headline is optional", () => {
    // The form labels the free-text headline "optional", so requiring it told a
    // director who had chosen College that they had not added a topic.
    expect(() =>
      validateEventPublishReadiness(
        session({ topicCategory: "college", topicTitle: "" }),
        { meetingUrl }
      )
    ).not.toThrow();
  });

  test("accepts a headline with no category chosen", () => {
    expect(() =>
      validateEventPublishReadiness(
        session({ topicCategory: "", topicTitle: "Breaking into product" }),
        { meetingUrl }
      )
    ).not.toThrow();
  });

  test("asks for a topic only when neither field says anything", () => {
    expect(() =>
      validateEventPublishReadiness(
        session({ topicCategory: "", topicTitle: "" }),
        { meetingUrl }
      )
    ).toThrow(expect.objectContaining({ code: "SEMINAR_TOPIC_REQUIRED" }));
  });

  test("names every blocker at once instead of one per attempt", () => {
    let caught = null;
    try {
      validateEventPublishReadiness(
        session({ title: "", topicCategory: "", topicTitle: "" }),
        { meetingUrl: "" }
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).not.toBeNull();
    expect(caught.message).toMatch(/title/i);
    expect(caught.message).toMatch(/topic/i);
    expect(caught.message).toMatch(/meeting link/i);
    expect(caught.details.problems.map((problem) => problem.code)).toEqual([
      "EVENT_TITLE_REQUIRED",
      "SEMINAR_TOPIC_REQUIRED",
      "SEMINAR_MEETING_URL_REQUIRED"
    ]);
  });

  test("still reads as one sentence when only one thing is missing", () => {
    expect(() =>
      validateEventPublishReadiness(session(), { meetingUrl: "" })
    ).toThrow("Add the info session meeting link.");
  });
});

describe("applying the schema change", () => {
  test("refuses production without a deliberate acknowledgement", () => {
    expect(() =>
      assertInfoSessionRegistrationMigrationTarget({
        targetEnvironment: "production",
        acknowledgement: "",
        connectionString: "postgres://user:pw@db.example.com:5432/postgres"
      })
    ).toThrow();
  });

  test("accepts the staging acknowledgement this migration expects", () => {
    const target = assertInfoSessionRegistrationMigrationTarget({
      targetEnvironment: "staging",
      acknowledgement: "apply-info-session-registration-staging",
      connectionString: "postgres://user:pw@db.example.com:5432/postgres"
    });
    expect(target.target).toBe("staging");
  });

  test("keeps the runnable script and the migration record in agreement", () => {
    // The apply script reads its own copy of the SQL, so the two files can drift
    // apart and leave a deployed database missing what the migration promised.
    const scriptSql = fs.readFileSync(
      path.resolve(__dirname, "../scripts/info_session_registration_schema.sql"),
      "utf8"
    );
    const migrationSql = fs.readFileSync(
      path.resolve(__dirname, "../../../supabase/migrations/20260818162306_info_session_registration_roles.sql"),
      "utf8"
    );
    expect(scriptSql.trim()).toBe(migrationSql.trim());
  });
});

describe("registering as a presenter or an attendee", () => {
  const rows = [
    { profileId: "p1", status: "attending", registrationRole: "attendee", respondedAt: "2026-08-01T10:00:00Z" },
    { profileId: "p2", status: "attending", registrationRole: "presenter", respondedAt: "2026-08-02T10:00:00Z" },
    { profileId: "p3", status: "maybe", registrationRole: "attendee", respondedAt: "2026-08-03T10:00:00Z" },
    { profileId: "p4", status: "not_attending", registrationRole: "presenter", respondedAt: "2026-08-04T10:00:00Z" },
    { profileId: "p5", status: "attending", registrationRole: "presenter", respondedAt: "2026-08-05T10:00:00Z" }
  ];

  test("counts presenters and attendees without counting anyone who declined", () => {
    const summary = summarizeRsvpRows(rows);
    expect(summary.presenters).toBe(2);
    expect(summary.attendees).toBe(2);
    // The original tallies are untouched.
    expect(summary.attending).toBe(3);
    expect(summary.maybe).toBe(1);
    expect(summary.notAttending).toBe(1);
    expect(summary.totalResponses).toBe(5);
  });

  test("lists presenters first, then each group in the order they signed up", () => {
    const roster = buildRegistrationRoster(rows, new Map());
    expect(roster.map((person) => person.profileId)).toEqual(["p2", "p5", "p1", "p3"]);
    expect(roster[0].registrationRole).toBe("presenter");
  });

  test("leaves people who declined off the roster entirely", () => {
    const roster = buildRegistrationRoster(rows, new Map());
    expect(roster.some((person) => person.profileId === "p4")).toBe(false);
  });

  test("names people from their profile and falls back when one is missing", () => {
    const profiles = new Map([
      ["p2", { _id: "p2", firstName: "Ada", lastName: "Lovelace", roleAtCamp: "Counselor" }]
    ]);
    const roster = buildRegistrationRoster(rows, profiles);
    expect(roster[0].fullName).toBe("Ada Lovelace");
    expect(roster[0].roleAtCamp).toBe("Counselor");
    // p5 has no profile row loaded.
    expect(roster[1].fullName).toBe("Camp member");
  });

  test("treats an unknown role as an attendee rather than dropping the row", () => {
    const roster = buildRegistrationRoster(
      [{ profileId: "p9", status: "attending", registrationRole: "organiser" }],
      new Map()
    );
    expect(roster).toHaveLength(1);
    expect(roster[0].registrationRole).toBe("attendee");
  });

  test("reports the viewer's own role back to the page", () => {
    const serialized = serializeEvent(session(), {
      myRsvp: { _id: "r1", status: "attending", registrationRole: "presenter" }
    });
    expect(serialized.myRsvp.registrationRole).toBe("presenter");
  });

  test("omits the roster entirely when none was supplied", () => {
    // The route only passes a roster once the viewer has registered, so its
    // absence is what keeps the list private.
    expect(serializeEvent(session())).not.toHaveProperty("roster");
    expect(serializeEvent(session(), { roster: [] })).toHaveProperty("roster", []);
  });
});
