import { jest } from "@jest/globals";

/**
 * Tenant isolation is an invariant, not a convention.
 *
 * The API talks to Supabase with the service role key, which bypasses RLS, so
 * these guards in the model factory are the only thing standing between one
 * camp's request and another camp's rows. If someone relaxes them, this file
 * should fail before the change reaches a customer.
 */

const captured = [];

function makeQuery() {
  const q = {
    filters: [],
    eq(col, value) {
      this.filters.push([col, value]);
      return this;
    },
    in() { return this; },
    gte() { return this; },
    lte() { return this; },
    gt() { return this; },
    lt() { return this; },
    neq() { return this; },
    is(col, value) {
      this.filters.push([col, value]);
      return this;
    },
    not() { return this; },
    or() { return this; },
    contains() { return this; },
    order() { return this; },
    limit() { return this; },
    range() { return this; },
    maybeSingle() { return Promise.resolve({ data: null, error: null }); },
    single() { return Promise.resolve({ data: null, error: null }); },
    select() { return this; },
    then(resolve) { return Promise.resolve({ data: [], error: null, count: 0 }).then(resolve); }
  };
  return q;
}

jest.unstable_mockModule("../src/db/supabaseAdmin.js", () => ({
  getSupabaseAdmin: () => ({
    from(table) {
      const q = makeQuery();
      captured.push({ table, query: q });
      return {
        select: () => q,
        update: () => q,
        delete: () => q,
        insert: () => q,
        upsert: () => q
      };
    }
  })
}));

const { createModel } = await import("../src/db/models/_factory.js");

const PhotoLike = createModel("photos", {
  id: "id",
  tenantId: "tenant_id",
  ownerId: "owner_id",
  caption: "caption",
  createdAt: "created_at",
  updatedAt: "updated_at"
});

// A table with no tenant_id column must stay queryable without a tenant.
const GlobalLike = createModel("identity_users", {
  id: "id",
  email: "email",
  createdAt: "created_at",
  updatedAt: "updated_at"
});

beforeEach(() => {
  captured.length = 0;
});

describe("tenant isolation is enforced in the data layer", () => {
  test.each(["find", "findOne", "count"])(
    "%s on a tenant-scoped table refuses to run without a tenant",
    async (method) => {
      await expect(PhotoLike[method]({ ownerId: "u1" })).rejects.toThrow(
        /Refusing unscoped .* tenant-scoped table "photos"/
      );
    }
  );

  test("updateMany refuses to run without a tenant", async () => {
    await expect(PhotoLike.updateMany({ ownerId: "u1" }, { caption: "x" })).rejects.toThrow(
      /Refusing unscoped updateMany/
    );
  });

  test("deleteMany refuses to run without a tenant", async () => {
    await expect(PhotoLike.deleteMany({ ownerId: "u1" })).rejects.toThrow(
      /Refusing unscoped deleteMany/
    );
  });

  test("a tenant passed positionally satisfies the guard and filters the query", async () => {
    await PhotoLike.find("tenant-a", { ownerId: "u1" });
    const call = captured.at(-1);
    expect(call.table).toBe("photos");
    expect(call.query.filters).toContainEqual(["tenant_id", "tenant-a"]);
  });

  test("a tenant named in the filter also satisfies the guard", async () => {
    await expect(PhotoLike.find({ tenantId: "tenant-a" })).resolves.toBeDefined();
  });

  test("an explicit tenantId of null is treated as deliberate scope", async () => {
    // This is how platform-level rows (super admins) are addressed.
    await expect(PhotoLike.find({ tenantId: null })).resolves.toBeDefined();
  });

  test("an undefined tenantId is a mistake, not intent", async () => {
    await expect(PhotoLike.find({ tenantId: undefined })).rejects.toThrow(
      /Refusing unscoped find/
    );
  });

  test("tables without a tenant_id column are unaffected", async () => {
    await expect(GlobalLike.find({ email: "a@b.test" })).resolves.toBeDefined();
  });
});

describe("acrossTenants is the only way past the guard", () => {
  test("it allows a deliberately platform-wide read", async () => {
    await expect(
      PhotoLike.acrossTenants().find({ ownerId: "u1" })
    ).resolves.toBeDefined();
  });

  test("it does not add a tenant filter", async () => {
    await PhotoLike.acrossTenants().find({ ownerId: "u1" });
    const call = captured.at(-1);
    expect(call.query.filters.map(([col]) => col)).not.toContain("tenant_id");
  });

  test("the scoped model is not mutated by using the escape hatch", async () => {
    PhotoLike.acrossTenants();
    await expect(PhotoLike.find({ ownerId: "u1" })).rejects.toThrow(/Refusing unscoped/);
  });
});

describe("id lookups can be tenant-scoped", () => {
  test("findByIdScoped constrains on both id and tenant", async () => {
    await PhotoLike.findByIdScoped("tenant-a", "photo-1");
    const call = captured.at(-1);
    expect(call.query.filters).toContainEqual(["id", "photo-1"]);
    expect(call.query.filters).toContainEqual(["tenant_id", "tenant-a"]);
  });

  test("updateScoped constrains on both id and tenant", async () => {
    await PhotoLike.updateScoped("tenant-a", "photo-1", { caption: "hello" });
    const call = captured.at(-1);
    expect(call.query.filters).toContainEqual(["id", "photo-1"]);
    expect(call.query.filters).toContainEqual(["tenant_id", "tenant-a"]);
  });

  test("scoped id lookups refuse a missing tenant rather than widening", async () => {
    await expect(PhotoLike.findByIdScoped("", "photo-1")).resolves.toBeNull();
    await expect(PhotoLike.updateScoped("", "photo-1", { caption: "x" })).resolves.toBeNull();
  });
});
