import { getSupabaseAdmin } from "../supabaseAdmin.js";
import { generateObjectId } from "../../utils/objectId.js";

const NODE_ENV = String(process.env.NODE_ENV || "").trim().toLowerCase();
const ALLOW_UNSCOPED_DELETES = String(process.env.PONDBRIDGE_ALLOW_UNSCOPED_DELETES || "")
  .trim()
  .toLowerCase() === "1";

/**
 * A filter key the model does not recognise used to be dropped silently. That
 * turned a typo, or a field someone forgot to add to the column map, into a
 * query over every row the tenant scope allowed — wrong results and a runaway
 * read at the same time. Filters now fail closed.
 *
 * Outside production the mistake throws, so it surfaces in development and CI
 * where it is cheap to fix. In production the clause is dropped and logged
 * instead: a live request degrading is better than a 500, and the log names
 * the exact table and key to fix.
 */
const STRICT_FILTERS = NODE_ENV !== "production";

export class UnknownFilterError extends Error {
  constructor(message) {
    super(message);
    this.name = "UnknownFilterError";
    this.code = "UNKNOWN_FILTER";
    // Routes that pass client-supplied filters straight through should answer
    // 400 rather than 500 — the caller asked for something that cannot exist.
    this.status = 400;
  }
}

function rejectUnknownFilter(tableName, detail) {
  const message = `Unknown filter on table "${tableName || "?"}": ${detail}.`;
  if (STRICT_FILTERS) throw new UnknownFilterError(message);
  console.warn(`[model] ${message} Clause ignored.`);
}

function normalizeId(value = "") {
  return String(value || "").trim();
}

function hasFilterScope(filter) {
  return Boolean(
    filter &&
      typeof filter === "object" &&
      !Array.isArray(filter) &&
      Object.keys(filter).length > 0
  );
}

/**
 * Tenant isolation is enforced here rather than left to each caller.
 *
 * Every read and bulk write on a tenant-scoped table must name its tenant.
 * Previously the tenant id was optional: omitting it silently widened the
 * query to every camp on the platform, so the guarantee rested on ~370 call
 * sites each being written correctly, forever. The API connects with the
 * Supabase service role, which bypasses RLS, so there is no database backstop
 * behind this check.
 *
 * Genuinely global reads (super admin, identity lookup by email, device token
 * lookup) must say so out loud via `Model.acrossTenants()`, which is greppable
 * and auditable.
 */
function filterNamesTenant(filter) {
  if (!filter || typeof filter !== "object" || Array.isArray(filter)) return false;
  const hasKey =
    Object.prototype.hasOwnProperty.call(filter, "tenantId") ||
    Object.prototype.hasOwnProperty.call(filter, "tenant_id");
  if (!hasKey) return false;
  // Read the key that is actually present; `??` would skip a deliberate null.
  const value = Object.prototype.hasOwnProperty.call(filter, "tenantId")
    ? filter.tenantId
    : filter.tenant_id;
  // `tenantId: null` is how platform-level rows (super admins) are addressed,
  // which is an explicit scope decision. `undefined` is a mistake, not intent.
  if (value === undefined) return false;
  if (value === null) return true;
  // `{ tenantId: { $in: [...] } }` is a deliberate multi-tenant read and still
  // names the tenants it touches.
  if (typeof value === "object") return Object.keys(value).length > 0;
  return Boolean(normalizeId(value));
}

function assertTenantScope({ tableName = "", tenantId = "", method = "", filter = null } = {}) {
  if (normalizeId(tenantId) || filterNamesTenant(filter)) return;
  throw new Error(
    `Refusing unscoped ${method} on tenant-scoped table "${tableName}". ` +
      `Pass a tenantId, or use ${tableName}Model.acrossTenants().${method}() if the query is deliberately platform-wide.`
  );
}

function assertDeleteManyScope({ tableName = "", tenantId = "", filter = {} } = {}) {
  const normalizedTenantId = normalizeId(tenantId);
  if (normalizedTenantId || hasFilterScope(filter)) return normalizedTenantId;
  if (NODE_ENV === "test" || ALLOW_UNSCOPED_DELETES) return normalizedTenantId;

  throw new Error(
    `Refusing unscoped deleteMany on table "${tableName}". Provide tenant scope or a non-empty filter.`
  );
}

// ---------------------------------------------------------------------------
// Column mapping helpers
// ---------------------------------------------------------------------------

export function toRow(doc, colMap) {
  const row = {};
  for (const [camel, snake] of Object.entries(colMap)) {
    if (camel in doc) row[snake] = doc[camel];
  }
  return row;
}

