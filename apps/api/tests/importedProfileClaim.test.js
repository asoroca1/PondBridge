import { describe, expect, test } from "@jest/globals";
import {
  canAccessMemberProfile,
  isRemovedProfile,
  isUnclaimedProfile
} from "../src/services/memberVisibility.js";
import { claimSummaryFromProfile } from "../src/services/profileClaim.js";

const activeUser = { _id: "u1", status: "active" };

describe("isUnclaimedProfile", () => {
  test("a pending profile is one an import created and nobody has claimed", () => {
    expect(isUnclaimedProfile({ status: "pending" })).toBe(true);
  });

  test("every other status is claimed or gone, not waiting", () => {
    expect(isUnclaimedProfile({ status: "active" })).toBe(false);
    expect(isUnclaimedProfile({ status: "flagged" })).toBe(false);
    expect(isUnclaimedProfile({ status: "removed" })).toBe(false);
    expect(isUnclaimedProfile(null)).toBe(false);
    expect(isUnclaimedProfile({})).toBe(false);
  });

  test("status is compared case- and whitespace-insensitively", () => {
    expect(isUnclaimedProfile({ status: " Pending " })).toBe(true);
  });
});

describe("canAccessMemberProfile", () => {
  test("hides an unclaimed profile from other members", () => {
    const profile = { _id: "p1", userId: "u1", status: "pending" };
    expect(canAccessMemberProfile({ profile, user: activeUser })).toBe(false);
  });

  test("shows it once the person it describes has claimed it", () => {
    const profile = { _id: "p1", userId: "u1", status: "active" };
    expect(canAccessMemberProfile({ profile, user: activeUser })).toBe(true);
  });

  // The pending check must not have displaced the rules that were already there.
  test("still hides removed profiles and profiles of inactive users", () => {
    expect(canAccessMemberProfile({
      profile: { _id: "p1", userId: "u1", status: "removed" },
      user: activeUser
    })).toBe(false);
    expect(canAccessMemberProfile({
      profile: { _id: "p1", userId: "u1", status: "active" },
      user: { _id: "u1", status: "inactive" }
    })).toBe(false);
    expect(isRemovedProfile({ status: "removed" })).toBe(true);
  });
});

describe("claimSummaryFromProfile", () => {
  const fullProfile = {
    firstName: " Dana ",
    lastName: "Reyes",
    cityState: "Brooklyn, NY",
    roleAtCamp: "Counselor",
    highSchool: "Midwood High School",
    colleges: ["Michigan", "  ", "NYU"],
    industry: "Design",
    currentJobs: [
      { role: "Product Designer", company: "Northwind", years: "2021-" },
      { role: "", company: "" }
    ],
    socials: {
      camperYears: { firstYear: "1998", firstGroup: "Cabin 7", lastYear: "2004", lastGroup: "CIT" },
      linkedin: "https://linkedin.com/in/dana"
    }
  };

  test("carries the fields someone would recognise themselves by", () => {
    const summary = claimSummaryFromProfile(fullProfile);
    expect(summary.firstName).toBe("Dana");
    expect(summary.lastName).toBe("Reyes");
    expect(summary.cityState).toBe("Brooklyn, NY");
    expect(summary.roleAtCamp).toBe("Counselor");
    expect(summary.highSchool).toBe("Midwood High School");
    expect(summary.industry).toBe("Design");
  });

  test("reads camp years out of the socials blob, ends only", () => {
    expect(claimSummaryFromProfile(fullProfile).campYears).toEqual(["1998", "2004"]);
  });

  test("drops blank entries rather than showing empty rows", () => {
    const summary = claimSummaryFromProfile(fullProfile);
    expect(summary.colleges).toEqual(["Michigan", "NYU"]);
    expect(summary.currentJobs).toEqual([{ role: "Product Designer", company: "Northwind" }]);
  });

  // An unclaimed row is reachable by anyone who signs up with a guessed address,
  // so the summary must never become a way to read someone's contact details.
  test("never exposes emails or phone numbers", () => {
    const summary = claimSummaryFromProfile({
      ...fullProfile,
      emails: ["dana@example.com"],
      phones: ["+1 555 0100"]
    });
    expect(JSON.stringify(summary)).not.toContain("dana@example.com");
    expect(JSON.stringify(summary)).not.toContain("555 0100");
  });

  test("survives a profile the questionnaire barely filled in", () => {
    const summary = claimSummaryFromProfile({ firstName: "Sam" });
    expect(summary.firstName).toBe("Sam");
    expect(summary.campYears).toEqual([]);
    expect(summary.colleges).toEqual([]);
    expect(summary.currentJobs).toEqual([]);
    expect(summary.cityState).toBe("");
  });

  test("tolerates a malformed socials blob instead of throwing", () => {
    expect(() => claimSummaryFromProfile({ socials: "not an object" })).not.toThrow();
    expect(claimSummaryFromProfile({ socials: "not an object" }).campYears).toEqual([]);
    expect(claimSummaryFromProfile({ socials: { camperYears: null } }).campYears).toEqual([]);
  });
});
