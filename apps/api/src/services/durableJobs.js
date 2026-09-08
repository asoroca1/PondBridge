import { applySuperConsoleRolePolicy } from "./identityUsers.js";
import { createHash } from "node:crypto";
import { getSupabaseAdmin } from "../db/supabaseAdmin.js";
import { TenantModel, UserModel } from "../db/models/index.js";

const handlers = new Map();
let timer;
let active;
let stopped = true;
export const durableJobsEnabled = () => process.env.DURABLE_JOBS_ENABLED === "true";
export const MAX_QUEUED_RECIPIENTS = 5000;
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
export function jobFingerprint(value) { return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex"); }
export function jobError(code, retryable = false) {
  const error = new Error(code); error.code = code; error.retryable = retryable; return error;
}
export function publicJob(job) {
  return { id: job.id, kind: job.kind, status: job.status, total: job.total, processed: job.cursor,
    accepted: Number(job.state?.accepted || 0), skipped: Number(job.state?.skipped || 0),
    error: job.last_error || "", createdAt: job.created_at, updatedAt: job.updated_at };
}
export async function enqueueJob({ tenantId, actorUserId, kind, key, payload, total, runAt }) {
  if (!durableJobsEnabled()) throw jobError("DURABLE_JOBS_DISABLED");
  if (!/^[A-Za-z0-9_.:/-]{8,200}$/.test(String(key || ""))) throw jobError("JOB_REQUEST_KEY_REQUIRED");
  const { data, error } = await getSupabaseAdmin().rpc("enqueue_tenant_job", {
    p_tenant: tenantId, p_actor: actorUserId, p_kind: kind, p_key: key,
    p_fingerprint: jobFingerprint(payload), p_payload: payload, p_total: total,
    p_run_at: runAt || new Date().toISOString()
  });
  if (error) throw error;
  return data;
}
export async function readJob(tenantId, id) {
  const { data, error } = await getSupabaseAdmin().from("tenant_background_jobs").select("*").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}
export async function readJobByKey(tenantId, kind, key) {
  const { data, error } = await getSupabaseAdmin().from("tenant_background_jobs").select("*").eq("tenant_id", tenantId).eq("kind", kind).eq("idempotency_key", key).maybeSingle();
  if (error) throw error;
  return data;
}
export function registerJobHandler(kind, handler) { handlers.set(kind, handler); }
export async function saveJob(job, { cursor = job.cursor, state = job.state, release = false, error = "" } = {}) {
  const { data, error: dbError } = await getSupabaseAdmin().rpc("checkpoint_tenant_job", {
    p_tenant: job.tenant_id, p_id: job.id, p_lease: job.lease_token,
    p_cursor: cursor, p_state: state, p_release: release, p_error: error
  });
  if (dbError) throw dbError;
  if (!data) throw jobError("JOB_LEASE_LOST");
  job.cursor = cursor; job.state = state;
}
export async function runJobStep(job) {
  const [tenant, actor] = await Promise.all([
    TenantModel.findById(job.tenant_id), UserModel.findById(job.actor_user_id)
  ]);
  const roles = applySuperConsoleRolePolicy(actor?.roles || [], { clerkUserId: actor?.clerkUserId, email: actor?.email }, actor?.email || "");
  if (!tenant || tenant.status !== "active" || !actor || actor.status !== "active" ||
      !((String(actor.tenantId) === String(job.tenant_id) && roles.includes("tenant_admin")) || roles.includes("super_admin"))) {
    throw jobError("JOB_ACTOR_NO_LONGER_AUTHORIZED");
  }
  const handler = handlers.get(job.kind);
  if (!handler) throw jobError("JOB_KIND_UNAVAILABLE");
  const result = await handler(job, { tenant, actor });
  if (job.leaseLost) throw jobError("JOB_LEASE_LOST");
  if (result?.terminal) return;
  await saveJob(job, { ...result, release: true });
}
export async function tickDurableJobs() {
  const { data, error } = await getSupabaseAdmin().rpc("claim_tenant_job");
  if (error) throw error;
  const job = data?.[0];
  if (!job) return;
  const heartbeat = setInterval(async () => {
    try {
      const result = await getSupabaseAdmin().rpc("heartbeat_tenant_job", { p_tenant: job.tenant_id, p_id: job.id, p_lease: job.lease_token });
      if (result.error || !result.data) job.leaseLost = true;
    } catch { job.leaseLost = true; }
  }, 20_000);
  heartbeat.unref?.();
  try {
    await runJobStep(job);
  } catch (failure) {
    if (failure.code === "JOB_LEASE_LOST") return;
    const code = String(failure.code || "JOB_STEP_FAILED").replace(/[^A-Z0-9_:.-]/gi, "_").slice(0, 100);
    await saveJob(job, { error: failure.retryable ? code : `PERMANENT:${code}` });
  } finally { clearInterval(heartbeat); }
}
export function startDurableJobWorker() {
  if (!durableJobsEnabled() || !stopped) return;
  stopped = false;
  const tick = async () => {
    if (stopped) return;
    active = tickDurableJobs().catch((error) => console.error("[jobs] tick failed", { code: error?.code || "JOB_WORKER_FAILED" }));
    await active; active = null;
    if (!stopped) { timer = setTimeout(tick, 1000); timer.unref?.(); }
  };
  timer = setTimeout(tick, 1000); timer.unref?.();
}
export async function stopDurableJobWorker() { stopped = true; clearTimeout(timer); await active; }
