import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TENANT_PURGE_STEPS } from "../src/services/tenantPurge.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(HERE, "..", "scripts", "native_schema.sql");

// Tables the tenant purge deliberately skips: the tenant row itself, and the
// membership table the identity cleanup step removes before the purge loop.
const HANDLED_ELSEWHERE = new Set(["tenants", "tenant_memberships"]);

function tablesBlockingTenantDelete() {
  const sql = fs.readFileSync(SCHEMA_PATH, "utf8");
  const blocking = new Set();
  let table = "";

  for (const line of sql.split("\n")) {
    const created = line.match(/CREATE TABLE (?:IF NOT EXISTS )?public\.(\w+)/i);
    if (created) table = created[1];
    if (!line.includes("REFERENCES public.tenants(id)")) continue;
    // ON DELETE CASCADE rows disappear with the tenant, so they need no step.
    if (/ON DELETE CASCADE/i.test(line)) continue;
    if (table && !HANDLED_ELSEWHERE.has(table)) blocking.add(table);
  }

  return [...blocking].sort();
}

describe("tenant purge coverage", () => {
  test("purges every table whose tenant foreign key blocks the tenant delete", () => {
    const purged = new Set(TENANT_PURGE_STEPS.map((step) => step.model.tableName));
    const missing = tablesBlockingTenantDelete().filter((table) => !purged.has(table));

    expect(missing).toEqual([]);
  });

  test("names each purge step once and keeps children ahead of their parents", () => {
    const keys = TENANT_PURGE_STEPS.map((step) => step.key);
    expect(new Set(keys).size).toBe(keys.length);

    const tables = TENANT_PURGE_STEPS.map((step) => step.model.tableName);
    expect(new Set(tables).size).toBe(tables.length);

    const order = new Map(tables.map((table, index) => [table, index]));
    const childBeforeParent = [
      ["messages", "conversations"],
      ["forum_posts", "forums"],
      ["event_messages", "events"],
      ["event_rsvps", "events"],
      ["mobile_notifications", "users"],
      ["mobile_notification_devices", "users"],
      ["mobile_notification_preferences", "users"],
      ["profiles", "users"]
    ];

    for (const [child, parent] of childBeforeParent) {
      expect(order.get(child)).toBeLessThan(order.get(parent));
    }
  });
});
