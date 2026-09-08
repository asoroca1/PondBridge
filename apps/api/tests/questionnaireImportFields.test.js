import { describe, expect, test } from "@jest/globals";
import {
  buildImportBody,
  coerceCell,
  isKnownImportField,
  normalizeCityStateCell,
  normalizeSocialCell,
  normalizeYear,
  IMPORT_FIELDS
} from "../src/services/importFieldMap.js";
import { profilePayloadFromBody } from "../src/services/profilePayload.js";
import { validateImportMapping, __testables } from "../src/services/csvImport.js";
import { isSearchVisibleProfile } from "../src/db/models/ProfileModel.js";

const { profilePatchFromPayload } = __testables;

describe("normalizeYear", () => {
  test("pulls a four-digit year out of a sentence", () => {
    expect(normalizeYear("summers of 1998 onwards")).toBe("1998");
    expect(normalizeYear("2004")).toBe("2004");
  });

  // Camps predate 2000 by decades, so a bare two-digit year has to be windowed
  // rather than assumed to be recent.
  test("windows a two-digit year around today", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    expect(normalizeYear("98", now)).toBe("1998");
    expect(normalizeYear("'04", now)).toBe("2004");
    expect(normalizeYear("26", now)).toBe("2026");
    expect(normalizeYear("27", now)).toBe("1927");
  });

  test("refuses what it cannot read rather than guessing", () => {
    expect(normalizeYear("a few years back")).toBeNull();
    expect(normalizeYear("")).toBeNull();
    expect(normalizeYear("199")).toBeNull();
  });
});

describe("normalizeSocialCell", () => {
  test("accepts a LinkedIn URL or a bare handle and stores one canonical form", () => {
    expect(normalizeSocialCell("https://linkedin.com/in/dana-reyes", "linkedin"))
      .toBe("https://www.linkedin.com/in/dana-reyes");
    expect(normalizeSocialCell("dana-reyes", "linkedin"))
      .toBe("https://www.linkedin.com/in/dana-reyes");
  });

  test("stores other platforms as handles, with the @ removed", () => {
    expect(normalizeSocialCell("@danareyes", "instagram")).toBe("danareyes");
    expect(normalizeSocialCell("https://instagram.com/danareyes", "instagram")).toBe("danareyes");
  });

  test("returns null for something that is not an account", () => {
    expect(normalizeSocialCell("n/a lol", "instagram")).toBeNull();
    expect(normalizeSocialCell("", "linkedin")).toBeNull();
  });
});

describe("coerceCell", () => {
  test("a blank cell writes nothing at all", () => {
    expect(coerceCell("firstName", "")).toBeNull();
    expect(coerceCell("firstName", "   ")).toBeNull();
    expect(coerceCell("cityState", "")).toBeNull();
  });

  test("canonicalizes a location so the alumni map can place it", () => {
    expect(normalizeCityStateCell("brooklyn, ny")).toBe(coerceCell("cityState", "Brooklyn, New York"));
  });

  // "University of California, Berkeley" is one college, not two. Name lists must
  // not split on commas, even though that costs a director an occasional fix.
  test("splits name lists on semicolons only", () => {
    expect(coerceCell("colleges", "University of California, Berkeley"))
      .toEqual(["University of California, Berkeley"]);
    expect(coerceCell("colleges", "Michigan; NYU")).toEqual(["Michigan", "NYU"]);
  });

  test("splits year lists on commas, where a comma really is a separator", () => {
    expect(coerceCell("collegeYears", "2002, 2004")).toEqual(["2002", "2004"]);
  });

  test("drops repeats within one cell", () => {
    expect(coerceCell("colleges", "NYU; nyu")).toEqual(["NYU"]);
  });

  test("an unmapped field never coerces to anything", () => {
    expect(coerceCell("passwordHash", "hunter2")).toBeNull();
    expect(isKnownImportField("passwordHash")).toBe(false);
  });
});

