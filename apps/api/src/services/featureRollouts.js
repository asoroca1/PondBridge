import { FeatureRolloutModel } from "../db/models/index.js";

export const MULTI_CAMP_IDENTITY_FLAG = "multi_camp_identity_v1";

export const SUPPORTED_FEATURE_ROLLOUTS = Object.freeze({
  director_copilot_v1: {
    label: "Director Copilot",
    description: "Provider-backed, read-only director assistance. Guided mode remains available when disabled."
  },
  director_email_agent_v1: {
    label: "Director Communications Agent",
    description: "Draft-only AI campaign assistance with tenant budgets and durable usage metering. Sending always requires director approval."
  },
  camp_ai_search_v1: {
    label: "Camp Search AI",
    description: "Natural-language, tenant-scoped member directory search. The model plans filters but never receives profile records."
  },
  [MULTI_CAMP_IDENTITY_FLAG]: {
    label: "Multi-camp identity reads",
    description: "Membership-backed authorization for explicitly rehearsed camps."
  }
});

/**
 * Camp-facing AI features that are held back while the experience is still
 * being built. These stay off no matter what a stored rollout record says, so
 * a stale `enabled` row can never expose them to a camp.
 */
export const HARD_DISABLED_FEATURE_ROLLOUTS = Object.freeze([
  "director_copilot_v1",
  "camp_ai_search_v1"
]);

const HARD_DISABLED_LOOKUP = new Set(HARD_DISABLED_FEATURE_ROLLOUTS);

export function isHardDisabledFeature(featureKey = "") {
  return HARD_DISABLED_LOOKUP.has(String(featureKey || "").trim());
}

const VALID_STATES = new Set(["disabled", "pilot", "enabled"]);
const CACHE_TTL_MS = 15_000;
const rolloutCache = new Map();

function uniqueIds(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean))].slice(0, 500);
}

export function normalizeFeatureRolloutInput(value = {}) {
  const state = String(value?.state || "disabled").trim().toLowerCase();
  if (!VALID_STATES.has(state)) {
    const error = new Error("Rollout state must be disabled, pilot, or enabled.");
    error.code = "INVALID_ROLLOUT_STATE";
    error.statusCode = 400;
    throw error;
  }
  const tenantIds = uniqueIds(value?.tenantIds);
  const excludedTenantIds = uniqueIds(value?.excludedTenantIds)
    .filter((tenantId) => !tenantIds.includes(tenantId));
  if (state === "pilot" && tenantIds.length === 0) {
    const error = new Error("A pilot rollout requires at least one target tenant ID.");
    error.code = "ROLLOUT_COHORT_REQUIRED";
    error.statusCode = 400;
    throw error;
  }
  return {
    state,
    killSwitch: Boolean(value?.killSwitch),
    tenantIds,
    excludedTenantIds,
    config: value?.config && typeof value.config === "object" && !Array.isArray(value.config)
      ? value.config
      : {}
  };
}

export function evaluateFeatureRolloutRecord(record, tenant = {}) {
  const tenantId = String(tenant?._id || tenant?.id || "").trim();
  if (!record) return { enabled: false, reason: "not_configured", revision: 0 };
  if (record.killSwitch !== false) {
    return { enabled: false, reason: "kill_switch", revision: Number(record.revision || 0) };
  }
  if (record.state === "disabled") {
    return { enabled: false, reason: "disabled", revision: Number(record.revision || 0) };
  }
  if (!tenantId) {
    return { enabled: false, reason: "tenant_required", revision: Number(record.revision || 0) };
  }
  const excluded = new Set(uniqueIds(record.excludedTenantIds));
  if (excluded.has(tenantId)) {
    return { enabled: false, reason: "control_tenant", revision: Number(record.revision || 0) };
  }
  if (record.state === "pilot") {
    const targets = new Set(uniqueIds(record.tenantIds));
    return {
      enabled: targets.has(tenantId),
      reason: targets.has(tenantId) ? "pilot_target" : "outside_pilot",
      revision: Number(record.revision || 0)
    };
  }
  return { enabled: true, reason: "enabled", revision: Number(record.revision || 0) };
}

function isMissingRolloutSchema(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  return code === "42P01" || code === "PGRST205" || /feature_rollouts.*(does not exist|schema cache)/i.test(message);
}

export function clearFeatureRolloutCache(featureKey = "") {
  if (featureKey) rolloutCache.delete(featureKey);
  else rolloutCache.clear();
}

