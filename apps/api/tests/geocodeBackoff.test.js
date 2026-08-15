import {
  cityKey,
  clearGeocodeFailure,
  recordGeocodeFailure,
  resetGeocodeFailures,
  shouldSkipGeocode
} from "../src/utils/geocode.js";

describe("geocode failure backoff", () => {
  beforeEach(() => {
    resetGeocodeFailures();
  });

  test("a city that has never failed is always attempted", () => {
    expect(shouldSkipGeocode("new-york-ny")).toBe(false);
  });

  test("a failure holds the city back for a while", () => {
    const now = Date.now();
    recordGeocodeFailure("remote", now);
    expect(shouldSkipGeocode("remote", now + 1000)).toBe(true);
  });

  test("the city is retried once the wait has passed", () => {
    const now = Date.now();
    recordGeocodeFailure("remote", now);
    expect(shouldSkipGeocode("remote", now + 61 * 1000)).toBe(false);
  });

  test("repeated failures wait progressively longer", () => {
    const now = Date.now();
    recordGeocodeFailure("nowhere", now);
    const afterFirst = shouldSkipGeocode("nowhere", now + 61 * 1000);

    recordGeocodeFailure("nowhere", now);
    recordGeocodeFailure("nowhere", now);
    recordGeocodeFailure("nowhere", now);
    const afterMany = shouldSkipGeocode("nowhere", now + 61 * 1000);

    expect(afterFirst).toBe(false);
    expect(afterMany).toBe(true);
  });

  test("a city that resolves is no longer held back", () => {
    const now = Date.now();
    recordGeocodeFailure("boston-ma", now);
    expect(shouldSkipGeocode("boston-ma", now + 1000)).toBe(true);

    clearGeocodeFailure("boston-ma");
    expect(shouldSkipGeocode("boston-ma", now + 1000)).toBe(false);
  });

  test("one failing city does not hold back a different one", () => {
    const now = Date.now();
    recordGeocodeFailure("remote", now);
    expect(shouldSkipGeocode("chicago-il", now + 1000)).toBe(false);
  });

  test("empty keys are ignored rather than tracked", () => {
    recordGeocodeFailure("");
    expect(shouldSkipGeocode("")).toBe(false);
  });
});

describe("cityKey", () => {
  test("spelling variations of the same place share a key", () => {
    expect(cityKey("New York", "NY")).toBe(cityKey(" new york ", " ny "));
  });

  test("different places do not collide", () => {
    expect(cityKey("Boston", "MA")).not.toBe(cityKey("Boston", "NY"));
  });
});
