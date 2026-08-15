import {
  buildCorpusStats,
  campYearSet,
  normalizeLoose,
  rarity,
  scoreSimilarity
} from "../src/services/profileSimilarity.js";

function profile(overrides = {}) {
  return {
    roleAtCamp: "",
    industry: "",
    cityState: "",
    colleges: [],
    highSchool: "",
    currentJobs: [],
    socials: {},
    ...overrides
  };
}

function camper(stints) {
  return { socials: { camperYears: { stints } } };
}

describe("camp year parsing", () => {
  test("expands a stint into every year it covers", () => {
    const years = campYearSet(camper([{ startYear: "2007", endYear: "2010" }]));
    expect([...years].sort()).toEqual([2007, 2008, 2009, 2010]);
  });

  test("reads camper and staff stints together", () => {
    const years = campYearSet({
      socials: {
        camperYears: { stints: [{ startYear: 2005, endYear: 2006 }] },
        staffYears: { stints: [{ startYear: 2011, endYear: 2011 }] }
      }
    });
    expect([...years].sort()).toEqual([2005, 2006, 2011]);
  });

  test("supports the legacy flat firstYear/lastYear shape", () => {
    const years = campYearSet({ socials: { camperYears: { firstYear: "2001", lastYear: "2003" } } });
    expect([...years].sort()).toEqual([2001, 2002, 2003]);
  });

  test("a single year still counts", () => {
    expect([...campYearSet(camper([{ startYear: "2015" }]))]).toEqual([2015]);
  });

  test("ignores junk and impossible years without throwing", () => {
    expect(campYearSet(camper([{ startYear: "n/a", endYear: "" }])).size).toBe(0);
    expect(campYearSet(camper([{ startYear: "1650" }])).size).toBe(0);
    expect(campYearSet({ socials: null }).size).toBe(0);
    expect(campYearSet({}).size).toBe(0);
  });

  test("caps an implausible stint rather than expanding forever", () => {
    expect(campYearSet(camper([{ startYear: "1990", endYear: "2020" }])).size).toBeLessThanOrEqual(31);
  });
});

describe("text normalization", () => {
  test("punctuation and spacing no longer decide a match", () => {
    expect(normalizeLoose("New York, NY")).toBe(normalizeLoose("New York  NY"));
    expect(normalizeLoose("Boston,MA")).toBe(normalizeLoose("boston ma"));
  });

  test("two spellings of the same city now score as a match", () => {
    const a = profile({ cityState: "New York, NY" });
    const b = profile({ cityState: "New York NY" });
    expect(scoreSimilarity(a, b).reasons).toContain("location");
  });
});

describe("rarity weighting", () => {
  test("a value nearly everyone shares carries almost nothing", () => {
    const stats = buildCorpusStats([
      ...Array.from({ length: 95 }, () => profile({ roleAtCamp: "Camper" })),
      ...Array.from({ length: 5 }, () => profile({ roleAtCamp: "Waterfront Director" }))
    ]);
    expect(rarity(stats, "role", "Camper")).toBeLessThan(0.05);
    expect(rarity(stats, "role", "Waterfront Director")).toBeGreaterThan(0.6);
  });

  test("sharing only the majority role does not make two people related", () => {
    const stats = buildCorpusStats(
      Array.from({ length: 100 }, () => profile({ roleAtCamp: "Camper" }))
    );
    const a = profile({ roleAtCamp: "Camper" });
    const b = profile({ roleAtCamp: "Camper" });
    const result = scoreSimilarity(a, b, stats);
    expect(result.score).toBe(0);
    expect(result.reasons).toEqual([]);
  });

  test("sharing a rare role still counts", () => {
    const stats = buildCorpusStats([
      ...Array.from({ length: 95 }, () => profile({ roleAtCamp: "Camper" })),
      profile({ roleAtCamp: "Waterfront Director" }),
      profile({ roleAtCamp: "Waterfront Director" })
    ]);
    const a = profile({ roleAtCamp: "Waterfront Director" });
    const b = profile({ roleAtCamp: "Waterfront Director" });
    expect(scoreSimilarity(a, b, stats).reasons).toContain("role");
  });
});

describe("ranking", () => {
  test("years at camp together beat a shared majority role", () => {
    const stats = buildCorpusStats(
      Array.from({ length: 100 }, () => profile({ roleAtCamp: "Camper" }))
    );
    const target = profile({ roleAtCamp: "Camper", ...camper([{ startYear: 2008, endYear: 2011 }]) });
    const bunkmate = profile({ roleAtCamp: "Counselor", ...camper([{ startYear: 2009, endYear: 2012 }]) });
    const strangerSameRole = profile({ roleAtCamp: "Camper" });

    const withOverlap = scoreSimilarity(target, bunkmate, stats);
    const withoutOverlap = scoreSimilarity(target, strangerSameRole, stats);

    expect(withOverlap.reasons).toContain("camp");
    expect(withOverlap.score).toBeGreaterThan(withoutOverlap.score);
  });

  test("camp era and industry are weighted comparably", () => {
    const stats = buildCorpusStats([]);
    const target = profile({ industry: "Finance", ...camper([{ startYear: 2008, endYear: 2010 }]) });
    const sameYears = profile({ ...camper([{ startYear: 2008, endYear: 2010 }]) });
    const sameIndustry = profile({ industry: "Finance" });

    const era = scoreSimilarity(target, sameYears, stats).score;
    const career = scoreSimilarity(target, sameIndustry, stats).score;
    expect(Math.abs(era - career)).toBeLessThanOrEqual(2.5);
  });

  test("more shared summers scores higher than one", () => {
    const target = profile(camper([{ startYear: 2008, endYear: 2012 }]));
    const oneYear = profile(camper([{ startYear: 2012, endYear: 2012 }]));
    const manyYears = profile(camper([{ startYear: 2008, endYear: 2012 }]));
    expect(scoreSimilarity(target, manyYears).score)
      .toBeGreaterThan(scoreSimilarity(target, oneYear).score);
  });

  test("two profiles with nothing in common score zero", () => {
    expect(scoreSimilarity(profile(), profile()).score).toBe(0);
    expect(scoreSimilarity(profile(), profile()).reasons).toEqual([]);
  });

  test("empty fields never match each other", () => {
    const a = profile({ industry: "", cityState: "", highSchool: "" });
    const b = profile({ industry: "", cityState: "", highSchool: "" });
    expect(scoreSimilarity(a, b).score).toBe(0);
  });
});
