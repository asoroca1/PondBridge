import { getSupabaseAdmin } from "../supabaseAdmin.js";
import { generateObjectId } from "../../utils/objectId.js";

const NODE_ENV = String(process.env.NODE_ENV || "").trim().toLowerCase();
const ALLOW_UNSCOPED_DELETES = String(process.env.PONDBRIDGE_ALLOW_UNSCOPED_DELETES || "")
  .trim()
  .toLowerCase() === "1";

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

function applyFilter(query, filter, colMap) {
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
      if (!baseCol) continue;
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
            default: break;
          }
        }
      } else {
        query = query.filter(jsonbPath, "eq", normalizeFilterOperand(value));
      }
      continue;
    }

    const col = colMap[key];
    if (!col) continue;

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

  const model = {
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

      const selectCols = actualOpts.select
        ? actualOpts.select
            .map((c) => (c === "_id" ? "id" : colMap[c] || c))
            .join(",")
        : "*";

      let query = sb().from(tableName).select(selectCols, { count: "exact" });

      if (tenantId) query = query.eq("tenant_id", tenantId);
      query = applyFilter(query, actualFilter, colMap);
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
      docs._count = count;
      return docs;
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

      let query = sb().from(tableName).select("*");
      if (tenantId) query = query.eq("tenant_id", tenantId);
      query = applyFilter(query, actualFilter, colMap);
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

      const row = toRow(patch, colMap);
      delete row.id;

      let query = sb().from(tableName).update(row);
      if (tenantId) query = query.eq("tenant_id", tenantId);
      query = applyFilter(query, actualFilter, colMap);

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

      const safeTenantId = assertDeleteManyScope({
        tableName,
        tenantId,
        filter: actualFilter
      });

      let query = sb().from(tableName).delete();
      if (safeTenantId) query = query.eq("tenant_id", safeTenantId);
      query = applyFilter(query, actualFilter, colMap);

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

      let query = sb()
        .from(tableName)
        .select("id", { count: "exact", head: true });
      if (tenantId) query = query.eq("tenant_id", tenantId);
      query = applyFilter(query, actualFilter, colMap);

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
  };

  return model;
}
