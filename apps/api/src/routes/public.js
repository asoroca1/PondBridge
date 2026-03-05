import { Router } from "express";
import rateLimit from "express-rate-limit";
import { TenantModel } from "../db/models/index.js";
import {
  alumniPluralForCampType,
  defaultNetworkDisplayNameForCamp,
  listFeaturesForPlan,
  normalizeCampType
} from "@pondbridge/shared";
import {
  buildTenantConfig,
  createDefaultChecklist,
  resolveContent,
  resolveTheme
} from "../services/onboarding.js";
import { buildTenantUrls } from "../utils/domainProvisioning.js";
import { buildBillingPublicSnapshot } from "../services/billing.js";
import { isTenantBillingAccessAllowed } from "../services/billingState.js";
import { resolveTenantFromRequest } from "../utils/tenantResolution.js";
import { env } from "../config/env.js";

const router = Router();
const AUTO_BOOTSTRAP_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,39}$/;
const PUBLIC_TENANT_CACHE_CONTROL = "public, max-age=60, s-maxage=300, stale-while-revalidate=600";
const PUBLIC_RESPONSE_CACHE_TTL_MS = 60 * 1000;
const PUBLIC_RESPONSE_CACHE_MAX_ENTRIES = 300;
const publicResponseCache = new Map();

function applyPublicTenantCacheHeaders(res) {
  res.set("Cache-Control", PUBLIC_TENANT_CACHE_CONTROL);
}

function publicResponseCacheKey(endpoint = "", lookup = "", value = "") {
  const normalizedEndpoint = String(endpoint || "").trim().toLowerCase();
  const normalizedLookup = String(lookup || "").trim().toLowerCase();
  const normalizedValue = String(value || "").trim().toLowerCase();
  if (!normalizedEndpoint || !normalizedLookup || !normalizedValue) return "";
  return `${normalizedEndpoint}:${normalizedLookup}:${normalizedValue}`;
}

function readPublicResponseCache(cacheKey = "") {
  if (!cacheKey) return null;
  const entry = publicResponseCache.get(cacheKey);
  if (!entry) return null;
  if (Date.now() >= Number(entry.expiresAt || 0)) {
    publicResponseCache.delete(cacheKey);
    return null;
  }
  return entry.payload || null;
}

function writePublicResponseCache(cacheKey = "", payload = null) {
  if (!cacheKey || !payload || typeof payload !== "object") return;
  if (publicResponseCache.size >= PUBLIC_RESPONSE_CACHE_MAX_ENTRIES) {
    const firstKey = publicResponseCache.keys().next().value;
    if (firstKey) publicResponseCache.delete(firstKey);
  }
  publicResponseCache.set(cacheKey, {
    expiresAt: Date.now() + PUBLIC_RESPONSE_CACHE_TTL_MS,
    payload
  });
}

function canAutoBootstrapSlug(slug = "") {
  const normalized = String(slug || "").trim().toLowerCase();
  return Boolean(normalized && AUTO_BOOTSTRAP_SLUG_PATTERN.test(normalized));
}

function defaultChecklistCompletedNow(campType = "coed") {
  const nowIso = new Date().toISOString();
  return createDefaultChecklist(campType).map((item) => ({
    ...item,
    status: "completed",
    completedAt: nowIso
  }));
}

async function maybeAutoBootstrapFirstTenant(slug = "") {
  const allowAutoBootstrapInRuntime =
    env.NODE_ENV !== "production" || env.ALLOW_PUBLIC_AUTO_BOOTSTRAP_FIRST_TENANT;
  if (!allowAutoBootstrapInRuntime) return null;

  const normalizedSlug = String(slug || "").trim().toLowerCase();
  if (!canAutoBootstrapSlug(normalizedSlug)) return null;

  const totalTenants = await TenantModel.count({});
  if (totalTenants > 0) return null;

  const campType = normalizeCampType("coed");
  const alumniWord = alumniPluralForCampType(campType, { capitalized: false });
  const networkName = defaultNetworkDisplayNameForCamp(normalizedSlug, campType);
  const tenant = await TenantModel.create({
    name: networkName,
    slug: normalizedSlug,
    status: "active",
    planTier: "premium",
    billingStatus: "active",
    onboardingStatus: "live",
    onboardingStep: "review_launch",
    onboardingChecklist: defaultChecklistCompletedNow(campType),
    onboardingProgress: {
      currentStep: 6,
      completedSteps: [1, 2, 3, 4, 5, 6],
      lastSavedAt: new Date().toISOString(),
      launchedAt: new Date().toISOString()
    },
    theme: {
      brandPrimary: "#002b5c",
      brandSecondary: "#d3dde8",
      brandAccent: "#f2b134",
      bg: "#f5f7fa",
      text: "#0f172a",
      card: "#ffffff",
      logoUrl: "",
      heroImageUrl: "",
      fontToken: "cedar_default"
    },
    content: {
      campType,
      networkDisplayName: networkName,
      welcomeHeadline: `Welcome to ${networkName}`,
      welcomeBody: `Reconnect with ${alumniWord}, staff, and directors from every era.`,
      aboutText: "This network was auto-bootstrapped after an empty database recovery event.",
      contactEmail: "",
      supportUrl: "",
      footerLinks: []
    },
    settings: {
      signupMode: "open",
      accessCodeHash: "",
      accessCodeHint: "",
      allowedEmailDomains: [],
      allowSearchByDefault: true,
      allowDirectoryBrowse: true,
      requireProfileCompletion: false
    },
    modules: {
      directory: true,
      search: true,
      photoStream: true,
      chat: true,
      map: true,
      familyTrees: true,
      relatedProfiles: true,
      newsletter: true,
      merchShop: true
    },
    accessSettings: { signupMode: "open", accessCode: "" },
    launch: {
      launchedAt: new Date().toISOString(),
      launchedByUserId: null
    }
  });
  return tenant;
}

const publicLookupLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many lookup requests. Please slow down."
    }
  }
});

function isSignupEnabled(tenant) {
  if (!(tenant?.status === "active" && tenant?.onboardingStatus === "live")) return false;
  return isTenantBillingAccessAllowed(tenant).allowed;
}

async function resolveTenantForPublicRequest(req) {
  const slug = String(req.query.slug || "").trim().toLowerCase();
  if (slug) {
    return {
      tenant: await TenantModel.findBySlug(slug),
      lookup: "slug",
      lookupValue: slug
    };
  }

  const host = String(req.query.host || "").trim().toLowerCase();
  if (host) {
    return {
      tenant: await TenantModel.findByDomain(host),
      lookup: "host",
      lookupValue: host
    };
  }

  const resolved = await resolveTenantFromRequest(req, { allowHeaderSlug: false });
  const hostFromRequest = String(resolved.host || "").trim().toLowerCase();
  if (!hostFromRequest) {
    return { tenant: null, lookup: "missing", lookupValue: "" };
  }

  return {
    tenant: resolved.tenant,
    lookup: "host",
    lookupValue: hostFromRequest
  };
}

router.get("/tenant-config", publicLookupLimiter, async (req, res, next) => {
  try {
    applyPublicTenantCacheHeaders(res);
    const requestedSlug = String(req.query.slug || "").trim().toLowerCase();
    const requestedHost = String(req.query.host || "").trim().toLowerCase();
    const cacheLookup = requestedSlug ? "slug" : requestedHost ? "host" : "";
    const cacheLookupValue = requestedSlug || requestedHost;
    const cacheKey = publicResponseCacheKey("tenant-config", cacheLookup, cacheLookupValue);
    const cached = readPublicResponseCache(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    let { tenant, lookup, lookupValue } = await resolveTenantForPublicRequest(req);
    if (!lookupValue) {
      return res.status(400).json({
        error: {
          code: "TENANT_LOOKUP_REQUIRED",
          message: "Provide query param 'slug' or 'host'."
        }
      });
    }

    if (!tenant && lookup === "slug") {
      tenant = await maybeAutoBootstrapFirstTenant(lookupValue);
    }

    if (!tenant) {
      return res.status(404).json({
        error: {
          code: "TENANT_NOT_FOUND",
          message:
            lookup === "slug"
              ? `Tenant '${lookupValue}' not found`
              : `Tenant for host '${lookupValue}' not found`
        }
      });
    }

    const config = buildTenantConfig(tenant, { includeSensitive: false });
    const network = buildTenantUrls(tenant);
    const billing = buildBillingPublicSnapshot(tenant);

    const payload = {
      id: String(tenant._id),
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
      planTier: tenant.planTier,
      billingStatus: billing.billingStatus,
      onboardingFeeAmount: billing.onboardingFeeAmount,
      onboardingFeePaid: billing.onboardingFeePaid,
      customDomain: tenant.customDomain || "",
      onboardingStatus: tenant.onboardingStatus,
      addOns: tenant.addOns || [],
      network,
      billing,
      config,
      theme: resolveTheme(tenant),
      content: resolveContent(tenant),
      accessSettings: {
        signupMode: "open",
        signupEnabled: isSignupEnabled(tenant)
      },
      modules: config.modules,
      features: listFeaturesForPlan(tenant.planTier, tenant.addOns || [])
    };

    if (cacheKey) {
      writePublicResponseCache(cacheKey, payload);
    }
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/tenant-status", publicLookupLimiter, async (req, res, next) => {
  try {
    applyPublicTenantCacheHeaders(res);
    const requestedSlug = String(req.query.slug || "").trim().toLowerCase();
    const requestedHost = String(req.query.host || "").trim().toLowerCase();
    const cacheLookup = requestedSlug ? "slug" : requestedHost ? "host" : "";
    const cacheLookupValue = requestedSlug || requestedHost;
    const cacheKey = publicResponseCacheKey("tenant-status", cacheLookup, cacheLookupValue);
    const cached = readPublicResponseCache(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const { tenant, lookup, lookupValue } = await resolveTenantForPublicRequest(req);
    if (!lookupValue) {
      return res.status(400).json({
        error: {
          code: "TENANT_LOOKUP_REQUIRED",
          message: "Provide query param 'slug' or 'host'."
        }
      });
    }

    if (!tenant) {
      return res.status(404).json({
        error: {
          code: "TENANT_NOT_FOUND",
          message:
            lookup === "slug"
              ? `Tenant '${lookupValue}' not found`
              : `Tenant for host '${lookupValue}' not found`
        }
      });
    }

    const billingAccess = isTenantBillingAccessAllowed(tenant);

    const payload = {
      slug: tenant.slug,
      status: tenant.status,
      onboardingStatus: tenant.onboardingStatus,
      signupEnabled: isSignupEnabled(tenant),
      billingAccess: {
        allowed: billingAccess.allowed,
        reason: billingAccess.reason,
        inGrace: billingAccess.inGrace
      },
      signupMode: "open"
    };

    if (cacheKey) {
      writePublicResponseCache(cacheKey, payload);
    }
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

export default router;
