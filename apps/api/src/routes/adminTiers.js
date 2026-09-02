import { Router } from "express";
import {
  TENANT_MODULE_CATALOG,
  describeTierFloor,
  normalizeTierModuleFloors,
  resolveTenantModules
} from "@pondbridge/shared";
import { requireTenantRoleScope } from "../middleware/tenantAccess.js";
import {
  MemberAccessTierModel,
  ProfileModel,
  TenantAdminAuditLogModel,
  TenantModel
} from "../db/models/index.js";
import {
  MAX_TIERS,
  MIN_TIERS,
  clearTierCaches,
  isTieredAccessModuleEnabled,
  listTenantTiers,
  resolveTenantTierPolicy,
  tierError
} from "../services/memberTiers.js";
import { sanitizeText } from "../utils/sanitize.js";
import { isValidObjectId } from "../utils/objectId.js";

const router = Router({ mergeParams: true });
router.use(...requireTenantRoleScope("tenant_admin"));

// The entire workspace is invisible until the camp switches the module on in
// Settings -> Features. Nothing here answers before that.
router.use((req, res, next) => {
  if (isTieredAccessModuleEnabled(req.tenant)) return next();
  return res.status(404).json({
    error: {
      code: "TIERED_ACCESS_UNAVAILABLE",
      message: "Tiered access is not switched on for this camp."
    }
  });
});

// Every module a camp can put behind a tier. Tiered access itself is not one of
// them, and neither is the directory's dependants list, which is derived.
const TIERABLE_MODULES = TENANT_MODULE_CATALOG.filter((module) => module.key !== "tieredAccess");

function toId(value = "") {
  return String(value || "").trim();
}

function tierLabel(value = "") {
  return sanitizeText(String(value || "").trim()).slice(0, 40);
}

async function audit(req, event, metadata = {}) {
  if (!req?.tenant?._id) return;
  try {
    await TenantAdminAuditLogModel.create({
      tenantId: req.tenant._id,
      actorUserId: req.user?.id || null,
      event,
      metadata: {
        ...metadata,
        requestId: String(req.requestId || ""),
        route: String(req.originalUrl || req.path || ""),
        method: String(req.method || "").toUpperCase()
      }
    });
  } catch {
    // Never fail a tier operation because audit logging failed.
  }
}

async function loadMemberProfiles(tenantId) {
  return ProfileModel.find(
    tenantId,
    { status: { $ne: "removed" } },
    {
      select: [
        "id",
        "userId",
        "firstName",
        "lastName",
        "emails",
        "avatarUrl",
        "cityState",
        "roleAtCamp",
        "accessTierId",
        "accessTierRank"
      ],
      sort: { lastName: 1, firstName: 1 },
      limit: 20_000
    }
  );
}

function rosterRow(profile = {}) {
  const firstName = String(profile.firstName || "").trim();
  const lastName = String(profile.lastName || "").trim();
  const rank = Number(profile.accessTierRank);
  return {
    profileId: toId(profile._id || profile.id),
    userId: toId(profile.userId),
    firstName,
    lastName,
    fullName: [firstName, lastName].filter(Boolean).join(" ").trim(),
    email: String((Array.isArray(profile.emails) ? profile.emails : []).find(Boolean) || ""),
    role: String(profile.roleAtCamp || "").trim(),
    location: String(profile.cityState || "").trim(),
    avatarUrl: String(profile.avatarUrl || ""),
    tierRank: Number.isFinite(rank) && rank >= 1 ? rank : null
  };
}

/**
 * Whether the camp is allowed to switch enforcement on yet. Turning tiering on
 * with nobody tagged would hide the network from everyone at once, so the
 * server refuses rather than trusting the client to hide the control.
 */
function enableReadiness({ tiers = [], untaggedCount = 0, memberTotal = 0 }) {
  if (tiers.length < MIN_TIERS) {
    return { canEnable: false, reason: `Define at least ${MIN_TIERS} tiers first.` };
  }
  if (memberTotal > 0 && untaggedCount === memberTotal) {
    return { canEnable: false, reason: "Tag at least some members before turning this on." };
  }
  return { canEnable: true, reason: "" };
}