export async function getFeatureRollout(featureKey) {
  const key = String(featureKey || "").trim();
  if (!SUPPORTED_FEATURE_ROLLOUTS[key]) {
    return { record: null, controlAvailable: false, reason: "unsupported_feature" };
  }
  const cached = rolloutCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  try {
    const record = await FeatureRolloutModel.findOne({ featureKey: key });
    const value = { record, controlAvailable: true, reason: record ? "configured" : "not_configured" };
    rolloutCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  } catch (error) {
    if (!isMissingRolloutSchema(error)) throw error;
    return { record: null, controlAvailable: false, reason: "schema_unavailable" };
  }
}

export async function evaluateFeatureRollout(featureKey, tenant) {
  if (isHardDisabledFeature(featureKey)) {
    return { enabled: false, reason: "hard_disabled", revision: 0, controlAvailable: false };
  }
  const status = await getFeatureRollout(featureKey);
  return {
    ...evaluateFeatureRolloutRecord(status.record, tenant),
    controlAvailable: status.controlAvailable
  };
}

/**
 * Read every rollout the console needs in one query instead of one per flag.
 *
 * `listFeatureRollouts` called `getFeatureRollout` in a loop, so a cold cache
 * meant a sequential round trip per feature — a cost that grew every time
 * someone added a flag, on a page that shows all of them at once. Cached keys
 * are still served from the cache; only the misses are fetched, together.
 */
async function loadSupportedRollouts() {
  const keys = Object.keys(SUPPORTED_FEATURE_ROLLOUTS);
  const statuses = new Map();
  const missing = [];

  for (const key of keys) {
    const cached = rolloutCache.get(key);
    if (cached && cached.expiresAt > Date.now()) statuses.set(key, cached.value);
    else missing.push(key);
  }

  if (!missing.length) return statuses;

  try {
    const records = await FeatureRolloutModel.find({ featureKey: { $in: missing } });
    const byKey = new Map(records.map((record) => [String(record.featureKey || ""), record]));
    const expiresAt = Date.now() + CACHE_TTL_MS;
    for (const key of missing) {
      const record = byKey.get(key) || null;
      const value = {
        record,
        controlAvailable: true,
        reason: record ? "configured" : "not_configured"
      };
      rolloutCache.set(key, { value, expiresAt });
      statuses.set(key, value);
    }
  } catch (error) {
    if (!isMissingRolloutSchema(error)) throw error;
    // A missing table is not cached: the migration may land at any moment.
    for (const key of missing) {
      statuses.set(key, { record: null, controlAvailable: false, reason: "schema_unavailable" });
    }
  }

  return statuses;
}

export async function listFeatureRollouts() {
  const items = [];
  let controlAvailable = true;
  const statuses = await loadSupportedRollouts();
  for (const [featureKey, definition] of Object.entries(SUPPORTED_FEATURE_ROLLOUTS)) {
    const status = statuses.get(featureKey) || {
      record: null,
      controlAvailable: false,
      reason: "unsupported_feature"
    };
    controlAvailable = controlAvailable && status.controlAvailable;
    const record = status.record;
    items.push({
      featureKey,
      ...definition,
      state: record?.state || "disabled",
      killSwitch: record?.killSwitch !== false,
      tenantIds: uniqueIds(record?.tenantIds),
      excludedTenantIds: uniqueIds(record?.excludedTenantIds),
      revision: Number(record?.revision || 0),
      updatedAt: record?.updatedAt || null,
      configured: Boolean(record)
    });
  }
  return { controlAvailable, items };
}

export async function saveFeatureRollout(featureKey, input, actorUserId) {
  const key = String(featureKey || "").trim();
  if (!SUPPORTED_FEATURE_ROLLOUTS[key]) {
    const error = new Error("Unsupported rollout key.");
    error.code = "ROLLOUT_NOT_SUPPORTED";
    error.statusCode = 404;
    throw error;
  }
  const normalized = normalizeFeatureRolloutInput(input);
  const current = await FeatureRolloutModel.findOne({ featureKey: key });
  const payload = {
    ...normalized,
    featureKey: key,
    revision: Number(current?.revision || 0) + 1,
    updatedByUserId: String(actorUserId || "").trim() || null,
    updatedAt: new Date().toISOString()
  };
  const saved = current
    ? await FeatureRolloutModel.update(current._id, payload)
    : await FeatureRolloutModel.create(payload);
  clearFeatureRolloutCache(key);
  return { previous: current, saved };
}
