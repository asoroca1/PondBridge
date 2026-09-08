import { describe, expect, it } from "vitest";
import { validateGivingStep } from "./givingValidation.js";
const form = { title: "Camp fund", shortDescription: "A cause", category: "programs", description: "A complete description of our camp project.", coverImageUrl: "", goalDollars: "50.25", startDate: "", endDate: "" };
describe("giving proposal validation", () => {
  it("explains the field that needs attention", () => {
    expect(validateGivingStep({ ...form, title: " " }, 0)).toContain("cause name");
    expect(validateGivingStep({ ...form, description: "Short" }, 1)).toContain("30 characters");
    expect(validateGivingStep({ ...form, startDate: "2026-10-02", endDate: "2026-10-01" }, 2)).toContain("end date");
  });
  it("rejects non-finite goals and non-web image addresses", () => {
    for (const goalDollars of ["Infinity", "1e100", "0", "not money"]) expect(validateGivingStep({ ...form, goalDollars }, 2)).toContain("fundraising goal");
    expect(validateGivingStep({ ...form, coverImageUrl: "javascript:alert(1)" }, 1)).toContain("web address");
  });
  it("accepts a valid proposal including cents and optional blank dates", () => {
    for (const step of [0, 1, 2]) expect(validateGivingStep(form, step)).toBe("");
  });
});