describe("buildImportBody", () => {
  const mapping = {
    "Email Address": "email",
    "First": "firstName",
    "Last": "lastName",
    "Where do you live now?": "cityState",
    "Job title": "currentJobs.0.role",
    "Employer": "currentJobs.0.company",
    "What did you do at camp?": "roles",
    "LinkedIn": "socials.linkedin"
  };

  test("composes one job out of the separate columns a questionnaire uses", () => {
    const { body } = buildImportBody(
      { "Email Address": "d@example.com", First: "Dana", "Job title": "Designer", Employer: "Northwind" },
      mapping
    );
    expect(body.currentJobs).toEqual([{ role: "Designer", company: "Northwind", years: "" }]);
  });

  test("drops a job entry the row left entirely blank", () => {
    const { body } = buildImportBody(
      { "Email Address": "d@example.com", First: "Dana", "Job title": "", Employer: "" },
      mapping
    );
    expect(body.currentJobs).toBeUndefined();
  });

  // The reason mapping is many-to-many: one free-text answer routinely holds both
  // ends of a range.
  test("lets one column feed several fields", () => {
    const { body } = buildImportBody(
      { Years: "1998" },
      { Years: ["camperYears.firstYear", "camperYears.lastYear"] }
    );
    expect(body.camperYears).toEqual({ firstYear: "1998", lastYear: "1998" });
  });

  test("omits every field the row left blank instead of writing empty strings", () => {
    const { body } = buildImportBody(
      { "Email Address": "d@example.com", First: "Dana", Last: "", "Where do you live now?": "  " },
      mapping
    );
    expect(body).toEqual({ email: "d@example.com", firstName: "Dana" });
    expect("lastName" in body).toBe(false);
    expect("cityState" in body).toBe(false);
  });

  test("reports a cell it could not parse rather than dropping it silently", () => {
    const { body, skipped } = buildImportBody(
      { "Email Address": "d@example.com", LinkedIn: "ask me!!" },
      mapping
    );
    expect(body.socials).toBeUndefined();
    expect(skipped).toContainEqual({ column: "LinkedIn", path: "socials.linkedin", reason: "unparseable" });
  });

  test("ignores a mapping that points at a field which does not exist", () => {
    const { body, skipped } = buildImportBody({ X: "y" }, { X: "notAField" });
    expect(body).toEqual({});
    expect(skipped[0].reason).toBe("unknown_field");
  });
});

/**
 * The trap the old importer fell into: camp years, roles and majors have no
 * columns on the profiles table. They live inside the socials blob, and only
 * profilePayloadFromBody puts them there in the shape every read path expects.
 */
describe("an imported row lands where signup would put it", () => {
  test("camp years, roles and majors end up inside socials", () => {
    const { body } = buildImportBody(
      {
        Email: "dana@example.com",
        First: "Dana",
        Role: "Counselor; Lifeguard",
        Start: "1998",
        End: "2004",
        Major: "Design"
      },
      {
        Email: "email",
        First: "firstName",
        Role: "roles",
        Start: "camperYears.firstYear",
        End: "camperYears.lastYear",
        Major: "collegeMajors"
      }
    );
    const payload = profilePayloadFromBody(body, { email: "dana@example.com" });

    expect(payload.socials.camperYears).toEqual({
      firstYear: "1998",
      firstGroup: "",
      lastYear: "2004",
      lastGroup: ""
    });
    expect(payload.socials.roles).toEqual(["Counselor", "Lifeguard"]);
    expect(payload.socials.collegeMajors).toEqual(["Design"]);
    // The first role is also the column the directory filters on.
    expect(payload.roleAtCamp).toBe("Counselor");
    expect(payload.emails).toEqual(["dana@example.com"]);
  });
});

describe("validateImportMapping", () => {
  test("insists on an email column, because it is how anyone later claims the row", () => {
    expect(validateImportMapping({ A: "firstName" }).hasEmail).toBe(false);
    expect(validateImportMapping({ A: "email" }).hasEmail).toBe(true);
  });

  test("names the fields it does not recognise", () => {
    expect(validateImportMapping({ A: "email", B: "roles" }).unknown).toEqual([]);
    expect(validateImportMapping({ A: "email", B: "nope" }).unknown)
      .toEqual([{ column: "B", path: "nope" }]);
  });
});

