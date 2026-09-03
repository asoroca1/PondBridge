import { loadCampCounts } from "../src/services/superCampCounts.js";
import { ACTIVE_ALUMNI_FILTER } from "../src/services/alumniTotals.js";

function fakeProfileModel(rows) {
  const calls = [];
  return {
    calls,
    async count(filter = {}) {
      calls.push(filter);
      return rows.filter((row) =>
        Object.entries(filter).every(([key, value]) => row[key] === value)
      ).length;
    }
  };
}

// Cedar's real shape on 2026-09-03: 360 profile rows, two of them removed.
const CEDAR = [
  ...Array.from({ length: 358 }, () => ({ tenantId: "cedar", status: "active" })),
  { tenantId: "cedar", status: "removed" },
  { tenantId: "cedar", status: "removed" }
];

describe("super console camp counts", () => {
  test("members excludes removed profiles, matching the camp's own dashboard", async () => {
    const counts = await loadCampCounts("cedar", { profileModel: fakeProfileModel(CEDAR) });
    expect(counts).toEqual({ members: 358, profiles: 360 });
  });

  // The console must not grow a second definition of "how many members": it
  // asks with the shared filter, so changing that rule moves this count too.
  test("members is asked for with the shared alumni filter", async () => {
    const profileModel = fakeProfileModel(CEDAR);
    await loadCampCounts("cedar", { profileModel });

    expect(profileModel.calls).toContainEqual({ tenantId: "cedar", ...ACTIVE_ALUMNI_FILTER });
  });

  // The console shows members only, so nothing should pay for a removed count.
  test("does not query for a count no surface displays", async () => {
    const profileModel = fakeProfileModel(CEDAR);
    await loadCampCounts("cedar", { profileModel });

    expect(profileModel.calls).toHaveLength(2);
    expect(profileModel.calls).not.toContainEqual({ tenantId: "cedar", status: "removed" });
  });

  test("every count is scoped to the camp asked for", async () => {
    const profileModel = fakeProfileModel([
      ...CEDAR,
      { tenantId: "other", status: "active" },
      { tenantId: "other", status: "active" }
    ]);
    const counts = await loadCampCounts("cedar", { profileModel });

    expect(counts.members).toBe(358);
    expect(profileModel.calls.every((call) => call.tenantId === "cedar")).toBe(true);
  });

  test("a camp with no members reports zeroes, not undefined", async () => {
    const counts = await loadCampCounts("empty", { profileModel: fakeProfileModel([]) });
    expect(counts).toEqual({ members: 0, profiles: 0 });
  });
});
