import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Client } from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

async function run() {
  const connectionString = String(process.env.SUPABASE_DB_URL || "").trim();
  if (!connectionString) {
    throw new Error("SUPABASE_DB_URL is required in apps/api/.env");
  }

  const sqlPath = path.resolve(__dirname, "./native_schema.sql");
  const sql = await fs.readFile(sqlPath, "utf8");

  const client = new Client({
    connectionString,
    ssl: {
      rejectUnauthorized: false
    }
  });

  await client.connect();
  try {
    await client.query(sql);
    console.log(`[supabase-schema] applied ${path.basename(sqlPath)}`);
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error("[supabase-schema] failed", error);
  process.exit(1);
});
