import { describe, expect, test } from "@jest/globals";
import {
  CONFIDENCE_AUTO,
  MAX_SAMPLE_VALUES,
  buildMapperInstructions,
  buildMapperRequest,
  collectColumnSamples,
  mappingFromProposals,
  mergeAiProposals,
  normalizeHeader,
  proposeMappingFromHeaders,
  HEADER_SYNONYMS
} from "../src/services/importColumnMapper.js";
import { isKnownImportField } from "../src/services/importFieldMap.js";

function fieldFor(proposals, column) {
  return proposals.find((proposal) => proposal.column === column)?.field ?? null;
}

describe("normalizeHeader", () => {
  test("ignores the punctuation and casing a spreadsheet header carries", () => {
    expect(normalizeHeader("Email Address")).toBe("emailaddress");
    expect(normalizeHeader("  first_name ")).toBe("firstname");
    expect(normalizeHeader("Where do you live now?")).toBe("wheredoyoulivenow");
  });
});

describe("the synonym dictionary", () => {
  test("every synonym points at a field that actually exists", () => {
    for (const path of Object.keys(HEADER_SYNONYMS)) {
      expect(isKnownImportField(path)).toBe(true);
    }
  });

  test("no synonym is claimed by two different fields", () => {
    const seen = new Map();
    for (const [path, synonyms] of Object.entries(HEADER_SYNONYMS)) {
      for (const synonym of synonyms) {
        const key = normalizeHeader(synonym);
        expect(seen.has(key) ? `${seen.get(key)} and ${path}` : null).toBeNull();
        seen.set(key, path);
      }
    }
  });

  // The dictionary's answers are applied without anyone looking at them, so a
  // header that could mean two things must fall through to the model instead.
  test("leaves genuinely ambiguous headers alone", () => {
    const proposals = proposeMappingFromHeaders(["School", "Position", "From", "To", "Hometown", "Degree"]);
    for (const column of ["School", "Position", "From", "To", "Hometown", "Degree"]) {
      expect(fieldFor(proposals, column)).toBeNull();
    }
  });
});

describe("proposeMappingFromHeaders", () => {
  test("maps the headers a real questionnaire actually uses", () => {
    const proposals = proposeMappingFromHeaders([
      "Email Address", "First Name", "Last Name", "Cell Phone", "Current Location",
      "What did you do at camp?", "First Year At Camp", "Last year at camp",
      "High School", "College/University", "Major", "Current Employer", "LinkedIn"
    ]);

    expect(fieldFor(proposals, "Email Address")).toBe("email");
    expect(fieldFor(proposals, "First Name")).toBe("firstName");
    expect(fieldFor(proposals, "Cell Phone")).toBe("phones");
    expect(fieldFor(proposals, "Current Location")).toBe("cityState");
    expect(fieldFor(proposals, "What did you do at camp?")).toBe("roles");
    expect(fieldFor(proposals, "First Year At Camp")).toBe("camperYears.firstYear");
    expect(fieldFor(proposals, "Last year at camp")).toBe("camperYears.lastYear");
    expect(fieldFor(proposals, "College/University")).toBe("colleges");
    expect(fieldFor(proposals, "Current Employer")).toBe("currentJobs.0.company");
    expect(fieldFor(proposals, "LinkedIn")).toBe("socials.linkedin");
  });

  test("an exact dictionary hit is fully confident and needs no review", () => {
    const [proposal] = proposeMappingFromHeaders(["Email"]);
    expect(proposal).toMatchObject({ field: "email", confidence: 1, source: "dictionary" });
  });

  // "Email" and "Email Address" in one export is common, and silently letting the
  // second overwrite the first would import the wrong address.
  test("hands a second column wanting the same field to the director", () => {
    const proposals = proposeMappingFromHeaders(["Email", "Email Address"]);
    expect(fieldFor(proposals, "Email")).toBe("email");
    expect(fieldFor(proposals, "Email Address")).toBeNull();
    expect(proposals[1].source).toBe("conflict");
  });

  test("says nothing about a column it does not recognise", () => {
    const [proposal] = proposeMappingFromHeaders(["Favourite campfire song"]);
    expect(proposal).toMatchObject({ field: null, confidence: 0, source: "none" });
  });
});

