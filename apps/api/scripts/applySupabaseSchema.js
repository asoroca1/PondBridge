import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Client } from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

function splitSqlStatements(sql = "") {
  const statements = [];
  let buffer = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let dollarTag = "";

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const nextChar = sql[index + 1];

    if (dollarTag) {
      buffer += char;
      if (char === "$" && sql.slice(index - dollarTag.length + 1, index + 1) === dollarTag) {
        dollarTag = "";
      }
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && char === "-" && nextChar === "-") {
      while (index < sql.length && sql[index] !== "\n") {
        buffer += sql[index];
        index += 1;
      }
      if (index < sql.length) buffer += "\n";
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && char === "$") {
      const match = sql.slice(index).match(/^\$[A-Za-z0-9_]*\$/);
      if (match) {
        dollarTag = match[0];
        buffer += dollarTag;
        index += dollarTag.length - 1;
        continue;
      }
    }

    if (!inDoubleQuote && char === "'" && sql[index - 1] !== "\\") {
      inSingleQuote = !inSingleQuote;
      buffer += char;
      continue;
    }

    if (!inSingleQuote && char === '"') {
      inDoubleQuote = !inDoubleQuote;
      buffer += char;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && char === ";") {
      const statement = buffer.trim();
      if (statement) statements.push(statement);
      buffer = "";
      continue;
    }

    buffer += char;
  }

  const tail = buffer.trim();
  if (tail) statements.push(tail);
  return statements;
}

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
    const statements = splitSqlStatements(sql);
    for (let index = 0; index < statements.length; index += 1) {
      const statement = statements[index];
      try {
        await client.query(statement);
      } catch (error) {
        const preview = statement.replace(/\s+/g, " ").slice(0, 220);
        console.error(`[supabase-schema] statement ${index + 1}/${statements.length} failed: ${preview}`);
        throw error;
      }
    }
    console.log(`[supabase-schema] applied ${path.basename(sqlPath)}`);
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error("[supabase-schema] failed", error);
  process.exit(1);
});
