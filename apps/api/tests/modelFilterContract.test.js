import { jest } from "@jest/globals";

/**
 * The model factory used to fail open in two ways that produced wrong answers
 * without ever raising an error:
 *
 *  - a filter key the column map did not know was dropped, so a typo widened
 *    the query to every row the tenant scope allowed;
 *  - every `find` asked Postgres for an exact count, so ordinary reads paid
 *    for a total that almost no caller read.
 *
 * Both are contracts now, and this file is what holds them.
 */

const selectCalls = [];
// When set, the mock serves rows from here, honouring .gt("id", cursor),
// .limit() and ascending id order the way PostgREST would.
let tableRows = null;

function makeQuery() {
  const q = {
    _after: null,
    _limit: null,
    eq() { return this; },
    neq() { return this; },
    in() { return this; },
    gt(col, value) {
      if (col === "id") this._after = value;
      return this;
    },
    gte() { return this; },
    lt() { return this; },
    lte() { return this; },
    is() { return this; },
    not() { return this; },
    or() { return this; },
    contains() { return this; },
    ilike() { return this; },
    filter() { return this; },
    order() { return this; },
    limit(n) {
      this._limit = n;
      return this;
    },
    range() { return this; },
    maybeSingle() { return Promise.resolve({ data: null, error: null }); },
    then(resolve) {
      if (!tableRows) {
        return Promise.resolve({ data: [], error: null, count: 7 }).then(resolve);
      }
      const after = this._after;
      const page = tableRows
        .filter((row) => (after ? row.id > after : true))
        .slice(0, this._limit ?? tableRows.length);
      return Promise.resolve({ data: page, error: null, count: tableRows.length }).then(resolve);
    }
  };
  return q;
}

jest.unstable_mockModule("../src/db/supabaseAdmin.js", () => ({
  getSupabaseAdmin: () => ({
    from() {
      const q = makeQuery();
      return {
        select: (cols, opts) => {
          selectCalls.push({ cols, opts });
          return q;
        }
      };
    }
  })
}));

const { createModel } = await import("../src/db/models/_factory.js");

const Photo = createModel("photos", {
  id: "id",
  tenantId: "tenant_id",
  caption: "caption",
  metadata: "metadata",
  createdAt: "created_at",
  updatedAt: "updated_at"
});

const TENANT = "tenant-1";

beforeEach(() => {
  selectCalls.length = 0;
  tableRows = null;
});

describe("filters fail closed", () => {
  it("rejects a field that is not in the column map", async () => {
    await expect(Photo.find(TENANT, { capiton: "hi" })).rejects.toThrow(
      /Unknown filter on table "photos".*capiton/s
    );
  });

  it("rejects an operator the translator does not support", async () => {
    await expect(Photo.find(TENANT, { caption: { $regex: "hi" } })).rejects.toThrow(
      /\$regex/
    );
  });

  it("rejects an unsupported operator on _id", async () => {
    await expect(Photo.find(TENANT, { _id: { $gt: "abc" } })).rejects.toThrow(/\$gt/);
  });

  it("rejects a dotted path whose base field is unmapped", async () => {
    await expect(Photo.find(TENANT, { "summary.errorCount": 1 })).rejects.toThrow();
  });

  it("still accepts the filters the models actually use", async () => {
    await expect(
      Photo.find(TENANT, {
        caption: { $ilike: "%swim%" },
        createdAt: { $gte: new Date("2026-01-01") },
        _id: { $in: ["a", "b"] },
        "metadata.errorCount": { $gt: 0 }
      })
    ).resolves.toEqual([]);
  });

  it("applies the same contract to count and updateMany", async () => {
    await expect(Photo.count(TENANT, { capiton: "hi" })).rejects.toThrow(/capiton/);
  });
});

describe("counts are opt-in", () => {
  it("does not ask for a count on an ordinary read", async () => {
    const rows = await Photo.find(TENANT, {}, { limit: 20 });
    expect(selectCalls.at(-1).opts).toBeUndefined();
    expect(rows._count).toBeUndefined();
  });

  it("asks for an exact count only when the caller wants a total", async () => {
    const rows = await Photo.find(TENANT, {}, { limit: 20, count: true });
    expect(selectCalls.at(-1).opts).toEqual({ count: "exact" });
    expect(rows._count).toBe(7);
  });

  it("keeps count() a head-only query", async () => {
    await Photo.count(TENANT, {});
    expect(selectCalls.at(-1).opts).toEqual({ count: "exact", head: true });
  });
});

describe("findAllBatched walks the whole table", () => {
  // Ids are zero-padded so string comparison matches the keyset order the
  // database would use.
  const rows = Array.from({ length: 1250 }, (_, i) => ({
    id: `row-${String(i).padStart(5, "0")}`,
    tenant_id: TENANT,
    caption: `photo ${i}`
  }));

  it("returns every row past the 1,000-row PostgREST cap", async () => {
    tableRows = rows;
    const seen = [];
    for await (const page of Photo.findAllBatched(TENANT, {}, { batchSize: 400 })) {
      expect(page.length).toBeLessThanOrEqual(400);
      seen.push(...page);
    }
    expect(seen).toHaveLength(1250);
    expect(new Set(seen.map((r) => r._id)).size).toBe(1250);
  });

  it("pages by keyset rather than offset, so no page is re-read", async () => {
    tableRows = rows.slice(0, 900);
    const pages = [];
    for await (const page of Photo.findAllBatched(TENANT, {}, { batchSize: 300 })) {
      pages.push(page.map((r) => r._id));
    }
    expect(pages).toHaveLength(3);
    expect(pages[1][0] > pages[0].at(-1)).toBe(true);
  });

  it("refuses to scan past maxRows instead of reading forever", async () => {
    tableRows = rows;
    const walk = async () => {
      // eslint-disable-next-line no-unused-vars
      for await (const _page of Photo.findAllBatched(TENANT, {}, { batchSize: 400, maxRows: 500 })) {
        // drain
      }
    };
    await expect(walk()).rejects.toThrow(/maxRows/);
  });

  it("still refuses an unscoped scan of a tenant table", async () => {
    tableRows = rows;
    const walk = async () => {
      // eslint-disable-next-line no-unused-vars
      for await (const _page of Photo.findAllBatched({})) {
        // drain
      }
    };
    await expect(walk()).rejects.toThrow(/unscoped findAllBatched/);
  });
});
