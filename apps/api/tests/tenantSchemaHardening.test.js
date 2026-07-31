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
    expect(sql).toContain("SET search_path = pg_catalog, public, auth");
    expect(sql).toContain("SET search_path = pg_catalog, public");
    expect(sql).toContain("tenants_authenticated_scope_select");
    expect(sql).toContain("authenticated_tenant_scope");
    expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_custom_domain_unique");
    expect(sql).toContain("CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions");
    expect(sql).toContain("SET search_path = pg_catalog, public, extensions");
    expect(sql).toContain("public.lower_immutable(btrim(custom_domain))");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.member_blocks");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.content_reports");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.event_meeting_details");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.event_join_access_logs");
    expect(sql).toContain("idx_event_join_access_event");
    expect(sql).toContain("idx_event_join_access_profile");
    expect(sql).toContain("idx_event_join_access_user");
    expect(sql).toContain("trigger_enforce_event_host_tenant_consistency");
    expect(sql).toContain("trigger_enforce_event_join_tenant_consistency");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.platform_admin_audit_logs");
    expect(sql).toContain("idx_platform_audit_logs_created");
    expect(sql).toContain("CREATE TRIGGER trigger_enforce_member_block_tenant_consistency");
    expect(sql).toContain("CREATE TRIGGER trigger_enforce_content_report_tenant_consistency");
    expect(sql).toContain("idx_content_reports_active_dedup");
    expect(sql).toContain("idx_messages_conversation_fk");
    expect(sql).toContain("idx_event_rsvps_profile_fk");
    expect(sql).toContain("idx_mobile_notification_devices_user_fk");
    expect(sql).toContain("GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role");
    expect(sql).toContain("REVOKE ALL ON public.%I FROM anon, authenticated");
  });

  test("standalone hardening migration pins functions and closes browser table grants", async () => {
    const sqlPath = path.resolve(__dirname, "../scripts/database_security_hardening_schema.sql");
    const sql = await fs.readFile(sqlPath, "utf8");

    expect(sql).toContain("ALTER FUNCTION %s SET search_path");
    expect(sql).toContain("GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role");
    expect(sql).toContain("REVOKE ALL ON public.%I FROM anon, authenticated");
  });

  test("additive schemas grant service access and keep browser roles closed", async () => {
    const schemaFiles = [
      "platform_audit_schema.sql",
      "rollout_control_schema.sql",
      "communications_system_schema.sql",
      "multi_camp_identity_schema.sql",
      "member_safety_schema.sql"
    ];
    const schemas = await Promise.all(schemaFiles.map((fileName) =>
      fs.readFile(path.resolve(__dirname, `../scripts/${fileName}`), "utf8")
    ));

    schemas.forEach((sql) => {
      expect(sql).toContain("TO service_role");
      expect(sql).toContain("FROM anon, authenticated");
    });
  });

  test("standalone member safety migration preserves tenant triggers, RLS, and deduplication", async () => {
    const sqlPath = path.resolve(__dirname, "../scripts/member_safety_schema.sql");
    const sql = await fs.readFile(sqlPath, "utf8");

    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.member_blocks");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.content_reports");
    expect(sql).toContain("trigger_enforce_member_block_tenant_consistency");
    expect(sql).toContain("trigger_enforce_content_report_tenant_consistency");
    expect(sql).toContain("SET search_path = pg_catalog, public");
    expect(sql).toContain("idx_content_reports_active_dedup");
    expect(sql).toContain("ALTER TABLE public.member_blocks FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("ALTER TABLE public.content_reports FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("member_blocks_service_role_all");
    expect(sql).toContain("content_reports_service_role_all");
  });
});