async function buildOverview(req) {
  const tenantId = req.tenant._id;
  const [tiers, profiles] = await Promise.all([
    listTenantTiers(tenantId),
    loadMemberProfiles(tenantId)
  ]);

  const policy = resolveTenantTierPolicy(req.tenant);
  const bottomRank = tiers.length ? tiers[tiers.length - 1].rank : 0;
  const countsByRank = new Map();
  let untaggedCount = 0;
  for (const profile of profiles) {
    const rank = Number(profile.accessTierRank);
    if (Number.isFinite(rank) && rank >= 1) {
      countsByRank.set(rank, (countsByRank.get(rank) || 0) + 1);
    } else {
      untaggedCount += 1;
    }
  }

  const campModules = resolveTenantModules(req.tenant?.modules || {});
  const floors = policy.tierModules;
  const readiness = enableReadiness({
    tiers,
    untaggedCount,
    memberTotal: profiles.length
  });

  return {
    available: true,
    enabled: Boolean(policy.enabled && tiers.length >= MIN_TIERS),
    limits: { min: MIN_TIERS, max: MAX_TIERS },
    tiers: tiers.map((tier, index) => ({
      ...tier,
      memberCount: countsByRank.get(tier.rank) || 0,
      seesFrom: tier.rank,
      seesTo: bottomRank,
      isTop: index === 0,
      isBottom: index === tiers.length - 1
    })),
    bottomRank,
    untaggedRank: policy.untaggedRank || bottomRank,
    untaggedCount,
    memberTotal: profiles.length,
    taggedCount: profiles.length - untaggedCount,
    ...readiness,
    modules: TIERABLE_MODULES.map((module) => {
      const floor = module.key in floors ? Number(floors[module.key]) : bottomRank;
      return {
        key: module.key,
        label: module.label,
        description: module.description,
        dependsOn: Array.isArray(module.dependsOn) ? module.dependsOn : [],
        campEnabled: campModules[module.key] !== false,
        floor,
        summary: describeTierFloor(floor, bottomRank)
      };
    })
  };
}

async function saveTierSettings(req, patch = {}) {
  const current =
    req.tenant?.accessSettings && typeof req.tenant.accessSettings === "object"
      ? req.tenant.accessSettings
      : {};
  const currentTiers =
    current.tiers && typeof current.tiers === "object" ? current.tiers : {};

  const tenant = await TenantModel.update(req.tenant._id, {
    accessSettings: {
      ...current,
      tiers: { ...currentTiers, ...patch }
    }
  });
  req.tenant = tenant;
  clearTierCaches();
  return tenant;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

router.get("/", async (req, res, next) => {
  try {
    return res.json(await buildOverview(req));
  } catch (error) {
    return next(error);
  }
});

router.get("/roster", async (req, res, next) => {
  try {
    const profiles = await loadMemberProfiles(req.tenant._id);
    const rows = profiles.map(rosterRow);

    const q = String(req.query.q || "").trim().toLowerCase();
    const scope = String(req.query.scope || "untagged").trim().toLowerCase();
    const rankFilter = Number(req.query.rank);
    const page = Math.max(1, Number(req.query.page || 1) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 25) || 25));

    const filtered = rows.filter((row) => {
      if (scope === "untagged" && row.tierRank !== null) return false;
      if (scope === "tier" && row.tierRank !== rankFilter) return false;
      if (!q) return true;
      return [row.fullName, row.email, row.role, row.location]
        .some((value) => String(value || "").toLowerCase().includes(q));
    });

    const roleCounts = new Map();
    for (const row of rows) {
      if (!row.role) continue;
      roleCounts.set(row.role, (roleCounts.get(row.role) || 0) + 1);
    }

    return res.json({
      total: filtered.length,
      page,
      pageSize,
      items: filtered.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize),
      roleOptions: [...roleCounts.entries()]
        .map(([role, count]) => ({ role, count }))
        .sort((left, right) => right.count - left.count || left.role.localeCompare(right.role))
    });
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// Tier definitions — ranks stay contiguous, so a camp appends or pops the
// bottom rather than reordering. The number is the identity; only the label
// is editable in place.
// ---------------------------------------------------------------------------

router.post("/", async (req, res, next) => {
  try {
    const tiers = await listTenantTiers(req.tenant._id);
    if (tiers.length >= MAX_TIERS) {
      throw tierError(`A camp can have at most ${MAX_TIERS} tiers.`, "TIER_LIMIT_REACHED");
    }
    const rank = tiers.length ? tiers[tiers.length - 1].rank + 1 : 1;
    const tier = await MemberAccessTierModel.create({
      tenantId: req.tenant._id,
      rank,
      label: tierLabel(req.body?.label) || `Tier ${rank}`
    });
    clearTierCaches();
    await audit(req, "admin_access_tier_created", { rank, tierId: toId(tier._id) });
    return res.status(201).json(await buildOverview(req));
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: { code: error.code, message: error.message } });
    }
    return next(error);
  }
});

