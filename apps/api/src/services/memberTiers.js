import { resolveTenantModules, resolveModulesForTier, normalizeTierModuleFloors } from "@pondbridge/shared";
import { MemberAccessTierModel, ProfileModel, TenantModel } from "../db/models/index.js";
import { createTtlCache } from "../utils/ttlCache.js";
import { getMutuallyBlockedUserIds, isSafetyModerator } from "./memberSafety.js";

export const MIN_TIERS = 2;
export const MAX_TIERS = 6;

// Admins and super admins sit above every numbered tier, so they see everything.
// Rank 1 is the top tier a camp can define, which leaves 0 free for this.
export const ADMIN_TIER_RANK = 0;

const tierListCache = createTtlCache({ ttlMs: 30_000, maxEntries: 500 });
const EMPTY_HIDDEN = Object.freeze({ userIds: [], profileIds: [] });
const hiddenIdsCache = createTtlCache({ ttlMs: 30_000, maxEntries: 2000 });

function normalizeId(value = "") {
  return String(value || "").trim();
}

function tierError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

/**
 * The camp-level switch. Tiered access is a module a camp opts into, so the
 * whole system — tab included — stays invisible until it is turned on.
 */
export function isTieredAccessModuleEnabled(tenant = null) {
  const modules = resolveTenantModules(tenant?.modules || {});
  return modules.tieredAccess === true;
}

/**
 * Reads the tier settings off the tenant without touching the database. Every
 * enforcement path calls this first, so a camp that has not enabled tiering
 * pays nothing beyond an object lookup.
 */
export function resolveTenantTierPolicy(tenant = null) {
  const moduleEnabled = isTieredAccessModuleEnabled(tenant);
  const source =
    tenant?.accessSettings?.tiers && typeof tenant.accessSettings.tiers === "object"
      ? tenant.accessSettings.tiers
      : {};

  const untaggedRank = Number(source.untaggedRank);
  return {
    moduleEnabled,
    // Both switches have to be on. `enabled` is still provisional here — a camp
    // with fewer than MIN_TIERS defined is treated as off by getTierContext.
    enabled: moduleEnabled && source.enabled === true,
    untaggedRank: Number.isFinite(untaggedRank) && untaggedRank >= 1 ? untaggedRank : null,
    tierModules: normalizeTierModuleFloors(source.tierModules)
  };
}

export async function listTenantTiers(tenantId) {
  const key = `tiers:${normalizeId(tenantId)}`;
  const cached = tierListCache.get(key);
  if (cached) return cached;

  const rows = await MemberAccessTierModel.find(
    normalizeId(tenantId),
    {},
    { sort: { rank: 1 }, limit: MAX_TIERS }
  );
  const tiers = rows
    .map((row) => ({
      id: normalizeId(row._id || row.id),
      rank: Number(row.rank),
      label: String(row.label || "")
    }))
    .filter((tier) => Number.isFinite(tier.rank) && tier.rank >= 1)
    .sort((left, right) => left.rank - right.rank);

  tierListCache.set(key, tiers);
  return tiers;
}

/**
 * The resolved, database-backed view of a camp's tiering. Fails safe: a camp
 * that flipped the switch but has not defined enough tiers is reported as off
 * rather than hiding the whole network from everyone.
 */
export async function getTierContext(tenant = null) {
  const policy = resolveTenantTierPolicy(tenant);
  const off = { ...policy, enabled: false, tiers: [], bottomRank: 0, untaggedRank: 0 };
  if (!policy.enabled) return off;

  const tiers = await listTenantTiers(tenant?._id);
  if (tiers.length < MIN_TIERS) return { ...off, tiers };

  const bottomRank = tiers[tiers.length - 1].rank;
  const untaggedRank = Math.min(Math.max(policy.untaggedRank || bottomRank, 1), bottomRank);
  return { ...policy, enabled: true, tiers, bottomRank, untaggedRank };
}

