import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { env } from "../config/env.js";

function buildRecoveryHint() {
  return [
    "Recovery:",
    "1) Verify SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY point to the intended Supabase project.",
    "2) If this is a fresh/empty DB, temporarily set ALLOW_EMPTY_PRODUCTION_TENANTS=1 and redeploy once.",
    "3) Create the first tenant (via seed/provisioning flow, or temporarily set ALLOW_PUBLIC_AUTO_BOOTSTRAP_FIRST_TENANT=1 and request /api/public/tenant-config?slug=<slug>).",
    "4) Set ALLOW_EMPTY_PRODUCTION_TENANTS=0 (and ALLOW_PUBLIC_AUTO_BOOTSTRAP_FIRST_TENANT=0 if used), then redeploy."
  ].join(" ");
}

export async function connectToDatabase() {
  try {
    const sb = getSupabaseAdmin();
    const { data: tenantRows, count, error } = await sb
      .from("tenants")
      .select("id, slug, name, status", { count: "exact" });
    if (error) {
      const wrapped = new Error(`Supabase connection check failed: ${error.message}`);
      wrapped.code = error.code || "SUPABASE_CONNECTION_CHECK_FAILED";
      wrapped.details = error.details || null;
      throw wrapped;
    }

    const tenantCount = Number(count || 0);
    const requiredMinimum = Number(env.PRODUCTION_MIN_TENANTS || 1);
    const isTest = env.NODE_ENV === "test";

    // Always log tenant inventory on startup (skip in test to reduce noise).
    if (!isTest) {
      console.log(`[db] Tenant inventory: ${tenantCount} tenant(s) found.`);
      if (tenantRows && tenantRows.length > 0) {
        for (const t of tenantRows) {
          console.log(`[db]   - "${t.slug}" (${t.name}) [${t.status}] id=${t.id}`);
        }
      }
    }

    // Tenant floor check runs in ALL environments (not just production).
    // In test mode, skip to allow test suites that start with an empty DB.
    if (
      !isTest &&
      !env.ALLOW_EMPTY_PRODUCTION_TENANTS &&
      tenantCount < requiredMinimum
    ) {
      const recoveryHint = buildRecoveryHint();
      const wrapped = new Error(
        `Tenant safety check failed: found ${tenantCount} tenant(s) but require at least ${requiredMinimum}. ` +
          "Refusing startup to avoid serving against an empty/wrong database. " +
          recoveryHint
      );
      wrapped.code = "TENANT_FLOOR_CHECK_FAILED";
      wrapped.details = {
        tenantCount,
        requiredMinimum,
        recoveryHint,
        suggestedEnv: {
          ALLOW_EMPTY_PRODUCTION_TENANTS: "1 (temporary while provisioning first tenant)",
          PRODUCTION_MIN_TENANTS: String(requiredMinimum),
          ALLOW_PUBLIC_AUTO_BOOTSTRAP_FIRST_TENANT: "1 (optional, temporary)"
        },
        currentEnv: {
          NODE_ENV: env.NODE_ENV,
          ALLOW_EMPTY_PRODUCTION_TENANTS: Boolean(env.ALLOW_EMPTY_PRODUCTION_TENANTS),
          ALLOW_PUBLIC_AUTO_BOOTSTRAP_FIRST_TENANT: Boolean(
            env.ALLOW_PUBLIC_AUTO_BOOTSTRAP_FIRST_TENANT
          ),
          PRODUCTION_MIN_TENANTS: requiredMinimum
        }
      };
      throw wrapped;
    }
  } catch (error) {
    if (
      error?.code === "TENANT_FLOOR_CHECK_FAILED" ||
      error?.message?.startsWith("Supabase connection check failed") ||
      error?.message?.startsWith("Tenant safety check failed")
    ) {
      throw error;
    }
    const wrapped = new Error(`Supabase connection check failed: ${error?.message || String(error)}`);
    wrapped.code = error?.code || error?.cause?.code || "SUPABASE_CONNECTION_FAILED";
    wrapped.details = error?.details || error?.cause?.message || null;
    throw wrapped;
  }
}