router.patch("/:tierId", async (req, res, next) => {
  try {
    const tierId = toId(req.params.tierId);
    if (!isValidObjectId(tierId)) {
      throw tierError("Invalid tier id.", "INVALID_TIER_ID");
    }
    const tier = await MemberAccessTierModel.findOne(req.tenant._id, { _id: tierId });
    if (!tier) throw tierError("Tier not found.", "TIER_NOT_FOUND", 404);

    await MemberAccessTierModel.update(tier._id, {
      label: tierLabel(req.body?.label),
      updatedAt: new Date()
    });
    clearTierCaches();
    await audit(req, "admin_access_tier_renamed", { tierId, rank: Number(tier.rank) });
    return res.json(await buildOverview(req));
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: { code: error.code, message: error.message } });
    }
    return next(error);
  }
});

router.delete("/:tierId", async (req, res, next) => {
  try {
    const tierId = toId(req.params.tierId);
    const tiers = await listTenantTiers(req.tenant._id);
    const tier = tiers.find((entry) => entry.id === tierId);
    if (!tier) throw tierError("Tier not found.", "TIER_NOT_FOUND", 404);

    // Only the bottom tier can go, which is what keeps ranks contiguous and
    // means no member is ever silently promoted into a tier that sees more.
    if (tier.rank !== tiers[tiers.length - 1].rank) {
      throw tierError("Only the lowest tier can be removed.", "TIER_NOT_BOTTOM");
    }
    if (tiers.length <= MIN_TIERS) {
      throw tierError(`Keep at least ${MIN_TIERS} tiers.`, "TIER_MINIMUM_REACHED");
    }

    const newBottom = tiers[tiers.length - 2];
    // Members in the tier being removed move up into the new bottom tier, which
    // is the only move that never widens what someone can see.
    const moved = await ProfileModel.updateMany(
      req.tenant._id,
      { accessTierId: tier.id },
      { accessTierId: newBottom.id, accessTierRank: newBottom.rank, updatedAt: new Date() }
    );
    await MemberAccessTierModel.delete(tier.id);

    const policy = resolveTenantTierPolicy(req.tenant);
    if (policy.untaggedRank && policy.untaggedRank > newBottom.rank) {
      await saveTierSettings(req, { untaggedRank: newBottom.rank });
    }

    clearTierCaches();
    await audit(req, "admin_access_tier_deleted", {
      tierId,
      rank: tier.rank,
      movedMembers: Array.isArray(moved) ? moved.length : 0
    });
    return res.json(await buildOverview(req));
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: { code: error.code, message: error.message } });
    }
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// Settings — the enforcement switch, the untagged default, feature floors
// ---------------------------------------------------------------------------

