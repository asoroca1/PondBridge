import { buildSuggestionResults } from "../src/routes/legacyCedarCompat.js";

function makeProfile(id, createdAt, overrides = {}) {
  return {
    _id: id,
    id,
    firstName: `Profile${id}`,
    lastName: "Test",
    avatarUrl: "",
    currentJobs: [],
    createdAt,
    ...overrides
  };
}

describe("buildSuggestionResults", () => {
  test("backfills ranked suggestions with fallback profiles up to the requested limit", () => {
    const rankedProfile = makeProfile("ranked-1", "2026-04-01T00:00:00.000Z");
    const fallbackProfiles = [
      rankedProfile,
      makeProfile("fallback-1", "2026-04-05T00:00:00.000Z"),
      makeProfile("fallback-2", "2026-04-04T00:00:00.000Z"),
      makeProfile("fallback-3", "2026-04-03T00:00:00.000Z"),
      makeProfile("fallback-4", "2026-04-02T00:00:00.000Z"),
      makeProfile("fallback-5", "2026-04-01T12:00:00.000Z")
    ];

    const items = buildSuggestionResults({
      primaryProfiles: [rankedProfile],
      fallbackProfiles,
      limit: 5
    });

    expect(items).toHaveLength(5);
    expect(items.map((item) => item.id)).toEqual([
      "ranked-1",
      "fallback-1",
      "fallback-2",
      "fallback-3",
      "fallback-4"
    ]);
  });

  test("falls back to the newest profiles when there are no ranked matches", () => {
    const items = buildSuggestionResults({
      primaryProfiles: [],
      fallbackProfiles: [
        makeProfile("oldest", "2026-04-01T00:00:00.000Z"),
        makeProfile("newest", "2026-04-03T00:00:00.000Z"),
        makeProfile("middle", "2026-04-02T00:00:00.000Z")
      ],
      limit: 2
    });

    expect(items.map((item) => item.id)).toEqual(["newest", "middle"]);
  });
});
