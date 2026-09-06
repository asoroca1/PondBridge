import { jest } from "@jest/globals";

/**
 * The alumni map's pin counts, now that the grouping happens in the database.
 *
 * `aggregateCityCounts` used to receive one row per member and add one per row.
 * It now receives one row per distinct city string with a count attached, and
 * has to add that count instead. The difference is invisible until two spellings
 * collapse to the same pin: "St. Louis, MO" and "St Louis, MO" are separate rows
 * out of the database and one pin on the map, and a fold that still added one
 * would report two members there instead of the ninety they represent.
 */

const TENANT_ID = "tenant_cedar";

const cityStateCounts = jest.fn();

jest.unstable_mockModule("../src/db/models/ProfileModel.js", () => ({
  ProfileModel: { cityStateCounts }
}));

const { aggregateCityCounts } = await import("../src/services/cityCounts.js");

beforeEach(() => {
  cityStateCounts.mockReset();
});

function pinsByKey(rows) {
  return new Map(rows.map((row) => [row.key, row]));
}

describe("map pin counts", () => {
  it("adds each row's count rather than counting the row", async () => {
    cityStateCounts.mockResolvedValue([
      { cityState: "Boston, MA", count: 412 },
      { cityState: "New York, NY", count: 305 }
    ]);

    const pins = pinsByKey(await aggregateCityCounts(TENANT_ID));
    expect(pins.get("boston-ma").count).toBe(412);
    expect(pins.get("new-york-ny").count).toBe(305);
  });

  it("sums the spellings that land on one pin", async () => {
    cityStateCounts.mockResolvedValue([
      { cityState: "St. Louis, MO", count: 60 },
      { cityState: "St Louis, MO", count: 30 }
    ]);

    const pins = pinsByKey(await aggregateCityCounts(TENANT_ID));
    expect(pins.size).toBe(1);
    expect(pins.get("st-louis-mo").count).toBe(90);
  });

  it("still parses the shapes the free-text column holds", async () => {
    cityStateCounts.mockResolvedValue([
      { cityState: "Ann Arbor MI", count: 5 },
      { cityState: "San Francisco", count: 7 },
      { cityState: "a, b, c", count: 2 }
    ]);

    const pins = pinsByKey(await aggregateCityCounts(TENANT_ID));
    expect(pins.get("ann-arbor-mi")).toMatchObject({ city: "Ann Arbor", state: "MI", count: 5 });
    expect(pins.get("san-francisco")).toMatchObject({ city: "San Francisco", state: "", count: 7 });
    // `split(",", 2)` keeps only the second piece as the state.
    expect(pins.get("a-b")).toMatchObject({ city: "a", state: "B", count: 2 });
  });

  it("drops rows that cannot produce a pin", async () => {
    cityStateCounts.mockResolvedValue([
      { cityState: "   ", count: 4 },
      { cityState: "---", count: 3 },
      { cityState: "Denver, CO", count: 11 }
    ]);

    const pins = pinsByKey(await aggregateCityCounts(TENANT_ID));
    expect(pins.size).toBe(1);
    expect(pins.get("denver-co").count).toBe(11);
  });

  it("passes the viewer's hidden members through to the query", async () => {
    cityStateCounts.mockResolvedValue([]);
    const hidden = new Set(["u1", "u2"]);
    await aggregateCityCounts(TENANT_ID, { hiddenUserIds: hidden });
    expect(cityStateCounts).toHaveBeenCalledWith(TENANT_ID, hidden);
  });
});
