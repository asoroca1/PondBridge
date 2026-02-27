import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("native schema tenant hardening", () => {
  test("native schema enforces tenant binding triggers and authenticated RLS policies", async () => {
    const sqlPath = path.resolve(__dirname, "../scripts/native_schema.sql");
    const sql = await fs.readFile(sqlPath, "utf8");

    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.enforce_single_tenant_membership()");
    expect(sql).toContain("CREATE TRIGGER trigger_enforce_single_tenant_membership");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.enforce_profile_user_tenant_consistency()");
    expect(sql).toContain("CREATE TRIGGER trigger_enforce_profile_user_tenant_consistency");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.jwt_tenant_id()");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.jwt_has_role");
    expect(sql).toContain("tenants_authenticated_scope_select");
    expect(sql).toContain("authenticated_tenant_scope");
  });
});