export function toDoc(row, colMap) {
  if (!row) return null;
  const doc = {};
  for (const [camel, snake] of Object.entries(colMap)) {
    if (snake in row) doc[camel] = row[snake];
  }
  doc._id = doc.id;
  return doc;
}

function toDocs(rows, colMap) {
  if (!rows) return [];
  return rows.map((r) => toDoc(r, colMap));
}

function normalizeFilterOperand(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.map((item) => (item instanceof Date ? item.toISOString() : item));
  }
  return value;
}

// ---------------------------------------------------------------------------
// Filter translation — converts Mongoose-style filters to Supabase query
// ---------------------------------------------------------------------------

function applyFilter(query, filter, colMap, tableName = "") {
  for (const [key, value] of Object.entries(filter)) {
    if (key === "_id") {
      if (typeof value === "object" && !Array.isArray(value) && !(value instanceof Date) && value !== null) {
        // Operator object on _id, e.g. { $in: [...] }
        for (const [op, operand] of Object.entries(value)) {
          switch (op) {
            case "$in":
              query = query.in("id", operand);
              break;
            case "$eq":
              query = query.eq("id", operand);
              break;
            case "$ne":
            case "$neq":
              query = query.neq("id", operand);
              break;
            default:
              rejectUnknownFilter(tableName, `operator "${op}" is not supported on _id`);
              break;
          }
        }
      } else {
        query = query.eq("id", value);
      }
      continue;
    }
    // ------------------------------------------------------------------
    // JSONB dotted-path support (e.g. "summary.errorCount": { $gt: 0 })
    // Splits on "." — the first segment is mapped via colMap, the rest
    // are treated as JSONB arrow traversals (->), and operators use
    // Supabase's raw .filter() so PostgREST handles type coercion.
    // ------------------------------------------------------------------
    if (key.includes(".")) {
      const parts = key.split(".");
      const baseCol = colMap[parts[0]];
      if (!baseCol) {
        rejectUnknownFilter(tableName, `"${key}" has no column for base field "${parts[0]}"`);
        continue;
      }
      const jsonbPath = parts.slice(1).reduce((path, seg) => `${path}->${seg}`, baseCol);

      if (value === null || value === undefined) {
        query = query.is(jsonbPath, null);
      } else if (typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
        for (const [op, operand] of Object.entries(value)) {
          const normalizedOperand = normalizeFilterOperand(operand);
          switch (op) {
            case "$eq":  query = query.filter(jsonbPath, "eq", normalizedOperand);  break;
            case "$ne":
            case "$neq": query = query.filter(jsonbPath, "neq", normalizedOperand); break;
            case "$gt":  query = query.filter(jsonbPath, "gt", normalizedOperand);  break;
            case "$gte": query = query.filter(jsonbPath, "gte", normalizedOperand); break;
            case "$lt":  query = query.filter(jsonbPath, "lt", normalizedOperand);  break;
            case "$lte": query = query.filter(jsonbPath, "lte", normalizedOperand); break;
            default:
              rejectUnknownFilter(tableName, `operator "${op}" is not supported on "${key}"`);
              break;
          }
        }
      } else {
        query = query.filter(jsonbPath, "eq", normalizeFilterOperand(value));
      }
      continue;
    }

    const col = colMap[key];
    if (!col) {
      rejectUnknownFilter(tableName, `"${key}" is not a mapped field`);
      continue;
    }

    if (value === null || value === undefined) {
      query = query.is(col, null);
    } else if (typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
        // Operator object, e.g. { $in: [...], $gte: date }
      for (const [op, operand] of Object.entries(value)) {
        const normalizedOperand = normalizeFilterOperand(operand);
        switch (op) {
          case "$eq":
            query = query.eq(col, normalizedOperand);
            break;
          case "$ne":
          case "$neq":
            query = query.neq(col, normalizedOperand);
            break;
          case "$gt":
            query = query.gt(col, normalizedOperand);
            break;
          case "$gte":
            query = query.gte(col, normalizedOperand);
            break;
          case "$lt":
            query = query.lt(col, normalizedOperand);
            break;
          case "$lte":
            query = query.lte(col, normalizedOperand);
            break;
          case "$in":
            query = query.in(col, normalizedOperand);
            break;
          case "$nin":
            query = query.not(col, "in", `(${normalizedOperand.join(",")})`);
            break;
          case "$contains":
            query = query.contains(col, normalizedOperand);
            break;
          case "$ilike":
            query = query.ilike(col, normalizedOperand);
            break;
          default:
            rejectUnknownFilter(tableName, `operator "${op}" is not supported on "${key}"`);
            break;
        }
      }
    } else {
      query = query.eq(col, normalizeFilterOperand(value));
    }
  }
  return query;
}