router.patch("/settings", async (req, res, next) => {
  try {
    const tiers = await listTenantTiers(req.tenant._id);
    const bottomRank = tiers.length ? tiers[tiers.length - 1].rank : 0;
    const patch = {};

    if ("untaggedRank" in (req.body || {})) {
      const rank = Number(req.body.untaggedRank);
      if (!Number.isFinite(rank) || rank < 1 || rank > bottomRank) {
        throw tierError("Choose a tier for untagged members.", "INVALID_UNTAGGED_TIER");
      }
      patch.untaggedRank = Math.trunc(rank);
    }

    if ("tierModules" in (req.body || {})) {
      const floors = normalizeTierModuleFloors(req.body.tierModules);
      // Search and related profiles cannot outrun the directory they read from,
      // which resolveTenantModules would otherwise silently override.
      const directoryFloor = "directory" in floors ? floors.directory : bottomRank;
      for (const key of ["search", "relatedProfiles"]) {
        if (key in floors) floors[key] = Math.min(floors[key], directoryFloor);
      }
      patch.tierModules = floors;
    }

    if ("enabled" in (req.body || {})) {
      const enabled = req.body.enabled === true;
      if (enabled) {
        const overview = await buildOverview(req);
        if (!overview.canEnable) {
          throw tierError(overview.reason, "TIER_NOT_READY");
        }
      }
      patch.enabled = enabled;
    }

    if (!Object.keys(patch).length) {
      throw tierError("Nothing to update.", "TIER_SETTINGS_EMPTY");
    }

    await saveTierSettings(req, patch);
    await audit(req, "admin_access_tier_settings_updated", {
      changed: Object.keys(patch),
      enabled: patch.enabled
    });
    return res.json(await buildOverview(req));
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: { code: error.code, message: error.message } });
    }
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// Tagging
// ---------------------------------------------------------------------------

async function assignProfilesToRank(req, profileIds = [], rank = null) {
  const tiers = await listTenantTiers(req.tenant._id);
  const ids = [...new Set(profileIds.map(toId).filter(isValidObjectId))].slice(0, 1000);
  if (!ids.length) throw tierError("Select at least one person.", "TIER_ASSIGN_EMPTY");

  let patch = { accessTierId: null, accessTierRank: null, updatedAt: new Date() };
  if (rank !== null) {
    const tier = tiers.find((entry) => entry.rank === Number(rank));
    if (!tier) throw tierError("That tier does not exist.", "TIER_NOT_FOUND", 404);
    patch = { accessTierId: tier.id, accessTierRank: tier.rank, updatedAt: new Date() };
  }

  const updated = await ProfileModel.updateMany(req.tenant._id, { _id: { $in: ids } }, patch);
  clearTierCaches();
  return Array.isArray(updated) ? updated.length : ids.length;
}

router.post("/assign", async (req, res, next) => {
  try {
    const rawRank = req.body?.rank;
    const rank = rawRank === null || rawRank === undefined || rawRank === "" ? null : Number(rawRank);
    const count = await assignProfilesToRank(req, req.body?.profileIds || [], rank);
    await audit(req, "admin_access_tier_assigned", { rank, count });
    return res.json({ ok: true, count, overview: await buildOverview(req) });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: { code: error.code, message: error.message } });
    }
    return next(error);
  }
});

/**
 * Rule assist: tag everyone whose camp role matches, in one request. This is
 * what makes a six-hundred-person roster tractable, because camp tiers almost
 * always correlate with a role already on the profile.
 */
router.post("/assign-by-role", async (req, res, next) => {
  try {
    const role = String(req.body?.role || "").trim();
    const rank = Number(req.body?.rank);
    if (!role) throw tierError("Choose a camp role to match.", "TIER_RULE_ROLE_REQUIRED");

    const tiers = await listTenantTiers(req.tenant._id);
    const tier = tiers.find((entry) => entry.rank === rank);
    if (!tier) throw tierError("That tier does not exist.", "TIER_NOT_FOUND", 404);

    const profiles = await loadMemberProfiles(req.tenant._id);
    const matchingIds = profiles
      .filter((profile) => String(profile.roleAtCamp || "").trim().toLowerCase() === role.toLowerCase())
      .map((profile) => toId(profile._id || profile.id));

    if (!matchingIds.length) {
      return res.json({ ok: true, count: 0, overview: await buildOverview(req) });
    }

    const count = await assignProfilesToRank(req, matchingIds, tier.rank);
    await audit(req, "admin_access_tier_rule_applied", { role, rank: tier.rank, count });
    return res.json({ ok: true, count, overview: await buildOverview(req) });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: { code: error.code, message: error.message } });
    }
    return next(error);
  }
});

export default router;
