import { z } from "zod";
import { IMPORT_FIELDS, isKnownImportField } from "./importFieldMap.js";

/**
 * Works out which spreadsheet column is which profile field.
 *
 * Two tiers. A synonym dictionary answers most of a real questionnaire for free
 * and exactly; whatever it does not recognise goes to the model with a handful of
 * sample values. The model never sees the whole file, so the cost of this step is
 * roughly flat whether a camp sends forty rows or four thousand.
 *
 * Nothing here writes anything. It proposes, a director confirms, and only then
 * does the importer run — so a wrong guess costs a dropdown change, not a bad
 * import.
 */

export const MAX_SAMPLE_VALUES = 5;

/** Auto-selected in the mapping UI. */
export const CONFIDENCE_AUTO = 0.85;
/** Pre-selected but flagged for a look. Below this, the column arrives unmapped. */
export const CONFIDENCE_SUGGEST = 0.5;

export function normalizeHeader(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Deliberately high-precision rather than broad. A header this dictionary claims
 * is applied without anyone looking at it, so anything genuinely ambiguous is
 * left out and allowed to fall through to the model, which has the sample values
 * and reports a confidence.
 *
 * Left out on purpose: "school" (high school or college?), "position" (at camp or
 * at work?), "from"/"to" (dates of what?), "hometown" (where they grew up is not
 * where they live now), "degree" (a qualification is not a subject).
 */
export const HEADER_SYNONYMS = Object.freeze({
  email: ["email", "emailaddress", "primaryemail", "contactemail", "youremail"],
  firstName: ["first", "firstname", "givenname", "fname", "forename"],
  lastName: ["last", "lastname", "surname", "familyname", "lname"],
  phones: ["phone", "phonenumber", "cell", "cellphone", "mobile", "mobilenumber", "telephone"],
  cityState: [
    "citystate", "cityandstate", "citytown", "currentlocation", "wheredoyoulivenow",
    "whereareyounow", "wheredoyoulive", "currentcity"
  ],
  bio: ["bio", "about", "aboutyou", "aboutyourself", "tellusaboutyourself"],

  roles: ["roleatcamp", "camprole", "yourroleatcamp", "whatdidyoudoatcamp", "camperorstaff"],
  nickname: ["nickname", "campnickname", "campname", "knownas"],
  "camperYears.firstYear": ["firstyear", "firstyearatcamp", "startyear", "yearstarted", "started"],
  "camperYears.lastYear": ["lastyear", "lastyearatcamp", "endyear", "yearended", "finished", "finalyear"],
  "camperYears.firstGroup": ["firstbunk", "firstcabin", "firstgroup"],
  "camperYears.lastGroup": ["lastbunk", "lastcabin", "lastgroup"],

  highSchool: ["highschool", "highschoolattended", "secondaryschool"],
  colleges: ["college", "colleges", "university", "collegeuniversity", "almamater", "wheredidyougotocollege"],
  collegeYears: ["gradyear", "graduationyear", "yeargraduated", "collegegradyear", "classof"],
  collegeMajors: ["major", "majors", "fieldofstudy", "studied", "whatdidyoustudy"],

  industry: ["industry", "sector"],
  "currentJobs.0.role": ["jobtitle", "currentjobtitle", "currenttitle", "currentrole", "occupation", "whatdoyoudo"],
  "currentJobs.0.company": ["company", "employer", "currentemployer", "currentcompany", "workplace", "organization"],
  "currentJobs.0.years": ["yearsatcompany", "currentjobyears", "sincewhen"],
  "pastJobs.0.role": ["previousjobtitle", "pastjobtitle", "previousrole", "formertitle"],
  "pastJobs.0.company": ["previousemployer", "pastemployer", "previouscompany", "formeremployer"],

  "socials.linkedin": ["linkedin", "linkedinurl", "linkedinprofile", "linkedinhandle"],
  "socials.instagram": ["instagram", "instagramhandle", "ig", "insta"],
  "socials.facebook": ["facebook", "facebookprofile", "fb"]
});

const SYNONYM_LOOKUP = (() => {
  const lookup = new Map();
  for (const [path, synonyms] of Object.entries(HEADER_SYNONYMS)) {
    for (const synonym of synonyms) {
      lookup.set(normalizeHeader(synonym), path);
    }
  }
  return lookup;
})();

/** Up to five non-empty values per column — what the model sees, and what the director sees. */
export function collectColumnSamples(rows = [], headers = [], limit = MAX_SAMPLE_VALUES) {
  const samples = new Map(headers.map((header) => [header, []]));
  for (const row of rows) {
    let stillWanting = false;
    for (const header of headers) {
      const bucket = samples.get(header);
      if (bucket.length >= limit) continue;
      stillWanting = true;
      const value = String(row?.[header] ?? "").trim();
      if (value) bucket.push(value);
    }
    if (!stillWanting) break;
  }
  return samples;
}

/**
 * The free pass. Exact synonym matches only — no fuzzy header matching, because a
 * near-miss here is applied silently, and "Parent email" landing on `email` would
 * quietly create accounts nobody can claim.
 */
export function proposeMappingFromHeaders(headers = []) {
  const proposals = [];
  const claimed = new Map();

  for (const header of headers) {
    const path = SYNONYM_LOOKUP.get(normalizeHeader(header));
    if (!path) {
      proposals.push({ column: header, field: null, confidence: 0, source: "none" });
      continue;
    }
    // Two columns wanting one field is a real questionnaire ("Email", "Email
    // Address"). The first keeps it and the second is handed to the director
    // rather than one silently overwriting the other.
    if (claimed.has(path)) {
      proposals.push({
        column: header,
        field: null,
        confidence: 0,
        source: "conflict",
        reason: `Also matches ${claimed.get(path)}, which was mapped to this field first.`
      });
      continue;
    }
    claimed.set(path, header);
    proposals.push({ column: header, field: path, confidence: 1, source: "dictionary" });
  }

  return proposals;
}

const AiMappingSchema = z.object({
  columns: z.array(
    z.object({
      column: z.string(),
      field: z.string().nullable(),
      confidence: z.number(),
      reason: z.string()
    })
  )
});

export function buildMapperInstructions() {
  const catalog = IMPORT_FIELDS.map((field) => `${field.path} — ${field.label}`).join("\n");
  return [
    "You match spreadsheet columns from a summer camp's alumni questionnaire to fields on an alumni profile.",
    "",
    "For each column you are given its header and up to five example values from real responses.",
    "Return the profile field it should fill, or null if none of them fit.",
    "",
    "Rules:",
    "- Use only these field paths, exactly as written:",
    catalog,
    "",
    "- The example values matter more than the header. A column called \"Year\" holding 1998 and 2004",
    "  is a camp year; one holding 2015 next to a college name is a graduation year.",
    "- Return null rather than guessing. An unmapped column costs a director one dropdown;",
    "  a wrongly mapped one puts the wrong information on someone's profile.",
    "- Never map a column to email unless it holds the alumnus's own address. A parent's or",
    "  spouse's address would create an account they can never claim.",
    "- confidence is 0 to 1, and should reflect how much the examples support the choice.",
    "- reason is one short sentence a camp director would understand."
  ].join("\n");
}

/**
 * Cost control and privacy in one: the model sees column headers and at most five
 * example values each, never the file. A 4,000-row questionnaire costs the same
 * to map as a 40-row one.
 */
export function buildMapperRequest(unmappedHeaders = [], samples = new Map()) {
  return {
    columns: unmappedHeaders.map((header) => ({
      header,
      examples: (samples.get(header) || []).slice(0, MAX_SAMPLE_VALUES)
    }))
  };
}

/**
 * Folds the model's answers into the dictionary's, and decides which are confident
 * enough to arrive pre-selected.
 *
 * A field the dictionary already claimed is never overwritten: an exact synonym
 * match is better evidence than a judgement made from five examples.
 */
export function mergeAiProposals(baseProposals = [], aiColumns = []) {
  const byColumn = new Map(aiColumns.map((entry) => [String(entry?.column || ""), entry]));
  const claimed = new Set(
    baseProposals.filter((proposal) => proposal.field).map((proposal) => proposal.field)
  );

  return baseProposals.map((proposal) => {
    if (proposal.field) return proposal;

    const suggestion = byColumn.get(proposal.column);
    const field = String(suggestion?.field || "").trim();
    if (!field || !isKnownImportField(field)) return proposal;

    const confidence = Math.max(0, Math.min(1, Number(suggestion.confidence) || 0));
    if (confidence < CONFIDENCE_SUGGEST) {
      return {
        ...proposal,
        source: "ai_low_confidence",
        reason: String(suggestion.reason || "").trim()
      };
    }
    if (claimed.has(field)) {
      return {
        ...proposal,
        source: "conflict",
        reason: `Another column is already mapped to ${field}.`
      };
    }

    claimed.add(field);
    return {
      column: proposal.column,
      field,
      confidence,
      source: "ai",
      needsReview: confidence < CONFIDENCE_AUTO,
      reason: String(suggestion.reason || "").trim()
    };
  });
}

/** The confirmed-mapping shape the importer takes, from whatever survived review. */
export function mappingFromProposals(proposals = []) {
  const mapping = {};
  for (const proposal of proposals) {
    if (proposal.field) mapping[proposal.column] = proposal.field;
  }
  return mapping;
}

export const __testables = { SYNONYM_LOOKUP, AiMappingSchema };