describe("collectColumnSamples", () => {
  const rows = [
    { Year: "", Name: "Dana" },
    { Year: "1998", Name: "Sam" },
    { Year: "2004", Name: "" },
    { Year: "2011", Name: "Kit" }
  ];

  test("collects real values and skips the blanks a questionnaire is full of", () => {
    const samples = collectColumnSamples(rows, ["Year", "Name"]);
    expect(samples.get("Year")).toEqual(["1998", "2004", "2011"]);
    expect(samples.get("Name")).toEqual(["Dana", "Sam", "Kit"]);
  });

  test("stops at the cap, so the request stays the same size for any file", () => {
    const many = Array.from({ length: 500 }, (_value, index) => ({ Year: String(1990 + index) }));
    expect(collectColumnSamples(many, ["Year"]).get("Year")).toHaveLength(MAX_SAMPLE_VALUES);
  });
});

describe("what the model is sent", () => {
  test("only headers and a few examples — never the file", () => {
    const rows = Array.from({ length: 400 }, (_v, i) => ({ Mystery: `value ${i}`, Secret: `ssn ${i}` }));
    const samples = collectColumnSamples(rows, ["Mystery", "Secret"]);
    const request = buildMapperRequest(["Mystery"], samples);

    expect(request.columns).toHaveLength(1);
    expect(request.columns[0].examples).toHaveLength(MAX_SAMPLE_VALUES);
    // A column the dictionary already resolved is not sent at all.
    expect(JSON.stringify(request)).not.toContain("Secret");
    expect(JSON.stringify(request)).not.toContain("value 300");
  });

  test("the instructions list every field it is allowed to choose", () => {
    const instructions = buildMapperInstructions();
    expect(instructions).toContain("camperYears.firstYear");
    expect(instructions).toContain("socials.linkedin");
    expect(instructions).toContain("Return null rather than guessing");
  });
});

describe("mergeAiProposals", () => {
  const base = proposeMappingFromHeaders(["Email", "Summers", "Mystery"]);

  test("fills a column the dictionary could not place", () => {
    const merged = mergeAiProposals(base, [
      { column: "Summers", field: "camperYears.firstYear", confidence: 0.93, reason: "Values are camp-era years." }
    ]);
    expect(fieldFor(merged, "Summers")).toBe("camperYears.firstYear");
    expect(merged.find((p) => p.column === "Summers").needsReview).toBe(false);
  });

  test("flags a middling guess for review instead of applying it quietly", () => {
    const merged = mergeAiProposals(base, [
      { column: "Summers", field: "collegeYears", confidence: 0.6, reason: "Could be graduation years." }
    ]);
    const proposal = merged.find((p) => p.column === "Summers");
    expect(proposal.field).toBe("collegeYears");
    expect(proposal.needsReview).toBe(true);
    expect(proposal.confidence).toBeLessThan(CONFIDENCE_AUTO);
  });

  test("refuses a guess it is not confident about, but keeps the reasoning", () => {
    const merged = mergeAiProposals(base, [
      { column: "Mystery", field: "bio", confidence: 0.2, reason: "Free text, but could be anything." }
    ]);
    const proposal = merged.find((p) => p.column === "Mystery");
    expect(proposal.field).toBeNull();
    expect(proposal.source).toBe("ai_low_confidence");
    expect(proposal.reason).toContain("could be anything");
  });

  // An exact synonym match is better evidence than a judgement from five values.
  test("never overrides what the dictionary already matched", () => {
    const merged = mergeAiProposals(base, [
      { column: "Email", field: "bio", confidence: 0.99, reason: "Looks like prose." }
    ]);
    expect(fieldFor(merged, "Email")).toBe("email");
  });

  test("will not put two columns on one field", () => {
    const merged = mergeAiProposals(base, [
      { column: "Mystery", field: "email", confidence: 0.95, reason: "Contains addresses." }
    ]);
    expect(fieldFor(merged, "Mystery")).toBeNull();
    expect(merged.find((p) => p.column === "Mystery").source).toBe("conflict");
  });

  test("ignores a field the model invented", () => {
    const merged = mergeAiProposals(base, [
      { column: "Mystery", field: "profiles.password", confidence: 1, reason: "" }
    ]);
    expect(fieldFor(merged, "Mystery")).toBeNull();
  });

  test("survives a malformed answer rather than throwing mid-import", () => {
    expect(() => mergeAiProposals(base, [{ column: "Mystery" }])).not.toThrow();
    expect(() => mergeAiProposals(base, [null])).not.toThrow();
    expect(() => mergeAiProposals(base, undefined)).not.toThrow();
  });
});

describe("mappingFromProposals", () => {
  test("keeps only the columns that ended up with a field", () => {
    expect(mappingFromProposals([
      { column: "Email", field: "email" },
      { column: "Mystery", field: null }
    ])).toEqual({ Email: "email" });
  });
});
