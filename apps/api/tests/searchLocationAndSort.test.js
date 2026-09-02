import { describe, expect, test } from "@jest/globals";
import { __testables } from "../src/routes/search.js";

const {
  resolveStateCode,
  splitStoredLocation,
  matchesLocation,
  parseSearchInput,
  filterAndRankSearchItems,
  buildRankedComparator
} = __testables;

const profile = (cityState, extra = {}) => ({ cityState, ...extra });

describe("resolveStateCode", () => {
  test("passes through a valid two-letter code", () => {
    expect(resolveStateCode("MA")).toBe("MA");
    expect(resolveStateCode("ma")).toBe("MA");
  });

  test("resolves a full state name to its stored code", () => {
    expect(resolveStateCode("Massachusetts")).toBe("MA");
    expect(resolveStateCode("new york")).toBe("NY");
    expect(resolveStateCode("District of Columbia")).toBe("DC");
  });

  test("returns empty for anything that is not a US state", () => {
    expect(resolveStateCode("USA")).toBe("");
    expect(resolveStateCode("France")).toBe("");
    expect(resolveStateCode("")).toBe("");
  });
});

describe("splitStoredLocation", () => {
  test("splits the stored 'City, ST' shape", () => {
    expect(splitStoredLocation("Boston, MA")).toEqual({ city: "Boston", state: "MA" });
  });

  test("splits on the last comma so multi-part cities survive", () => {
    expect(splitStoredLocation("Washington, DC, USA")).toEqual({
      city: "Washington, DC",
      state: "USA"
    });
  });

  test("treats a comma-less value as a city", () => {
    expect(splitStoredLocation("London")).toEqual({ city: "London", state: "" });
  });
});

describe("matchesLocation", () => {
  test("matches a full state name against a stored code (the original bug)", () => {
    expect(matchesLocation(profile("Boston, MA"), { stateCode: "MA" }).matched).toBe(true);
    expect(
      matchesLocation(profile("Boston, MA"), { stateCode: resolveStateCode("Massachusetts") }).matched
    ).toBe(true);
  });

  test("matches city and state independently", () => {
    const filters = { city: "Boston", stateCode: "MA" };
    expect(matchesLocation(profile("Boston, MA"), filters).matched).toBe(true);
    expect(matchesLocation(profile("Boston, NY"), filters).matched).toBe(false);
    expect(matchesLocation(profile("Newton, MA"), filters).matched).toBe(false);
  });

  test("does not let a city term match against the state segment", () => {
    expect(matchesLocation(profile("Boston, MA"), { city: "MA" }).matched).toBe(false);
  });

  test("no location filter matches everything, including blank profiles", () => {
    expect(matchesLocation(profile(""), {}).matched).toBe(true);
  });

  test("a profile with no location cannot satisfy a location filter", () => {
    expect(matchesLocation(profile(""), { city: "Boston" }).matched).toBe(false);
  });

  test("falls back to free text for non-US states so international data still works", () => {
    expect(matchesLocation(profile("Paris, France"), { stateText: "France" }).matched).toBe(true);
    expect(matchesLocation(profile("Boston, MA"), { stateText: "France" }).matched).toBe(false);
  });

  test("scores a city+state match above a state-only match", () => {
    const both = matchesLocation(profile("Boston, MA"), { city: "Boston", stateCode: "MA" });
    const stateOnly = matchesLocation(profile("Boston, MA"), { stateCode: "MA" });
    expect(both.score).toBeGreaterThan(stateOnly.score);
  });
});

describe("parseSearchInput", () => {
  test("defaults to relevance and honours an explicit sort", () => {
    expect(parseSearchInput({}).sort).toBe("relevance");
    expect(parseSearchInput({ sort: "name" }).sort).toBe("name");
    expect(parseSearchInput({ sort: "recent" }).sort).toBe("recent");
    expect(parseSearchInput({ sort: "bogus" }).sort).toBe("relevance");
  });

  test("resolves a typed state name into a code", () => {
    expect(parseSearchInput({ state: "Massachusetts" }).stateCode).toBe("MA");
    expect(parseSearchInput({ state: "France" }).stateCode).toBe("");
  });

  test("keeps every selected multi-term filter", () => {
    const parsed = parseSearchInput({ cedarRoles: "Counselor, CIT", industries: "Finance, Legal" });
    expect(parsed.cedarRoleTerms).toEqual(["Counselor", "CIT"]);
    expect(parsed.industryTerms).toEqual(["Finance", "Legal"]);
  });
});

