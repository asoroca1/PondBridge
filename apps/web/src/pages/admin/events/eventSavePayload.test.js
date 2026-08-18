import { describe, expect, test } from "vitest";
import { buildEventSavePayload, findEventFormProblem } from "./eventUtils.js";

const dated = { title: "Wake Forest", startsAt: "2026-08-18T13:00", endsAt: "2026-08-18T14:00", capacity: "" };

describe("saving an undated info session", () => {
  test("sends the dates as explicit nulls so a stored date gets cleared", () => {
    // Leaving them out would let the server keep the date it already had, so
    // switching a scheduled session back to undated would silently do nothing.
    const payload = buildEventSavePayload({ form: dated, eventType: "seminar", undated: true });
    expect(payload.startsAt).toBeNull();
    expect(payload.endsAt).toBeNull();
  });

  test("sends real timestamps when a date was chosen", () => {
    const payload = buildEventSavePayload({ form: dated, eventType: "seminar", undated: false });
    expect(payload.startsAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(payload.endsAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("keeps a registration deadline even with no date to sit before", () => {
    const payload = buildEventSavePayload({
      form: { ...dated, rsvpDeadlineAt: "2026-08-17T12:00" },
      eventType: "seminar",
      undated: true
    });
    expect(payload.startsAt).toBeNull();
    expect(payload.rsvpDeadlineAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("prefers the picked presenter over whatever id the form carried", () => {
    const payload = buildEventSavePayload({
      form: { ...dated, hostProfileId: "stale" },
      eventType: "seminar",
      host: { id: "chosen" }
    });
    expect(payload.hostProfileId).toBe("chosen");
  });
});

describe("what the form refuses to save", () => {
  test("always wants a title", () => {
    expect(findEventFormProblem({ form: { ...dated, title: "" } })).toMatch(/title/i);
    expect(findEventFormProblem({ form: { ...dated, title: "" }, undated: true })).toMatch(/title/i);
  });

  test("skips every date check once the session is undated", () => {
    expect(findEventFormProblem({ form: { title: "Open session" }, undated: true })).toBe("");
  });

  test("still wants a start time on a dated session", () => {
    expect(findEventFormProblem({ form: { title: "Session", startsAt: "" } }))
      .toMatch(/when it starts/i);
  });

  test("rejects an end that lands before the start", () => {
    expect(findEventFormProblem({
      form: { title: "Session", startsAt: "2026-08-18T14:00", endsAt: "2026-08-18T13:00" }
    })).toMatch(/after the start/i);
  });

  test("passes a well-formed dated session", () => {
    expect(findEventFormProblem({ form: dated })).toBe("");
  });
});
