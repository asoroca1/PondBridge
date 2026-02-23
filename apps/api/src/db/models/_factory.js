import { getSupabaseAdmin } from "../supabaseAdmin.js";
import { generateObjectId } from "../../utils/objectId.js";

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
    const col = colMap[key];
    if (!col) continue;

    if (value === null || value === undefined) {
      query = query.is(col, null);
    } else if (typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
      // Operator object, e.g. { $in: [...], $gte: date }
      for (const [op, operand] of Object.entries(value)) {
        switch (op) {
          case "$eq":
            query = query.eq(col, operand);
            break;
          case "$ne":
          case "$neq":
            query = query.neq(col, operand);
            break;
          case "$gt":
            query = query.gt(col, operand);
            break;
          case "$gte":
            query = query.gte(col, operand);
            break;
          case "$lt":
            query = query.lt(col, operand);
            break;
          case "$lte":
            query = query.lte(col, operand);
            break;
          case "$in":
            query = query.in(col, operand);
            break;
          case "$nin":
            query = query.not(col, "in", `(${operand.join(",")})`);
            break;
          case "$contains":
            query = query.contains(col, operand);
            break;
          case "$ilike":
            query = query.ilike(col, operand);
            break;
          default:
            break;
        }
      }
    } else {
      query = query.eq(col, value);
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
        ? actualOpts.select.map((c) => colMap[c] || c).join(",")
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
      const { error } = await sb()
        .from(tableName)
        .delete()
        .eq("id", id);
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

      let query = sb().from(tableName).delete();
      if (tenantId) query = query.eq("tenant_id", tenantId);
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
