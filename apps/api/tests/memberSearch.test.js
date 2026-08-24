import { matchesMemberQuery } from "../src/utils/memberSearch.js";

const dylan = {
  firstName: "Dylan",
  lastName: "Garber",
  emails: ["dylan.garber@example.com"],
  cityState: "Boston, MA",
  roleAtCamp: "Counselor",
  collegeYears: ["2021"]
};

describe("member search matching", () => {
  // The bug this fixes: the whole query was tested against each name part on
  // its own, so a full name matched nobody.
  test("finds a member by their full name", () => {
    expect(matchesMemberQuery(dylan, "Dylan Garber")).toBe(true);
  });

  test("still finds them by either name alone", () => {
    expect(matchesMemberQuery(dylan, "Dylan")).toBe(true);
    expect(matchesMemberQuery(dylan, "garber")).toBe(true);
  });

  test("ignores word order and extra whitespace", () => {
    expect(matchesMemberQuery(dylan, "garber   dylan")).toBe(true);
    expect(matchesMemberQuery(dylan, "  Dylan  Garber  ")).toBe(true);
  });

  test("matches partial words, email, location and camp role", () => {
    expect(matchesMemberQuery(dylan, "dyl gar")).toBe(true);
    expect(matchesMemberQuery(dylan, "dylan.garber@example.com")).toBe(true);
    expect(matchesMemberQuery(dylan, "boston")).toBe(true);
    expect(matchesMemberQuery(dylan, "counselor")).toBe(true);
  });

  test("every word has to match, so extra words narrow the result", () => {
    expect(matchesMemberQuery(dylan, "Dylan Garber counselor")).toBe(true);
    expect(matchesMemberQuery(dylan, "Dylan Peterson")).toBe(false);
  });

  test("an empty query matches everyone", () => {
    expect(matchesMemberQuery(dylan, "")).toBe(true);
    expect(matchesMemberQuery(dylan, "   ")).toBe(true);
  });

  test("handles members with missing fields", () => {
    expect(matchesMemberQuery({}, "dylan")).toBe(false);
    expect(matchesMemberQuery({ firstName: "Ada" }, "ada")).toBe(true);
  });
});
