import { describe, expect, it } from "vitest";
import { summaryRows } from "./TenantClaimProfilePage.jsx";

const summary = {
  firstName: "Dana",
  lastName: "Reyes",
  roleAtCamp: "Counselor",
  campYears: ["1998", "2004"],
  cityState: "Brooklyn, NY",
  highSchool: "Midwood High School",
  colleges: ["Michigan", "NYU"],
  currentJobs: [{ role: "Product Designer", company: "Northwind" }],
  industry: "Design"
};

describe("summaryRows", () => {
  it("leads with the name, then camp, then life since", () => {
    expect(summaryRows(summary).map(([label]) => label)).toEqual([
      "Name",
      "At camp",
      "Years",
      "Lives in",
      "High school",
      "College",
      "Work",
      "Industry"
    ]);
  });

  it("formats the values a person actually reads", () => {
    const rows = Object.fromEntries(summaryRows(summary));
    expect(rows.Name).toBe("Dana Reyes");
    expect(rows.Years).toBe("1998–2004");
    expect(rows.College).toBe("Michigan, NYU");
    expect(rows.Work).toBe("Product Designer at Northwind");
  });

  // Most questionnaire answers come back mostly empty, so the common case is a
  // card with three rows, not eight. Empty rows would read as missing data the
  // person is expected to explain.
  it("omits everything the questionnaire left blank", () => {
    const rows = summaryRows({ firstName: "Sam", cityState: "", colleges: [], currentJobs: [] });
    expect(rows).toEqual([["Name", "Sam"]]);
  });

  it("returns nothing at all when only an email address was imported", () => {
    expect(summaryRows({})).toEqual([]);
    expect(summaryRows()).toEqual([]);
  });

  it("keeps a job with only a company, and drops one with neither", () => {
    const rows = Object.fromEntries(summaryRows({ currentJobs: [{ role: "", company: "Northwind" }] }));
    expect(rows.Work).toBe("Northwind");
    expect(summaryRows({ currentJobs: [{ role: "", company: "" }] })).toEqual([]);
  });

  it("shows a single camp year without a dangling dash", () => {
    const rows = Object.fromEntries(summaryRows({ campYears: ["1998"] }));
    expect(rows.Years).toBe("1998");
  });
});
