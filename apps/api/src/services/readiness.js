import { getSupabaseAdmin } from "../db/supabaseAdmin.js";

/**
 * Liveness and readiness are different questions, and the old `/health`
 * answered neither. It reported how email and R2 were *configured* and always
 * returned ok, so a process that could not reach its database still looked
 * healthy to the platform and kept receiving traffic.
 *
 * - Liveness: is this process still running its event loop? Restart if not.
 * - Readiness: can it serve a request right now? Take it out of the pool if
 *   not, but do not restart it — the database may simply be busy.
 *
 * The readiness probe is bounded on every side: a head-only count that cannot
 * return rows, a hard deadline so a hung database fails the check instead of
 * hanging the probe, and a short result cache so probes running every few
 * seconds across many replicas cannot become their own load.
 */

export const READINESS_TIMEOUT_MS = 2000;
export const READINESS_CACHE_MS = 5000;

function rejectAfter(ms, message) {
  return new Promise((_resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    timer.unref?.();
  });
}

export function createReadinessProbe({
  getClient = getSupabaseAdmin,
  timeoutMs = READINESS_TIMEOUT_MS,
  cacheMs = READINESS_CACHE_MS,
  now = () => Date.now()
} = {}) {
  let cached = null;
  let inFlight = null;

  async function measure() {
    const startedAt = now();
    try {
      // `head: true` means PostgREST returns no rows at all, so the cost of
      // the check does not grow with the table.
      const query = getClient().from("tenants").select("id", { count: "exact", head: true });
      const { error } = await Promise.race([
        query,
        rejectAfter(timeoutMs, `readiness check exceeded ${timeoutMs}ms`)
      ]);
      if (error) throw new Error(error.message || "database check failed");
      return { ready: true, checkedAt: startedAt, durationMs: now() - startedAt, error: "" };
    } catch (error) {
      return {
        ready: false,
        checkedAt: startedAt,
        durationMs: now() - startedAt,
        error: String(error?.message || error || "unknown error")
      };
    }
  }

  return async function check() {
    if (cached && now() - cached.checkedAt < cacheMs) return cached;
    // Concurrent probes share one database round trip rather than each opening
    // their own.
    if (!inFlight) {
      inFlight = measure().then((result) => {
        cached = result;
        inFlight = null;
        return result;
      });
    }
    return inFlight;
  };
}
