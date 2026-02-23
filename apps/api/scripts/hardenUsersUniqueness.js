import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Client } from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

function normalizeEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function normalizeClerkUserId(value = "") {
  const normalized = String(value || "").trim();
  return normalized ? normalized : null;
}

function mergeRoles(rows = []) {
  const roleSet = new Set();
  for (const row of rows) {
    for (const role of row.roles || []) {
      const normalized = String(role || "").trim();
      if (normalized) roleSet.add(normalized);
    }
  }
  return [...roleSet];
}

function byCreatedAtAsc(a, b) {
  const aTime = new Date(a.created_at || 0).getTime();
  const bTime = new Date(b.created_at || 0).getTime();
  if (aTime !== bTime) return aTime - bTime;
  return String(a.id || "").localeCompare(String(b.id || ""));
}

async function dedupeUsersByScopeAndClerk(client) {
  const { rows: groups } = await client.query(`
    select
      coalesce(tenant_id, '__global__') as tenant_scope,
      clerk_user_id,
      count(*)::int as duplicate_count,
      array_agg(id order by created_at asc, id asc) as ids
    from public.users
    where nullif(btrim(clerk_user_id), '') is not null
    group by coalesce(tenant_id, '__global__'), clerk_user_id
    having count(*) > 1
    order by duplicate_count desc
  `);

  let removed = 0;
  for (const group of groups) {
    const ids = group.ids || [];
    if (ids.length < 2) continue;

    const { rows } = await client.query(
      `
      select id, tenant_id, email, clerk_user_id, roles, status, created_at
      from public.users
      where id = any($1::text[])
      `,
      [ids]
    );
    const ordered = rows.sort(byCreatedAtAsc);
    const keep = ordered[0];
    const duplicates = ordered.slice(1);
    if (!keep || !duplicates.length) continue;

    const mergedRoles = mergeRoles(ordered);
    const preferredEmail =
      ordered.map((row) => normalizeEmail(row.email)).find(Boolean) || normalizeEmail(keep.email);
    const preferredClerkUserId =
      ordered.map((row) => normalizeClerkUserId(row.clerk_user_id)).find(Boolean) || normalizeClerkUserId(keep.clerk_user_id);
    const preferredStatus = ordered.some((row) => String(row.status || "") === "active") ? "active" : (keep.status || "active");

    await client.query(
      `
      update public.users
      set
        email = $2,
        clerk_user_id = $3,
        roles = $4::text[],
        status = $5,
        updated_at = now()
      where id = $1
      `,
      [keep.id, preferredEmail, preferredClerkUserId, mergedRoles, preferredStatus]
    );

    await client.query(`delete from public.users where id = any($1::text[])`, [duplicates.map((row) => row.id)]);
    removed += duplicates.length;
  }

  return { groups: groups.length, removed };
}

async function dedupeGlobalUsersByEmail(client) {
  const { rows: groups } = await client.query(`
    select
      lower(email) as email_key,
      count(*)::int as duplicate_count,
      array_agg(id order by created_at asc, id asc) as ids
    from public.users
    where tenant_id is null
    group by lower(email)
    having count(*) > 1
    order by duplicate_count desc
  `);

  let removed = 0;
  for (const group of groups) {
    const ids = group.ids || [];
    if (ids.length < 2) continue;

    const { rows } = await client.query(
      `
      select id, tenant_id, email, clerk_user_id, roles, status, created_at
      from public.users
      where id = any($1::text[])
      `,
      [ids]
    );
    const ordered = rows.sort(byCreatedAtAsc);
    const keep = ordered[0];
    const duplicates = ordered.slice(1);
    if (!keep || !duplicates.length) continue;

    const mergedRoles = mergeRoles(ordered);
    const preferredClerkUserId = ordered.map((row) => normalizeClerkUserId(row.clerk_user_id)).find(Boolean) || null;
    const preferredStatus = ordered.some((row) => String(row.status || "") === "active") ? "active" : (keep.status || "active");

    await client.query(
      `
      update public.users
      set
        email = $2,
        clerk_user_id = $3,
        roles = $4::text[],
        status = $5,
        updated_at = now()
      where id = $1
      `,
      [keep.id, normalizeEmail(keep.email), preferredClerkUserId, mergedRoles, preferredStatus]
    );

    await client.query(`delete from public.users where id = any($1::text[])`, [duplicates.map((row) => row.id)]);
    removed += duplicates.length;
  }

  return { groups: groups.length, removed };
}

async function applyUniqueIndexes(client) {
  await client.query(`
    create unique index if not exists idx_users_scope_clerk_user_unique
      on public.users ((coalesce(tenant_id, '__global__')), clerk_user_id)
      where nullif(btrim(clerk_user_id), '') is not null
  `);

  await client.query(`
    create unique index if not exists idx_users_global_email_unique
      on public.users ((lower(email)))
      where tenant_id is null
  `);
}

async function verify(client) {
  const { rows: indexRows } = await client.query(`
    select indexname
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'users'
      and indexname in ('idx_users_scope_clerk_user_unique', 'idx_users_global_email_unique')
    order by indexname
  `);

  const { rows: duplicateScopeClerk } = await client.query(`
    select count(*)::int as duplicate_groups
    from (
      select 1
      from public.users
      where nullif(btrim(clerk_user_id), '') is not null
      group by coalesce(tenant_id, '__global__'), clerk_user_id
      having count(*) > 1
    ) t
  `);

  const { rows: duplicateGlobalEmail } = await client.query(`
    select count(*)::int as duplicate_groups
    from (
      select 1
      from public.users
      where tenant_id is null
      group by lower(email)
      having count(*) > 1
    ) t
  `);

  return {
    indexes: indexRows.map((row) => row.indexname),
    duplicateScopeClerkGroups: Number(duplicateScopeClerk[0]?.duplicate_groups || 0),
    duplicateGlobalEmailGroups: Number(duplicateGlobalEmail[0]?.duplicate_groups || 0)
  };
}

async function run() {
  const connectionString = String(process.env.SUPABASE_DB_URL || "").trim();
  if (!connectionString) {
    throw new Error("SUPABASE_DB_URL is required in apps/api/.env");
  }

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();

  try {
    await client.query("begin");
    const clerkDedupe = await dedupeUsersByScopeAndClerk(client);
    const globalEmailDedupe = await dedupeGlobalUsersByEmail(client);
    await applyUniqueIndexes(client);
    const verification = await verify(client);
    await client.query("commit");

    console.log("[users-hardening] completed");
    console.log(
      JSON.stringify(
        {
          clerkDedupe,
          globalEmailDedupe,
          verification
        },
        null,
        2
      )
    );
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error("[users-hardening] failed", error);
  process.exit(1);
});