describe("location filtering from raw query input", () => {
  const people = [
    { firstName: "Ann", lastName: "Boston", cityState: "Boston, MA" },
    { firstName: "Ben", lastName: "Newton", cityState: "Newton, MA" },
    { firstName: "Cal", lastName: "Brooklyn", cityState: "Brooklyn, NY" }
  ];

  // Mirrors how runSearch wires parseSearchInput into the filter pass, so the whole
  // chain is covered: raw typed value -> resolved code -> match.
  const search = (query) => {
    const { city, state, stateCode } = parseSearchInput(query);
    return filterAndRankSearchItems(people, {
      city,
      stateCode,
      stateText: stateCode ? "" : state
    })
      .map((entry) => entry.profile.firstName)
      .sort();
  };

  test("a typed full state name narrows correctly (the original bug)", () => {
    expect(search({ city: "Boston", state: "Massachusetts" })).toEqual(["Ann"]);
  });

  test("a typed two-letter code works the same way", () => {
    expect(search({ city: "Boston", state: "MA" })).toEqual(["Ann"]);
  });

  test("state alone selects every profile in that state", () => {
    expect(search({ state: "Massachusetts" })).toEqual(["Ann", "Ben"]);
    expect(search({ state: "NY" })).toEqual(["Cal"]);
  });

  test("city alone ignores the state segment", () => {
    expect(search({ city: "Newton" })).toEqual(["Ben"]);
  });

  test("a mismatched city/state pair returns nobody", () => {
    expect(search({ city: "Boston", state: "New York" })).toEqual([]);
  });
});

describe("sort semantics", () => {
  const rows = [
    { firstName: "Ada", lastName: "Zeta", currentJobs: [{ company: "Acme" }] },
    { firstName: "Bo", lastName: "Alpha", pastJobs: [{ company: "Acme" }] }
  ];

  // Exercises the comparator runSearch actually uses, not a copy of it.
  const ranked = (sort) =>
    filterAndRankSearchItems(rows, { company: "Acme" })
      .sort(buildRankedComparator(sort))
      .map((entry) => entry.profile.lastName);

  test("relevance puts the current employee first even though they sort last by name", () => {
    expect(ranked("relevance")).toEqual(["Zeta", "Alpha"]);
  });

  test("name sorts strictly A-Z regardless of match score (the original bug)", () => {
    expect(ranked("name")).toEqual(["Alpha", "Zeta"]);
  });

  test("the two orders genuinely differ, so A-Z is not passing by coincidence", () => {
    expect(ranked("name")).not.toEqual(ranked("relevance"));
  });
});

describe("buildMatchReasons", () => {
  const { buildMatchReasons } = __testables;

  test("names the matched college with its last year", () => {
    const reasons = buildMatchReasons(
      { colleges: ["UCLA"], collegeYears: ["2008", "2012"] },
      { college: "ucla" }
    );
    expect(reasons).toEqual([{ kind: "college", label: "UCLA '12" }]);
  });

  test("falls back to the bare college name when no year is on file", () => {
    const reasons = buildMatchReasons({ colleges: ["Reed College"] }, { college: "reed" });
    expect(reasons).toEqual([{ kind: "college", label: "Reed College" }]);
  });

  test("marks a past employer as former and a current one plainly", () => {
    const current = buildMatchReasons({ currentJobs: [{ company: "Acme" }] }, { company: "acme" });
    expect(current).toEqual([{ kind: "company", label: "Acme" }]);

    const past = buildMatchReasons({ pastJobs: [{ company: "Acme" }] }, { company: "acme" });
    expect(past).toEqual([{ kind: "company", label: "formerly Acme" }]);
  });

  test("reports the overlapping camper stint", () => {
    const reasons = buildMatchReasons(
      { socials: { camperYears: { stints: [{ startYear: 1998, endYear: 2002 }] } } },
      { camperMinYear: 2000, camperMaxYear: 2001 }
    );
    expect(reasons).toEqual([{ kind: "camperYears", label: "Camper 1998-2002" }]);
  });

  test("returns nothing when no filter asked a question", () => {
    expect(buildMatchReasons({ colleges: ["UCLA"] }, {})).toEqual([]);
  });

  test("does not invent a reason when the profile lacks the field", () => {
    expect(buildMatchReasons({}, { college: "UCLA", company: "Acme" })).toEqual([]);
  });
});

describe("multi-term filters use OR, not AND", () => {
  const people = [
    { firstName: "Tech", industry: "Technology" },
    { firstName: "Fin", industry: "Finance" },
    { firstName: "Law", industry: "Legal" }
  ];

  test("two industries match either one", () => {
    const { industryTerms } = parseSearchInput({ industries: "Technology, Finance" });
    const names = filterAndRankSearchItems(people, { industryTerms })
      .map((entry) => entry.profile.firstName)
      .sort();
    expect(names).toEqual(["Fin", "Tech"]);
  });

  test("a profile matching both terms outranks one matching a single term", () => {
    const rows = [
      { firstName: "One", lastName: "B", industry: "Finance" },
      { firstName: "Both", lastName: "A", industry: "Finance and Technology" }
    ];
    const { industryTerms, sort } = parseSearchInput({ industries: "Technology, Finance" });
    const ranked = filterAndRankSearchItems(rows, { industryTerms })
      .sort(buildRankedComparator(sort))
      .map((entry) => entry.profile.firstName);
    expect(ranked[0]).toBe("Both");
  });
});
