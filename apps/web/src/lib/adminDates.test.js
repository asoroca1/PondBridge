import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatDay, formatDayRange } from "./adminDates.js";

/**
 * The dashboard used to write dates four ways. Two of them were accidents: a
 * bare toLocaleDateString() in the donation ledger giving "9/2/2026", and a
 * cause's timeline printing the stored string, "2026-03-08", untouched.
 */

describe("formatDate", () => {
  it("writes the month in words, never as a number", () => {
    const shown = formatDate("2026-09-02T21:06:00.000Z");
    expect(shown).toMatch(/Sep/);
    // "9/2/2026" is what the ledger used to print.
    expect(shown).not.toMatch(/^\d{1,2}\/\d{1,2}\/\d{4}$/);
  });

  it("returns the fallback for a missing or unparseable value", () => {
    expect(formatDate("", "—")).toBe("—");
    expect(formatDate(null, "—")).toBe("—");
    expect(formatDate("not a date", "—")).toBe("—");
  });
});

describe("formatDateTime", () => {
  it("carries the time as well as the day", () => {
    const shown = formatDateTime("2026-09-02T21:06:00.000Z");
    expect(shown).toMatch(/Sep/);
    expect(shown).toMatch(/\d{1,2}:\d{2}/);
  });

  it("falls back the same way", () => {
    expect(formatDateTime(undefined, "—")).toBe("—");
  });
});

describe("formatDay", () => {
  it("keeps a date-only value on its own day", () => {
    // "2026-03-08" parses as midnight UTC. Formatted in local time anywhere west
    // of Greenwich that is the 7th, so a campaign starting on the 8th would be
    // shown starting a day early to every director in the Americas.
    expect(formatDay("2026-03-08")).toMatch(/Mar 8, 2026/);
  });

  it("does not print the stored string", () => {
    expect(formatDay("2026-03-08")).not.toBe("2026-03-08");
  });

  it("handles the turn of a year", () => {
    expect(formatDay("2027-01-01")).toMatch(/Jan 1, 2027/);
    expect(formatDay("2026-12-31")).toMatch(/Dec 31, 2026/);
  });
});

describe("formatDayRange", () => {
  it("names both ends when both are set", () => {
    expect(formatDayRange("2026-03-08", "2026-06-01")).toBe("Mar 8, 2026 — Jun 1, 2026");
  });

  it("uses each side's own wording when an end is open", () => {
    expect(
      formatDayRange("2026-03-08", "", { startFallback: "When approved", endFallback: "Ongoing" })
    ).toBe("Mar 8, 2026 — Ongoing");
    expect(
      formatDayRange("", "2026-06-01", { startFallback: "When approved", endFallback: "Ongoing" })
    ).toBe("When approved — Jun 1, 2026");
  });
});
