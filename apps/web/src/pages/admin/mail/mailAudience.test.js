import { describe, expect, test } from "vitest";
import {
  buildTargetingFromChips,
  chipsFromTargeting,
  chipsToGroupRules,
  industryChip,
  isUsableRule
} from "./mailAudience.js";

describe("mail industry audiences", () => {
  test("builds one industry targeting rule from multiple industry chips", () => {
    expect(buildTargetingFromChips([
      industryChip("Education"),
      industryChip("Healthcare")
    ])).toMatchObject({
      mode: "industry",
      industries: ["Education", "Healthcare"]
    });
  });

  test("round-trips industry rules used by saved groups and drafts", () => {
    const rules = chipsToGroupRules([industryChip("Technology")]);

    expect(rules).toEqual([expect.objectContaining({
      mode: "industry",
      industries: ["Technology"]
    })]);
    expect(chipsFromTargeting(rules[0])).toEqual([
      expect.objectContaining({
        key: "industry:technology",
        kind: "industry",
        label: "Technology"
      })
    ]);
  });

  test("fails closed when an industry rule has no industries", () => {
    expect(isUsableRule({ mode: "industry", industries: [] })).toBe(false);
  });
});
