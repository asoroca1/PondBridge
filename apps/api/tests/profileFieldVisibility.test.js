import {
  stripDisabledProfileFields,
  stripDisabledProfileFieldsFromList
} from "../src/services/profileFieldVisibility.js";

const profile = () => ({
  _id: "p1",
  firstName: "Casey",
  lastName: "Director",
  cityState: "Portland, ME",
  phones: ["(207) 555-0134"],
  roleAtCamp: "Director",
  industry: "Education",
  highSchool: "Portland High School",
  colleges: ["University of Maine"],
  collegeYears: ["2005"],
  currentJobs: [{ role: "Camp Director", company: "Camp Cedar", years: "2014-Present" }],
  pastJobs: [{ role: "Program Coordinator", company: "Camp Cedar", years: "2008-2014" }],
  socials: {
    nickname: "Case",
    maidenName: "Whitfield",
    linkedin: "https://www.linkedin.com/in/casey",
    instagram: "https://www.instagram.com/casey/",
    collegeMajors: ["Education"],
    collegeGreek: ["Kappa Alpha Theta"],
    camperYears: { stints: [{ startYear: "1994", endYear: "1999" }] }
  }
});

const tenantWith = (profileFields) => ({ content: { profileFields } });

describe("stripDisabledProfileFields", () => {
  it("returns the very same object when the camp collects everything", () => {
    // Worth pinning: the common case must not allocate a copy per row per
    // request. Note the defaults are not all-on — maidenName and greekLife
    // start off — so this has to name them explicitly.
    const input = profile();
    const allOn = { maidenName: true, greekLife: true };
    expect(stripDisabledProfileFields(input, tenantWith(allOn))).toBe(input);
  });

  it("strips the two opt-in fields for a camp that has never set them", () => {
    const out = stripDisabledProfileFields(profile(), tenantWith({}));
    expect(out.socials.maidenName).toBe("");
    expect(out.socials.collegeGreek).toEqual([]);
    expect(out.socials.nickname).toBe("Case");
  });

  it("blanks only the fields the camp switched off", () => {
    const out = stripDisabledProfileFields(profile(), tenantWith({ phone: false, industry: false }));
    expect(out.phones).toEqual([]);
    expect(out.industry).toBe("");
    expect(out.cityState).toBe("Portland, ME");
    expect(out.highSchool).toBe("Portland High School");
  });

  it("does not mutate the row it was handed", () => {
    // These come straight off a model doc and may be shared with a cache, so
    // blanking in place would strip the field for every later reader.
    const input = profile();
    stripDisabledProfileFields(input, tenantWith({ phone: false, socialLinkedin: false }));
    expect(input.phones).toEqual(["(207) 555-0134"]);
    expect(input.socials.linkedin).toBe("https://www.linkedin.com/in/casey");
  });

  it("clears a field wherever it is stored, including the socials overflow", () => {
    const out = stripDisabledProfileFields(
      profile(),
      tenantWith({ nickname: false, maidenName: false, greekLife: false })
    );
    expect(out.nickname).toBe("");
    expect(out.socials.nickname).toBe("");
    expect(out.socials.campNickname).toBe("");
    expect(out.socials.maidenName).toBe("");
    expect(out.socials.collegeGreek).toEqual([]);
  });

  it("clears each social network independently", () => {
    const out = stripDisabledProfileFields(profile(), tenantWith({ socialInstagram: false }));
    expect(out.socials.instagram).toBe("");
    expect(out.socials.linkedin).toBe("https://www.linkedin.com/in/casey");
  });

  it("takes the whole education block out when college is off", () => {
    const out = stripDisabledProfileFields(profile(), tenantWith({ college: false }));
    expect(out.colleges).toEqual([]);
    expect(out.collegeYears).toEqual([]);
    // college: false cascades in resolveProfileFields, so the dependent
    // per-college fields go with it rather than surviving as orphans.
    expect(out.socials.collegeMajors).toEqual([]);
    expect(out.socials.collegeGreek).toEqual([]);
  });

  it("strips the mapped education shape the legacy routes emit", () => {
    const mapped = {
      education: [{ college: "University of Maine", year: "2005", major: "Education", greek: "KAT" }]
    };
    const out = stripDisabledProfileFields(mapped, tenantWith({ greekLife: false }));
    expect(out.education[0].greek).toBe("");
    expect(out.education[0].major).toBe("Education");
  });

  it("resolves the tenant's settings once for a list", () => {
    const out = stripDisabledProfileFieldsFromList([profile(), profile()], tenantWith({ phone: false }));
    expect(out).toHaveLength(2);
    expect(out.every((row) => row.phones.length === 0)).toBe(true);
  });

  it("survives a null or non-object profile", () => {
    expect(stripDisabledProfileFields(null, tenantWith({ phone: false }))).toBeNull();
    expect(stripDisabledProfileFieldsFromList(null, tenantWith({ phone: false }))).toEqual([]);
  });
});