/**
 * The viewer's rank, or null when tiering is not active for this camp.
 * Untagged members fall back to the camp's configured default.
 */
export async function getViewerTierRank(tenant = null, userId = "", { user = null, context = null } = {}) {
  const ctx = context || (await getTierContext(tenant));
  if (!ctx.enabled) return null;
  if (isSafetyModerator(user || {})) return ADMIN_TIER_RANK;

  const profile = await ProfileModel.findByUserId(tenant?._id, normalizeId(userId));
  const rank = Number(profile?.accessTierRank);
  return Number.isFinite(rank) && rank >= 1 ? rank : ctx.untaggedRank;
}

/**
 * Everyone the viewer must not see: members whose rank is above their own
 * (a smaller number). Shaped as a user-id list so it composes with the member
 * block list at every call site that already filters one.
 */
export async function getTierHiddenIdentifiers(
  tenant = null,
  userId = "",
  { user = null, context = null, viewerRank = undefined } = {}
) {
  const ctx = context || (await getTierContext(tenant));
  if (!ctx.enabled) return EMPTY_HIDDEN;

  const rank =
    viewerRank === undefined
      ? await getViewerTierRank(tenant, userId, { user, context: ctx })
      : viewerRank;

  // Admins and the top tier see the whole network.
  if (rank === null || rank === ADMIN_TIER_RANK || rank <= 1) return EMPTY_HIDDEN;

  const tenantId = normalizeId(tenant?._id);
  const cacheKey = `hidden:${tenantId}:${rank}:${ctx.untaggedRank}`;
  const cached = hiddenIdsCache.get(cacheKey);
  if (cached) return cached;

  const select = ["id", "userId"];
  const queries = [
    ProfileModel.find(tenantId, { accessTierRank: { $lt: rank } }, { select, limit: 20_000 })
  ];
  // Untagged members are only hidden when the camp parks them above the viewer.
  if (ctx.untaggedRank < rank) {
    queries.push(ProfileModel.find(tenantId, { accessTierRank: null }, { select, limit: 20_000 }));
  }

  const results = (await Promise.all(queries)).flat();
  const hidden = {
    userIds: [...new Set(results.map((row) => normalizeId(row?.userId)).filter(Boolean))].sort(),
    profileIds: [
      ...new Set(results.map((row) => normalizeId(row?._id || row?.id)).filter(Boolean))
    ].sort()
  };

  hiddenIdsCache.set(cacheKey, hidden);
  return hidden;
}

/**
 * The single filter every member-facing surface should use: member blocks and
 * tier visibility unioned. Identical to the block list when tiering is off.
 */
export async function getHiddenUserIds(tenant = null, userId = "", { user = null } = {}) {
  const tenantId = normalizeId(tenant?._id);
  const blocked = await getMutuallyBlockedUserIds(tenantId, userId, { user });

  const policy = resolveTenantTierPolicy(tenant);
  if (!policy.enabled) return blocked;

  const tierHidden = await getTierHiddenIdentifiers(tenant, userId, { user });
  if (!tierHidden.userIds.length) return blocked;
  return [...new Set([...blocked, ...tierHidden.userIds])].sort();
}

/**
 * The same hidden set addressed by profile id, for the surfaces that identify
 * people that way — family trees and the giving supporter list.
 */
export async function getHiddenProfileIds(tenant = null, userId = "", { user = null } = {}) {
  const tenantId = normalizeId(tenant?._id);
  const policy = resolveTenantTierPolicy(tenant);
  const blocked = await getMutuallyBlockedUserIds(tenantId, userId, { user });

  const tierHidden = policy.enabled
    ? await getTierHiddenIdentifiers(tenant, userId, { user })
    : EMPTY_HIDDEN;

  // Blocks are recorded against users, so their profile ids need a lookup. The
  // list is capped at 500 each way, so this stays a small query.
  let blockedProfileIds = [];
  if (blocked.length) {
    const rows = await ProfileModel.find(tenantId, { userId: { $in: blocked } }, {
      select: ["id"],
      limit: 1000
    });
    blockedProfileIds = rows.map((row) => normalizeId(row?._id || row?.id)).filter(Boolean);
  }

  return [...new Set([...blockedProfileIds, ...tierHidden.profileIds])].sort();
}

