import {
  addSuggestionContext,
  buildSuggestionResults
} from "../src/routes/legacyCedarCompat.js";

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

  test("adds safe recommendation context without exposing private matching fields", () => {
    const sharedProfile = makeProfile("shared", "2026-04-03T00:00:00.000Z");
    const recentProfile = makeProfile("recent", "2026-04-02T00:00:00.000Z");
    const items = buildSuggestionResults({
      primaryProfiles: [sharedProfile],
      fallbackProfiles: [recentProfile],
      limit: 2
    });

    const contextualItems = addSuggestionContext({
      items,
      scoredProfiles: [{ profile: sharedProfile, score: 9, reasons: ["location", "company"] }],
      mode: "personalized"
    });

    expect(contextualItems[0].recommendation).toEqual({
      kind: "shared_profile",
      label: "Strong shared profile signals"
    });
    expect(contextualItems[1].recommendation).toEqual({
      kind: "recent_member",
      label: "Recently joined"
    });
    expect(JSON.stringify(contextualItems)).not.toContain("location");
    expect(JSON.stringify(contextualItems)).not.toContain("company");
  });
});
