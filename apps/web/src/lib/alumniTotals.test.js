import { describe, expect, test } from "vitest";
import { formatMappedAlumniSummary } from "./alumniTotals.js";

describe("formatMappedAlumniSummary", () => {
  test("says how many of the network reached the map when some are missing", () => {
    expect(formatMappedAlumniSummary({ mapped: 314, total: 344, cities: 139 }))
      .toBe("314 of 344 alumni across 139 cities");
  });

  test("states a single number once every member is on a pin", () => {
    expect(formatMappedAlumniSummary({ mapped: 344, total: 344, cities: 139 }))
      .toBe("344 alumni across 139 cities");
  });

  test("never claims more mapped than the network total it was handed", () => {
    // An older cached response carries no total; the mapped count stands alone
    // rather than rendering as "314 of 0".
    expect(formatMappedAlumniSummary({ mapped: 314, total: 0, cities: 139 }))
      .toBe("314 alumni across 139 cities");
  });

  test("uses the camp's own word for its alumni", () => {
    expect(formatMappedAlumniSummary({ mapped: 12, total: 12, cities: 1, alumniWord: "campers" }))
      .toBe("12 campers across 1 city");
  });
});