/**
 * Contact is allowed when the actor can see the target. Reaching downward is
 * therefore fine — leadership can start a conversation with an alum — but
 * reaching up at someone invisible to you is not.
 */
export async function assertTierContactAllowed(
  tenant = null,
  actorUserId = "",
  targetUserId = "",
  { user = null } = {}
) {
  const ctx = await getTierContext(tenant);
  if (!ctx.enabled) return;
  if (isSafetyModerator(user || {})) return;

  const actorId = normalizeId(actorUserId);
  const targetId = normalizeId(targetUserId);
  if (!actorId || !targetId || actorId === targetId) return;

  const [actorRank, targetRank] = await Promise.all([
    getViewerTierRank(tenant, actorId, { user, context: ctx }),
    getViewerTierRank(tenant, targetId, { user: null, context: ctx })
  ]);

  if (!canViewerSeeRank(actorRank, targetRank)) {
    throw tierError(
      "That member is not available in your part of the network.",
      "MEMBER_TIER_RESTRICTED",
      403
    );
  }
}

/**
 * The conversation-shaped form of the same rule, mirroring
 * assertConversationDirectContactAllowed so both guards sit side by side at
 * every call site.
 */
export async function assertConversationTierContactAllowed(
  tenant = null,
  conversation = {},
  actorUserId = "",
  { user = null } = {}
) {
  if (String(conversation?.type || "").trim().toLowerCase() !== "dm") return;
  const actorId = normalizeId(actorUserId);
  const otherUserId = (conversation?.participantIds || [])
    .map(normalizeId)
    .find((participantId) => participantId && participantId !== actorId);
  if (otherUserId) await assertTierContactAllowed(tenant, actorId, otherUserId, { user });
}

/**
 * The whole visibility rule, in one place: a viewer at rank N sees rank N and
 * every larger rank. Admins (rank 0) and a null rank — tiering off, or an
 * unresolved viewer — see everyone.
 */
export function canViewerSeeRank(viewerRank = null, targetRank = null) {
  if (viewerRank === null || viewerRank === ADMIN_TIER_RANK) return true;
  if (targetRank === null) return true;
  return Number(targetRank) >= Number(viewerRank);
}

/**
 * Single-profile form of the visibility rule, for the routes that fetch one
 * person by id rather than filtering a list.
 */
export async function isUserHiddenByTier(
  tenant = null,
  viewerUserId = "",
  targetUserId = "",
  { user = null } = {}
) {
  const ctx = await getTierContext(tenant);
  if (!ctx.enabled) return false;
  if (isSafetyModerator(user || {})) return false;

  const viewerId = normalizeId(viewerUserId);
  const targetId = normalizeId(targetUserId);
  if (!viewerId || !targetId || viewerId === targetId) return false;

  const [viewerRank, targetRank] = await Promise.all([
    getViewerTierRank(tenant, viewerId, { user, context: ctx }),
    getViewerTierRank(tenant, targetId, { user: null, context: ctx })
  ]);
  return !canViewerSeeRank(viewerRank, targetRank);
}

/** Whether a viewer's tier reaches a module. True whenever tiering is off. */
export function tierCanUseModule(context = null, viewerRank = null, moduleKey = "") {
  if (!context?.enabled) return true;
  if (viewerRank === null || viewerRank === ADMIN_TIER_RANK) return true;
  const floors = context.tierModules || {};
  if (!(moduleKey in floors)) return true;
  const floor = Number(floors[moduleKey]);
  if (!Number.isFinite(floor)) return true;
  return viewerRank <= floor;
}

