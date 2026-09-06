import { jest } from "@jest/globals";

/**
 * findAllBatched walks by keyset on `id`. If the caller's `select` leaves `id`
 * out, the cursor is undefined and the walk stops after one batch — quietly, and
 * with a partial answer that looks complete.
 *
 * That is the exact failure this method exists to prevent, and it had already
 * caught two callers: the alumni total beside the map (select: ["userId"]) and
 * the role/year rollup (select: ["roleAtCamp", "collegeYears"]) were each
 * reading 500 rows of a 2,871-member camp while their comments said they had
 * been fixed for the 1,000-row ceiling.
 *
 * So the fix belongs in the primitive, and this pins it there.
 */

const BATCH = 500;
const TOTAL = 1300;

function fakeSupabase(rows) {
  const selects = [];
  return {
    selects,
    client: {
      from() {
        const state = { gt: null, limit: BATCH, cols: "*" };
        const builder = {
          select(cols) {
            state.cols = cols;
            selects.push(cols);
            return builder;
          },
          eq: () => builder,
          gt(_col, value) {
            state.gt = value;
            return builder;
          },
          order: () => builder,
          limit(n) {
            state.limit = n;
            return builder;
          },
          then(resolve) {
            const after = state.gt ? rows.filter((r) => r.id > state.gt) : rows;
            const page = after.slice(0, state.limit);
            // Return only the columns asked for, exactly as PostgREST would.
            const cols = state.cols === "*" ? null : state.cols.split(",");
            const shaped = page.map((row) =>
              cols ? Object.fromEntries(cols.map((c) => [c, row[c]])) : row
            );
            return Promise.resolve(resolve({ data: shaped, error: null }));
          }
        };
        return builder;
      }
    }
  };
}

const rows = Array.from({ length: TOTAL }, (_unused, index) => ({
  id: `p${String(index + 1).padStart(5, "0")}`,
  tenant_id: "t1",
  user_id: `u${index + 1}`,
  city_state: "Boston, MA"
}));

const fake = fakeSupabase(rows);
jest.unstable_mockModule("../src/db/supabaseAdmin.js", () => ({
  getSupabaseAdmin: () => fake.client
}));

const { ProfileModel } = await import("../src/db/models/ProfileModel.js");

async function collect(batches) {
  const out = [];
  for await (const page of batches) out.push(...page);
  return out;
}

describe("findAllBatched with a narrow select", () => {
  beforeEach(() => {
    fake.selects.length = 0;
  });

  it("still reads every row when the caller did not ask for id", async () => {
    const all = await collect(
      ProfileModel.findAllBatched("t1", {}, { select: ["userId"] })
    );
    expect(all).toHaveLength(TOTAL);
  });

  it("asks the database for id even so, because that is what it pages on", async () => {
    await collect(ProfileModel.findAllBatched("t1", {}, { select: ["userId"] }));
    expect(fake.selects[0].split(",")).toContain("id");
  });

  it("does not ask for id twice when the caller already included it", async () => {
    await collect(ProfileModel.findAllBatched("t1", {}, { select: ["id", "userId"] }));
    const cols = fake.selects[0].split(",");
    expect(cols.filter((c) => c === "id")).toHaveLength(1);
  });

  it("still returns the columns the caller asked for", async () => {
    const all = await collect(
      ProfileModel.findAllBatched("t1", {}, { select: ["userId"] })
    );
    expect(all[0]).toHaveProperty("userId", "u1");
  });
});