// ---------------------------------------------------------------------------
// Sort translation
// ---------------------------------------------------------------------------

function applySort(query, sort, colMap) {
  if (!sort) return query;
  for (const [key, dir] of Object.entries(sort)) {
    const col = key === "_id" ? "id" : colMap[key] || key;
    query = query.order(col, { ascending: dir === 1 || dir === "asc" });
  }
  return query;
}

// ---------------------------------------------------------------------------
// createModel factory
// ---------------------------------------------------------------------------

export function createModel(tableName, colMap) {
  const sb = () => getSupabaseAdmin();
  // Only tables that carry a tenant_id can be scoped; `tenants` itself and the
  // identity tables are platform-wide by nature.
  const isTenantScoped = Object.prototype.hasOwnProperty.call(colMap, "tenantId");

  const buildModel = (enforceScope) => ({
    tableName,
    colMap,

    // ----- READ -----

    async find(tenantIdOrFilter = {}, filter = {}, options = {}) {
      let tenantId, actualFilter, actualOpts;

      if (typeof tenantIdOrFilter === "string") {
        tenantId = tenantIdOrFilter;
        actualFilter = filter;
        actualOpts = options;
      } else {
        tenantId = null;
        actualFilter = tenantIdOrFilter;
        actualOpts = filter;
      }

      if (enforceScope && isTenantScoped) assertTenantScope({ tableName, tenantId, method: "find", filter: actualFilter });
      const selectCols = actualOpts.select
        ? actualOpts.select
            .map((c) => (c === "_id" ? "id" : colMap[c] || c))
            .join(",")
        : "*";

      // An exact count is a second pass over the matching rows. It used to run
      // on every find, including the great majority that only read `docs` — so
      // ordinary reads paid for a total nobody looked at. Callers that need a
      // total now ask for it with `{ count: true }`, or call `Model.count()`.
      let query = actualOpts.count
        ? sb().from(tableName).select(selectCols, { count: "exact" })
        : sb().from(tableName).select(selectCols);

      if (tenantId) query = query.eq("tenant_id", tenantId);
      query = applyFilter(query, actualFilter, colMap, tableName);
      query = applySort(query, actualOpts.sort, colMap);

      if (actualOpts.limit) query = query.limit(actualOpts.limit);
      if (actualOpts.offset) {
        query = query.range(
          actualOpts.offset,
          actualOpts.offset + (actualOpts.limit || 1000) - 1
        );
      }

      const { data, error, count } = await query;
      if (error) throw error;
      const docs = toDocs(data, colMap);
      // Left undefined when uncounted, so `_count ?? fallback` stays honest
      // rather than reporting a page length as a total.
      if (actualOpts.count) docs._count = count;
      return docs;
    },

    /**
     * Read every matching row, in pages, without ever asking for "all" at once.
     *
     * PostgREST caps an uncapped select (1,000 rows by default) and says
     * nothing when it truncates, so `find()` with no limit quietly returned a
     * partial answer on any table that outgrew the cap — imports, analytics,
     * deletion cleanup and notification fan-out all read that way. Pages here
     * are keyset-walked on the primary key rather than offset-walked, so a row
     * inserted mid-scan cannot shift the window and hide its neighbour, and
     * the cost of page N does not grow with N.
     *
     * Yields arrays of docs. Memory stays O(batchSize), not O(table).
     */
    async *findAllBatched(tenantIdOrFilter = {}, filter = {}, options = {}) {
      let tenantId, actualFilter, actualOpts;

      if (typeof tenantIdOrFilter === "string") {
        tenantId = tenantIdOrFilter;
        actualFilter = filter;
        actualOpts = options;
      } else {
        tenantId = null;
        actualFilter = tenantIdOrFilter;
        actualOpts = filter;
      }

      if (enforceScope && isTenantScoped) {
        assertTenantScope({ tableName, tenantId, method: "findAllBatched", filter: actualFilter });
      }

      const batchSize = Math.min(1000, Math.max(1, Number(actualOpts.batchSize) || 500));
      // A runaway scan should fail loudly rather than read a table forever.
      const maxRows = Number(actualOpts.maxRows) || 1_000_000;
      const selectCols = actualOpts.select
        ? actualOpts.select
            .map((c) => (c === "_id" ? "id" : colMap[c] || c))
            .join(",")
        : "*";

      let cursor = null;
      let seen = 0;

      for (;;) {
        let query = sb().from(tableName).select(selectCols);
        if (tenantId) query = query.eq("tenant_id", tenantId);
        query = applyFilter(query, actualFilter, colMap, tableName);
        if (cursor) query = query.gt("id", cursor);
        query = query.order("id", { ascending: true }).limit(batchSize);

        const { data, error } = await query;
        if (error) throw error;
        if (!data || data.length === 0) return;

        seen += data.length;
        if (seen > maxRows) {
          throw new Error(
            `findAllBatched on "${tableName}" exceeded maxRows (${maxRows}). ` +
              `Narrow the filter or raise maxRows deliberately.`
          );
        }

        yield toDocs(data, colMap);

        // A short page means the table had nothing more to give.
        if (data.length < batchSize) return;
        cursor = data[data.length - 1]?.id;
        if (!cursor) return;
      }
    },

    async findOne(tenantIdOrFilter = {}, filter = {}) {
      let tenantId, actualFilter;

      if (typeof tenantIdOrFilter === "string") {
        tenantId = tenantIdOrFilter;
        actualFilter = filter;
      } else {
        tenantId = null;
        actualFilter = tenantIdOrFilter;
      }

      if (enforceScope && isTenantScoped) assertTenantScope({ tableName, tenantId, method: "findOne", filter: actualFilter });
      let query = sb().from(tableName).select("*");
      if (tenantId) query = query.eq("tenant_id", tenantId);
      query = applyFilter(query, actualFilter, colMap, tableName);
      query = query.limit(1).maybeSingle();

      const { data, error } = await query;
      if (error) throw error;
      return toDoc(data, colMap);
    },

    async findById(id) {
      const { data, error } = await sb()
        .from(tableName)
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return toDoc(data, colMap);
    },

    /**
     * Fetch by id *and* tenant, so a valid id belonging to another camp
     * returns null rather than that camp's row. Prefer this over findById on
     * anything reachable from a member request.
     */
    async findByIdScoped(tenantId, id) {
      const normalizedTenantId = normalizeId(tenantId);
      const normalizedId = normalizeId(id);
      if (!normalizedTenantId || !normalizedId) return null;
      let query = sb().from(tableName).select("*").eq("id", normalizedId);
      if (isTenantScoped) query = query.eq("tenant_id", normalizedTenantId);
      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      return toDoc(data, colMap);
    },

    // ----- WRITE -----

    async create(doc) {
      const id = doc.id || doc._id || generateObjectId();
      const now = new Date().toISOString();
      const row = toRow({ ...doc, id, createdAt: now, updatedAt: now }, colMap);
      // Ensure id is set
      row.id = id;

      const { data, error } = await sb()
        .from(tableName)
        .insert(row)
        .select("*")
        .single();
      if (error) throw error;
      return toDoc(data, colMap);
    },

    async insertMany(docs) {
      const now = new Date().toISOString();
      const rows = docs.map((doc) => {
        const id = doc.id || doc._id || generateObjectId();
        const row = toRow({ ...doc, id, createdAt: now, updatedAt: now }, colMap);
        row.id = id;
        return row;
      });

      const { data, error } = await sb()
        .from(tableName)
        .insert(rows)
        .select("*");
      if (error) throw error;
      return toDocs(data, colMap);
    },

    async upsert(doc) {
      const id = doc.id || doc._id || generateObjectId();
      const now = new Date().toISOString();
      const row = toRow({ ...doc, id, createdAt: now, updatedAt: now }, colMap);
      row.id = id;

      const { data, error } = await sb()
        .from(tableName)
        .upsert(row, { onConflict: "id" })
        .select("*")
        .single();
      if (error) throw error;
      return toDoc(data, colMap);
    },

    // ----- UPDATE -----

    async update(id, patch) {
      const row = toRow(patch, colMap);
      // Remove id from patch — can't update PK
      delete row.id;

      const { data, error } = await sb()
        .from(tableName)
        .update(row)
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;
      return toDoc(data, colMap);
    },

    /** Update by id, but only if the row belongs to this tenant. */
    async updateScoped(tenantId, id, patch) {
      const normalizedTenantId = normalizeId(tenantId);
      const normalizedId = normalizeId(id);
      if (!normalizedTenantId || !normalizedId) return null;
      const row = toRow(patch, colMap);
      delete row.id;

      let query = sb().from(tableName).update(row).eq("id", normalizedId);
      if (isTenantScoped) query = query.eq("tenant_id", normalizedTenantId);
      const { data, error } = await query.select("*").maybeSingle();
      if (error) throw error;
      return toDoc(data, colMap);
    },

    /**
     * Take ownership of one row, but only if it still looks the way the caller
     * expects — the job-queue claim.
     *
     * Reading a row and then updating it is two statements, so two replicas
     * polling the same table both see the same pending job and both proceed
     * with it. Folding the precondition into the UPDATE's own WHERE clause
     * makes the database the arbiter: exactly one writer matches, and everyone
     * else gets zero rows back and moves on. Returns the claimed doc, or null
     * if somebody else got there first.
     */
    async claimOne(id, guardFilter = {}, patch = {}) {
      const normalizedId = normalizeId(id);
      if (!normalizedId) return null;
      const row = toRow(patch, colMap);
      delete row.id;

      let query = sb().from(tableName).update(row).eq("id", normalizedId);
      query = applyFilter(query, guardFilter, colMap, tableName);

      const { data, error } = await query.select("*").maybeSingle();
      if (error) throw error;
      return toDoc(data, colMap);
    },

    async updateMany(tenantIdOrFilter, filterOrPatch, maybePatch) {
      let tenantId, actualFilter, patch;

      if (typeof tenantIdOrFilter === "string" && maybePatch) {
        tenantId = tenantIdOrFilter;
        actualFilter = filterOrPatch;
        patch = maybePatch;
      } else {
        tenantId = null;
        actualFilter = tenantIdOrFilter;
        patch = filterOrPatch;
      }

      if (enforceScope && isTenantScoped) assertTenantScope({ tableName, tenantId, method: "updateMany", filter: actualFilter });
      const row = toRow(patch, colMap);
      delete row.id;

      let query = sb().from(tableName).update(row);
      if (tenantId) query = query.eq("tenant_id", tenantId);
      query = applyFilter(query, actualFilter, colMap, tableName);

      const { data, error } = await query.select("*");
      if (error) throw error;
      return toDocs(data, colMap);
    },

    // ----- DELETE -----

    async delete(id) {
      const normalizedId = normalizeId(id);
      if (!normalizedId) {
        throw new Error(`Refusing delete on table "${tableName}" without a valid id.`);
      }
      const { error } = await sb()
        .from(tableName)
        .delete()
        .eq("id", normalizedId);
      if (error) throw error;
    },

    async deleteMany(tenantIdOrFilter, filter = {}) {
      let tenantId, actualFilter;

      if (typeof tenantIdOrFilter === "string") {
        tenantId = tenantIdOrFilter;
        actualFilter = filter;
      } else {
        tenantId = null;
        actualFilter = tenantIdOrFilter;
      }

      if (enforceScope && isTenantScoped) assertTenantScope({ tableName, tenantId, method: "deleteMany", filter: actualFilter });
      const safeTenantId = assertDeleteManyScope({
        tableName,
        tenantId,
        filter: actualFilter
      });

      let query = sb().from(tableName).delete();
      if (safeTenantId) query = query.eq("tenant_id", safeTenantId);
      query = applyFilter(query, actualFilter, colMap, tableName);

      const { error } = await query;
      if (error) throw error;
    },

    // ----- COUNT -----

    async count(tenantIdOrFilter = {}, filter = {}) {
      let tenantId, actualFilter;

      if (typeof tenantIdOrFilter === "string") {
        tenantId = tenantIdOrFilter;
        actualFilter = filter;
      } else {
        tenantId = null;
        actualFilter = tenantIdOrFilter;
      }

      if (enforceScope && isTenantScoped) assertTenantScope({ tableName, tenantId, method: "count", filter: actualFilter });
      let query = sb()
        .from(tableName)
        .select("id", { count: "exact", head: true });
      if (tenantId) query = query.eq("tenant_id", tenantId);
      query = applyFilter(query, actualFilter, colMap, tableName);

      const { count, error } = await query;
      if (error) throw error;
      return count || 0;
    },

    // ----- RPC -----

    async rpc(fnName, params) {
      const { data, error } = await sb().rpc(fnName, params);
      if (error) throw error;
      return data;
    }
  });

  const scoped = buildModel(true);
  const unscoped = buildModel(false);

  // Deliberate, greppable opt-out for platform-wide queries.
  scoped.acrossTenants = () => unscoped;
  unscoped.acrossTenants = () => unscoped;

  return scoped;
}
