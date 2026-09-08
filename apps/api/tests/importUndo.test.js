import { describe, expect, test } from "@jest/globals";
import { MAX_IMPORT_ROWS, wasCreatedByImport, __testables as importTestables } from "../src/services/csvImport.js";
import { isUnclaimedProfile } from "../src/services/memberVisibility.js";

const stamped = (reportId, status = "pending") => ({
  _id: "p1",
  userId: "u1",
  status,
  socials: { importedFrom: { reportId, importedAt: "2026-09-08T00:00:00.000Z" } }
});

describe("wasCreatedByImport", () => {
  // The provenance stamp is the whole basis of undo: without it there is no way
  // to tell which rows one bad upload produced.
  test("matches only the profiles that import created", () => {
    expect(wasCreatedByImport(stamped("report-1"), "report-1")).toBe(true);
    expect(wasCreatedByImport(stamped("report-2"), "report-1")).toBe(false);
  });

  test("never claims a profile nobody imported", () => {
    expect(wasCreatedByImport({ _id: "p9", socials: {} }, "report-1")).toBe(false);
    expect(wasCreatedByImport({ _id: "p9" }, "report-1")).toBe(false);
    expect(wasCreatedByImport(null, "report-1")).toBe(false);
  });

  // Guards against an empty or missing report id sweeping up every profile that
  // was never imported at all.
  test("matches nothing when there is no report id to match on", () => {
    expect(wasCreatedByImport(stamped(""), "")).toBe(false);
    expect(wasCreatedByImport({ socials: { importedFrom: {} } }, "")).toBe(false);
  });
});

/**
 * The rule that decides what undo may touch. Stated here as a unit because the
 * consequence of getting it wrong is deleting an account somebody is using.
 */
describe("what an undo is allowed to remove", () => {
  const reportId = "report-1";
  const canRemove = (profile) => wasCreatedByImport(profile, reportId) && isUnclaimedProfile(profile);

  test("removes a profile from that import which nobody has claimed", () => {
    expect(canRemove(stamped(reportId, "pending"))).toBe(true);
  });

  test("leaves a profile the person has already confirmed", () => {
    expect(canRemove(stamped(reportId, "active"))).toBe(false);
  });

  test("leaves everything from a different import", () => {
    expect(canRemove(stamped("report-2", "pending"))).toBe(false);
  });

  test("leaves people who were never imported", () => {
    expect(canRemove({ status: "pending", socials: {} })).toBe(false);
    expect(canRemove({ status: "active" })).toBe(false);
  });
});

describe("MAX_IMPORT_ROWS", () => {
  // The commit walks rows inside one request, so the cap is what stops a file
  // timing out halfway and leaving a director guessing what landed.
  test("is a real ceiling, big enough for a camp and small enough to finish", () => {
    expect(MAX_IMPORT_ROWS).toBe(2000);
  });
});

/**
 * Found by uploading a real questionnaire through the wizard on staging: a file
 * holding one person twice previewed as two new profiles.
 *
 * Registering a created row in the dedupe maps used to happen inside the write,
 * which a dry run skips — so the preview met the repeat as a stranger and
 * promised a director one more account than the commit would make. A preview
 * that overcounts is worse than none, because the point of the step is that its
 * numbers are true.
 */
describe("a row repeated inside one file", () => {
  const { rememberRow, buildExistingMaps } = importTestables;

  function freshMaps() {
    return buildExistingMaps([], []);
  }

  test("is recognised on the second sighting, with nothing written", () => {
    const mapState = freshMaps();
    const payload = { firstName: "Dana", lastName: "Reyes", cityState: "Brooklyn, NY" };

    expect(mapState.emailMap.has("dana@example.test")).toBe(false);
    rememberRow({ mapState, email: "dana@example.test", payload });
    expect(mapState.emailMap.has("dana@example.test")).toBe(true);
  });

  // The remembered row stands in for a profile that does not exist yet, so the
  // importer has to recognise it as a placeholder rather than try to patch it.
  test("remembers it as a placeholder, with no profile behind it", () => {
    const mapState = freshMaps();
    rememberRow({ mapState, email: "dana@example.test", payload: { firstName: "Dana", lastName: "Reyes" } });
    expect(mapState.emailMap.get("dana@example.test").profile).toBeNull();
  });

  test("also catches a repeat under name and city, not only the address", () => {
    const mapState = freshMaps();
    const payload = { firstName: "Dana", lastName: "Reyes", cityState: "Brooklyn, NY" };
    rememberRow({ mapState, email: "dana@example.test", payload });
    // A second row for the same person with a different address is still a repeat.
    expect(mapState.secondaryMap.has("dana reyes|brooklyn, ny")).toBe(true);
  });

  test("joins the pool the fuzzy matcher reads, so near-repeats are caught too", () => {
    const mapState = freshMaps();
    rememberRow({ mapState, email: "dana@example.test", payload: { firstName: "Dana", lastName: "Reyes", cityState: "Brooklyn, NY" } });
    expect(mapState.profilePool).toHaveLength(1);
    expect(mapState.profilePool[0]).toMatchObject({ email: "dana@example.test", fullName: "dana reyes" });
  });
});