describe("profilePatchFromPayload", () => {
  const existing = {
    firstName: "Dana",
    lastName: "Reyes",
    cityState: "Brooklyn, NY",
    emails: ["dana@example.com"],
    colleges: ["NYU"],
    currentJobs: [{ role: "Designer", company: "Northwind", years: "" }],
    socials: { camperYears: { firstYear: "1998", firstGroup: "", lastYear: "", lastGroup: "" } }
  };

  // A camp's spreadsheet does not get to overwrite what a member wrote about
  // themselves. This is the rule that makes re-importing safe.
  test("never replaces a value the member already has", () => {
    const patch = profilePatchFromPayload(
      { firstName: "Danielle", cityState: "Queens, NY", emails: [], colleges: [] },
      existing
    );
    expect(patch.firstName).toBeUndefined();
    expect(patch.cityState).toBeUndefined();
  });

  test("fills a field the member has left empty", () => {
    const patch = profilePatchFromPayload({ highSchool: "Midwood", emails: [] }, existing);
    expect(patch.highSchool).toBe("Midwood");
  });

  test("adds to lists without losing what is there", () => {
    const patch = profilePatchFromPayload({ colleges: ["Michigan"], emails: [] }, existing);
    expect(patch.colleges).toEqual(["NYU", "Michigan"]);
  });

  test("does not add a college the member already listed, whatever the casing", () => {
    const patch = profilePatchFromPayload({ colleges: ["nyu"], emails: [] }, existing);
    expect(patch.colleges).toBeUndefined();
  });

  test("does not duplicate a job it already has", () => {
    const patch = profilePatchFromPayload(
      { currentJobs: [{ role: "Designer", company: "Northwind", years: "2021-" }], emails: [] },
      existing
    );
    expect(patch.currentJobs).toBeUndefined();
  });

  test("fills the empty half of a camp-year range without touching the filled half", () => {
    const patch = profilePatchFromPayload(
      { socials: { camperYears: { firstYear: "1996", lastYear: "2004" } }, emails: [] },
      existing
    );
    expect(patch.socials.camperYears.firstYear).toBe("1998");
    expect(patch.socials.camperYears.lastYear).toBe("2004");
  });

  test("a row with nothing new produces no patch, so the row counts as unchanged", () => {
    expect(profilePatchFromPayload({ firstName: "Dana", emails: ["dana@example.com"] }, existing))
      .toEqual({});
  });
});

describe("IMPORT_FIELDS", () => {
  test("covers every profile field a member can fill in themselves", () => {
    const paths = new Set(IMPORT_FIELDS.map((field) => field.path));
    for (const path of [
      "email", "firstName", "lastName", "phones", "cityState", "bio",
      "roles", "nickname", "camperYears.firstYear", "camperYears.lastYear",
      "highSchool", "colleges", "collegeYears", "collegeMajors",
      "industry", "currentJobs.0.role", "currentJobs.0.company",
      "pastJobs.0.role", "socials.linkedin", "socials.instagram", "socials.facebook"
    ]) {
      expect(paths.has(path)).toBe(true);
    }
  });

  // Privacy settings and access tiers are the camp's or the member's to set
  // elsewhere; a spreadsheet must not be able to reach them.
  test("offers no way to import privacy settings or access tiers", () => {
    const paths = IMPORT_FIELDS.map((field) => field.path).join(" ");
    expect(paths).not.toContain("privacy");
    expect(paths).not.toContain("accessTier");
    expect(paths).not.toContain("status");
  });
});

describe("imported profiles stay out of member search", () => {
  // Regression: search() has two row sources — an SQL function and a paged
  // candidate read — and the SQL one returned pending rows, so a keyword search
  // found an imported profile that the directory listing and the member count
  // both correctly hid.
  test("a pending profile is not search-visible", () => {
    expect(isSearchVisibleProfile({ status: "pending" })).toBe(false);
    expect(isSearchVisibleProfile({ status: "removed" })).toBe(false);
  });

  test("active and flagged profiles are unaffected", () => {
    expect(isSearchVisibleProfile({ status: "active" })).toBe(true);
    expect(isSearchVisibleProfile({ status: "flagged" })).toBe(true);
  });
});
