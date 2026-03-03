import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { env } from "../config/env.js";

export async function connectToDatabase() {
  try {
    const sb = getSupabaseAdmin();
    const { count, error } = await sb.from("tenants").select("id", { count: "exact", head: true });
    if (error) {
      const wrapped = new Error(`Supabase connection check failed: ${error.message}`);
      wrapped.code = error.code || "SUPABASE_CONNECTION_CHECK_FAILED";
      wrapped.details = error.details || null;
      throw wrapped;
    }
    if (
      env.NODE_ENV === "production" &&
      !env.ALLOW_EMPTY_PRODUCTION_TENANTS &&
      Number(count || 0) < Number(env.PRODUCTION_MIN_TENANTS || 1)
    ) {
      const wrapped = new Error(
        "Supabase safety check failed: production tenant count is below the required minimum. " +
          "Refusing startup to avoid serving against an empty/wrong database."
      );
      wrapped.code = "PRODUCTION_TENANT_FLOOR_CHECK_FAILED";
      wrapped.details = {
        tenantCount: Number(count || 0),
        requiredMinimum: Number(env.PRODUCTION_MIN_TENANTS || 1)
      };
      throw wrapped;
    }
  } catch (error) {
    if (error?.message?.startsWith("Supabase connection check failed")) {
      throw error;
    }
    const wrapped = new Error(`Supabase connection check failed: ${error?.message || String(error)}`);
    wrapped.code = error?.code || error?.cause?.code || "SUPABASE_CONNECTION_FAILED";
    wrapped.details = error?.details || error?.cause?.message || null;
    throw wrapped;
  }
}
