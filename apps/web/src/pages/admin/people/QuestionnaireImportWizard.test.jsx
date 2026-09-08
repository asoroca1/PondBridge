import { describe, expect, it } from "vitest";
import { aiNote, badgeFor } from "./QuestionnaireImportWizard.jsx";

describe("badgeFor", () => {
  // The badge is how a director decides where to spend their attention, so an
  // exact dictionary match and a middling guess must never look the same.
  it("separates a certain match from one worth checking", () => {
    expect(badgeFor({ field: "email", source: "dictionary" })).toEqual({ tone: "ok", label: "Matched" });
    expect(badgeFor({ field: "colleges", source: "ai" })).toEqual({ tone: "ai", label: "Suggested" });
    expect(badgeFor({ field: "colleges", source: "ai", needsReview: true }))
      .toEqual({ tone: "warn", label: "Check this" });
  });

  it("explains an unmapped column rather than leaving it blank", () => {
    expect(badgeFor({ field: null, source: "none" }).label).toBe("Not matched");
    expect(badgeFor({ field: null, source: "ai_low_confidence" }).label).toBe("Not sure");
    expect(badgeFor({ field: null, source: "conflict" })).toEqual({ tone: "warn", label: "Duplicate field" });
  });
});

describe("aiNote", () => {
  it("says nothing when automatic matching did its job", () => {
    expect(aiNote({ used: true })).toBe("");
  });

  // Every one of these is a state a director can still finish the import from,
  // so each says so rather than reading as a failure.
  it("explains each way it can be unavailable, and that the import still works", () => {
    expect(aiNote({ used: false, reason: "not_configured" })).toContain("yours to set");
    expect(aiNote({ used: false, reason: "budget_reached" })).toContain("still works");
    expect(aiNote({ used: false, reason: "unavailable" })).toContain("yourself");
  });

  it("passes through the server's own message when a file is too messy to clean", () => {
    expect(aiNote({ used: false, reason: "too_many_unreadable_cells", message: "Check the mapping." }))
      .toBe("Check the mapping.");
  });

  it("stays quiet about states a director cannot act on", () => {
    expect(aiNote({ used: false, reason: "nothing_left_to_map" })).toBe("");
    expect(aiNote({ used: false, reason: "not_requested" })).toBe("");
    expect(aiNote()).toBe("");
  });
});
