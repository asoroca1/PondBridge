import { getSupabaseAdmin } from "./supabaseAdmin.js";

export async function connectToDatabase() {
  try {
    const sb = getSupabaseAdmin();
    const { error } = await sb.from("tenants").select("id", { count: "exact", head: true });
    if (error) {
      const wrapped = new Error(`Supabase connection check failed: ${error.message}`);
      wrapped.code = error.code || "SUPABASE_CONNECTION_CHECK_FAILED";
      wrapped.details = error.details || null;
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
