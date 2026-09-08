import { describe, expect, test } from "@jest/globals";
import {
  applyCleanupResults,
  buildCleanupInstructions,
  buildCleanupRequest,
  cellKey,
  collectUnparseableCells,
  needsCleanup
} from "../src/services/importValueCleaner.js";
import { buildImportBody } from "../src/services/importFieldMap.js";

describe("needsCleanup", () => {
  // The trigger is precise on purpose: only what the deterministic parsers refused.
  // Everything they can read is left alone, which is what keeps this cheap and what
  // keeps imported values identical to hand-typed ones.
  test("leaves alone anything the parsers can already read", () => {
    expect(needsCleanup("camperYears.firstYear", "1998")).toBe(false);
    expect(needsCleanup("camperYears.firstYear", "98")).toBe(false);
    expect(needsCleanup("cityState", "Brooklyn, NY")).toBe(false);
    expect(needsCleanup("socials.linkedin", "dana-reyes")).toBe(false);
  });

  test("picks up the free text they refused", () => {
    expect(needsCleanup("camperYears.firstYear", "summers of 98 through 04")).toBe(true);
    expect(needsCleanup("socials.linkedin", "search my name!")).toBe(true);
  });

  test("a blank cell is not a problem to solve", () => {
    expect(needsCleanup("camperYears.firstYear", "")).toBe(false);
    expect(needsCleanup("camperYears.firstYear", "   ")).toBe(false);
  });

  test("an unmapped field is never sent anywhere", () => {
    expect(needsCleanup("passwordHash", "anything")).toBe(false);
  });
});

describe("collectUnparseableCells", () => {
  const mapping = { Started: "camperYears.firstYear", Where: "cityState" };

  test("finds only the answers that need help", () => {
    const cells = collectUnparseableCells(
      [
        { Started: "1998", Where: "Brooklyn NY" },
        { Started: "the summer after 8th grade", Where: "Denver CO" }
      ],
      mapping
    );
    expect(cells).toHaveLength(1);
    expect(cells[0]).toMatchObject({ path: "camperYears.firstYear", raw: "the summer after 8th grade" });
  });

  // The saving that makes this affordable: "n/a" typed by two hundred people is
  // one item in the request, not two hundred.
  test("collapses a value that repeats across the file", () => {
    const rows = Array.from({ length: 200 }, () => ({ Started: "n/a" }));
    const cells = collectUnparseableCells(rows, mapping);
    expect(cells).toHaveLength(1);
    expect(cells[0].occurrences).toBe(200);
  });

  test("keeps the same text apart when it lands on different fields", () => {
    // Both of these fields reject "no idea!", and each needs its own rewrite —
    // a year and a LinkedIn URL are not the same answer.
    const cells = collectUnparseableCells(
      [{ Started: "no idea!", Linked: "no idea!" }],
      { Started: "camperYears.firstYear", Linked: "socials.linkedin" }
    );
    expect(cells).toHaveLength(2);
    expect(new Set(cells.map((cell) => cell.path)).size).toBe(2);
  });

  // Worth stating because it sets the scope of this whole step: free-text fields
  // accept whatever a person typed, so they never reach the model at all.
  test("free-text fields are never candidates, whatever is in them", () => {
    expect(collectUnparseableCells([{ Where: "somewhere out west" }], { Where: "cityState" })).toEqual([]);
    expect(collectUnparseableCells([{ B: "ask me sometime" }], { B: "bio" })).toEqual([]);
  });
});

describe("what the cleaner sends", () => {
  test("one field, one answer, and nothing about the person it came from", () => {
    const cells = collectUnparseableCells(
      [{ Started: "a few summers in the nineties", Email: "dana@example.com", Name: "Dana" }],
      { Started: "camperYears.firstYear", Email: "email", Name: "firstName" }
    );
    const request = buildCleanupRequest(cells);

    expect(request.items).toHaveLength(1);
    expect(request.items[0]).toMatchObject({ id: 0, field: "camperYears.firstYear" });
    // The rest of the row never leaves.
    expect(JSON.stringify(request)).not.toContain("dana@example.com");
    expect(JSON.stringify(request)).not.toContain("Dana");
  });

  test("the instructions forbid inventing anything", () => {
    const instructions = buildCleanupInstructions();
    expect(instructions).toContain("Rewrite only");
    expect(instructions).toContain("return null");
  });
});

describe("applyCleanupResults", () => {
  const cells = collectUnparseableCells(
    [{ Started: "summers of 98 through 04", Where: "the bay area" }],
    { Started: "camperYears.firstYear", Where: "cityState" }
  );

  test("accepts a rewrite the field's own parser can read", () => {
    const { cleaned, preview } = applyCleanupResults(cells, [
      { id: 0, value: "1998", reason: "First of the two years given." }
    ]);
    expect(cleaned.get(cellKey("camperYears.firstYear", "summers of 98 through 04"))).toBe("1998");
    expect(preview[0]).toMatchObject({ before: "summers of 98 through 04", after: "1998" });
  });

  /**
   * The safety property. Whatever comes back is re-parsed by the same code that
   * rejected the raw cell, so the model cannot write a value a person could not
   * have typed — and a hallucinated one that does not parse simply disappears.
   */
  test("throws away a rewrite that still does not parse", () => {
    const { cleaned, preview } = applyCleanupResults(cells, [
      { id: 0, value: "sometime in the late nineties", reason: "" }
    ]);
    expect(cleaned.size).toBe(0);
    expect(preview).toHaveLength(0);
  });

  test("honours a refusal to guess", () => {
    const { cleaned } = applyCleanupResults(cells, [{ id: 0, value: null, reason: "No year given." }]);
    expect(cleaned.size).toBe(0);
  });

  test("survives a malformed answer instead of throwing mid-import", () => {
    expect(() => applyCleanupResults(cells, [null])).not.toThrow();
    expect(() => applyCleanupResults(cells, undefined)).not.toThrow();
    expect(applyCleanupResults(cells, [{ id: 99, value: "1998" }]).cleaned.size).toBe(0);
  });

  test("reports how many rows each rewrite will affect", () => {
    const repeated = collectUnparseableCells(
      Array.from({ length: 12 }, () => ({ Started: "class of 98" })),
      { Started: "camperYears.firstYear" }
    );
    const { preview } = applyCleanupResults(repeated, [{ id: 0, value: "1998", reason: "" }]);
    expect(preview[0].occurrences).toBe(12);
  });
});

describe("rewrites reaching the importer", () => {
  const mapping = { Started: "camperYears.firstYear" };
  const row = { Started: "summers of 98 through 04" };

  test("without cleanup the cell is dropped, as it always was", () => {
    const { body, skipped } = buildImportBody(row, mapping);
    expect(body.camperYears).toBeUndefined();
    expect(skipped[0].reason).toBe("unparseable");
  });

  test("with an approved rewrite it lands", () => {
    const cleaned = new Map([[cellKey("camperYears.firstYear", row.Started), "1998"]]);
    const { body } = buildImportBody(row, mapping, cleaned);
    expect(body.camperYears).toEqual({ firstYear: "1998" });
  });

  // A rewrite may only fill a hole. If the parser could read the cell, that answer
  // stands — the model never gets to second-guess a value that was already fine.
  test("never overrides a cell that parsed on its own", () => {
    const cleaned = new Map([[cellKey("camperYears.firstYear", "1998"), "2020"]]);
    const { body } = buildImportBody({ Started: "1998" }, mapping, cleaned);
    expect(body.camperYears).toEqual({ firstYear: "1998" });
  });
});