/** The module set a given viewer actually gets, for the member nav. */
export function resolveViewerModules(tenant = null, context = null, viewerRank = null) {
  const modules = resolveTenantModules(tenant?.modules || {});
  if (!context?.enabled || viewerRank === null || viewerRank === ADMIN_TIER_RANK) return modules;
  return resolveModulesForTier(modules, context.tierModules, viewerRank);
}

/**
 * Called after any tier write so a director sees their change immediately
 * instead of waiting out the read cache. Both caches are small and rebuild on
 * the next request, so clearing wholesale is cheaper than tracking keys.
 */
// ---------------------------------------------------------------------------
// Tenant-id entry points
//
// The realtime server only carries a tenant id, so it cannot do the cheap
// in-memory policy check the HTTP middleware does. A short-lived tenant cache
// keeps that to one query per tenant per TTL rather than one per socket event.
// ---------------------------------------------------------------------------

const tenantCache = createTtlCache({ ttlMs: 30_000, maxEntries: 500 });

async function loadTenant(tenantId) {
  const id = normalizeId(tenantId);
  if (!id) return null;
  const cached = tenantCache.get(`tenant:${id}`);
  if (cached) return cached;
  try {
    const tenant = await TenantModel.findOne({ _id: id });
    if (tenant) tenantCache.set(`tenant:${id}`, tenant);
    return tenant;
  } catch {
    // Realtime auth must not die because a tenant read blipped. Returning null
    // leaves the caller on its pre-tiering behaviour, which is the same answer
    // a camp without tiering would get.
    return null;
  }
}

export async function getHiddenUserIdsByTenantId(tenantId, userId = "", { user = null } = {}) {
  const tenant = await loadTenant(tenantId);
  if (!tenant) {
    return getMutuallyBlockedUserIds(normalizeId(tenantId), userId, { user }).catch(() => []);
  }
  return getHiddenUserIds(tenant, userId, { user });
}

export async function assertConversationTierContactAllowedByTenantId(
  tenantId,
  conversation = {},
  actorUserId = "",
  { user = null } = {}
) {
  // Only direct messages have a tier to check, and deciding that from the
  // conversation in hand avoids a tenant read on every group-room join.
  if (String(conversation?.type || "").trim().toLowerCase() !== "dm") return;
  const tenant = await loadTenant(tenantId);
  if (!tenant) return;
  await assertConversationTierContactAllowed(tenant, conversation, actorUserId, { user });
}

// ---------------------------------------------------------------------------
// Per-request memoization
//
// The content surfaces ask "who is hidden from me" several times per request,
// and each answer costs two block queries plus a tier query. Caching the
// *promise* on the request dedupes concurrent callers as well as sequential
// ones, and it expires with the request, so blocking someone still takes effect
// on their very next page load.
// ---------------------------------------------------------------------------

export function hiddenUserIdsFor(req) {
  if (!req.__hiddenUserIdsPromise) {
    req.__hiddenUserIdsPromise = getHiddenUserIds(req.tenant, req.user?.id, { user: req.user });
  }
  return req.__hiddenUserIdsPromise;
}

export function hiddenProfileIdsFor(req) {
  if (!req.__hiddenProfileIdsPromise) {
    req.__hiddenProfileIdsPromise = getHiddenProfileIds(req.tenant, req.user?.id, { user: req.user });
  }
  return req.__hiddenProfileIdsPromise;
}

/** The same answers as Sets, or null when nothing is hidden. */
export async function hiddenUserIdSetFor(req) {
  const ids = await hiddenUserIdsFor(req);
  return ids.length ? new Set(ids.map(String)) : null;
}

export async function hiddenProfileIdSetFor(req) {
  const ids = await hiddenProfileIdsFor(req);
  return ids.length ? new Set(ids.map(String)) : null;
}

export function clearTierCaches() {
  tierListCache.clear();
  hiddenIdsCache.clear();
  tenantCache.clear();
}

export { tierError };
