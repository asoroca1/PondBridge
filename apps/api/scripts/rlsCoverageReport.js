import { Client } from "pg";
import { env } from "../src/config/env.js";

const OUTPUT_JSON = process.argv.includes("--json");

function formatStatus({ rlsEnabled, policyCount }) {
  if (!rlsEnabled) return "missing_rls";
  if (!policyCount) return "missing_policy";
  return "covered";
}

async function main() {
  if (!env.SUPABASE_DB_URL) {
    throw new Error("SUPABASE_DB_URL is required to audit RLS coverage.");
  }

  const client = new Client({
    connectionString: env.SUPABASE_DB_URL,
    ssl: /localhost|127\.0\.0\.1/i.test(String(env.SUPABASE_DB_URL || ""))
      ? undefined
      : { rejectUnauthorized: false }
  });

  await client.connect();
  try {
    const tableResult = await client.query(
      `
      select
        cls.relname as table_name,
        cls.relrowsecurity as rls_enabled
      from pg_class cls
      join pg_namespace ns on ns.oid = cls.relnamespace
      where ns.nspname = 'public'
        and cls.relkind = 'r'
      order by cls.relname asc
      `
    );

    const policyResult = await client.query(
      `
      select
        tablename as table_name,
        count(*)::int as policy_count
      from pg_policies
      where schemaname = 'public'
      group by tablename
      `
    );

    const policyCounts = new Map(
      policyResult.rows.map((row) => [String(row.table_name), Number(row.policy_count || 0)])
    );

    const rows = tableResult.rows.map((row) => {
      const table = String(row.table_name || "");
      const rlsEnabled = Boolean(row.rls_enabled);
      const policyCount = policyCounts.get(table) || 0;
      return {
        table,
        rlsEnabled,
        policyCount,
        status: formatStatus({ rlsEnabled, policyCount })
      };
    });

    if (OUTPUT_JSON) {
      process.stdout.write(`${JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2)}\n`);
      return;
    }

    const statusCounts = rows.reduce(
      (acc, row) => {
        acc[row.status] = (acc[row.status] || 0) + 1;
        return acc;
      },
      { covered: 0, missing_rls: 0, missing_policy: 0 }
    );

    console.log(`RLS coverage report (${new Date().toISOString()})`);
    console.log(
      `covered=${statusCounts.covered} missing_rls=${statusCounts.missing_rls} missing_policy=${statusCounts.missing_policy}`
    );
    console.log("table,rlsEnabled,policyCount,status");
    for (const row of rows) {
      console.log(`${row.table},${row.rlsEnabled},${row.policyCount},${row.status}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("[rls:audit] failed:", error?.message || error);
  process.exit(1);
});
