import { Router } from "express";
import rateLimit from "express-rate-limit";
import { EmailPreferenceModel, TenantModel } from "../db/models/index.js";
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
import { suggestAddresses } from "../services/addressSuggest.js";
import { buildTenantUrls } from "../utils/domainProvisioning.js";
import {
  publicResponseCacheKey,
  readPublicResponseCache,
  writePublicResponseCache
} from "../utils/publicResponseCache.js";
import { generateUniqueMobileAppCode } from "../utils/mobileAppCode.js";
import { buildBillingPublicSnapshot } from "../services/billing.js";
import { isTenantBillingAccessAllowed, resolveTenantFeatureTier } from "../services/billingState.js";
import { resolveTenantFromRequest } from "../utils/tenantResolution.js";
import { resolveTenantAccessPolicy } from "../services/accessPolicy.js";
import { env } from "../config/env.js";
import {
  maskPreferenceEmail,
  readEmailPreferenceToken,
  setEmailPreferenceFromToken
} from "../services/emailPreferences.js";

const router = Router();
const AUTO_BOOTSTRAP_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,39}$/;
const PUBLIC_TENANT_CACHE_CONTROL = "public, max-age=60, s-maxage=300, stale-while-revalidate=600";
const PRIVATE_TENANT_CACHE_CONTROL = "no-store";

// Only a launched tenant may be cached by the browser or the CDN. A tenant that
// is still in onboarding changes on every wizard step, and a shared cache of
// its pre-launch payload keeps reporting `onboardingStatus: "in_progress"`
// after launch, which bounces the director straight back into the wizard.
function tenantAllowsSharedCaching(tenant = null) {
  return String(tenant?.onboardingStatus || "").trim().toLowerCase() === "live";
}

function applyPublicTenantCacheHeaders(res, tenant = null) {
  res.set(
    "Cache-Control",
    tenantAllowsSharedCaching(tenant) ? PUBLIC_TENANT_CACHE_CONTROL : PRIVATE_TENANT_CACHE_CONTROL
  );
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
      brandPrimary: "#252525",
      brandSecondary: "#dcdcdc",
      brandAccent: "#f2b134",
      bg: "#f5f7fa",
      text: "#171717",
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
      mobileAppCodeLookup: await generateUniqueMobileAppCode(),
      mobileAppCodeHint: `Generated (${new Date().toLocaleDateString("en-US")})`,
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
// Type-ahead fires per keystroke (debounced), so this sits well above the
// lookup limiter while still capping a single client's burst.
const publicAddressLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many address lookups. Please slow down."
    }
  }
});

const publicPreferenceLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many email preference requests. Please wait and try again."
    }
  }
});

function isSignupEnabled(tenant) {
  if (!(tenant?.status === "active" && tenant?.onboardingStatus === "live")) return false;
  return isTenantBillingAccessAllowed(tenant).allowed;
}

function hasDemoAccessEnabled(tenant = null) {
  const settings = tenant?.settings && typeof tenant.settings === "object" ? tenant.settings : {};
  const demoAccess = settings.demoAccess && typeof settings.demoAccess === "object" ? settings.demoAccess : {};
  return Boolean(demoAccess.enabled && String(demoAccess.codeHash || "").trim());
}

function normalizePublicTenantLookup(value = "") {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 100);
}

function tenantSlugCandidates(value = "") {
  const normalized = normalizePublicTenantLookup(value)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!normalized) return [];
  const withoutCampPrefix = normalized.replace(/^camp-/, "");
  return [...new Set([normalized, withoutCampPrefix].filter(Boolean))];
}

function publicTenantUnavailable(tenant = null) {
  if (!tenant || tenant.status !== "active" || tenant.onboardingStatus !== "live") return true;
  return !isTenantBillingAccessAllowed(tenant).allowed;
}

async function findPublicTenantByIdentifier(value = "") {
  const query = normalizePublicTenantLookup(value);
  if (!query) return null;

  const submittedCode = query.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (submittedCode.length >= 4) {
    const codeMatches = await TenantModel.find(
      {
        status: "active",
        onboardingStatus: "live",
        "settings.mobileAppCodeLookup": submittedCode
      },
      { limit: 2 }
    );
    if (codeMatches.length === 1) return codeMatches[0];
  }

  for (const slug of tenantSlugCandidates(query)) {
    const match = await TenantModel.findBySlug(slug);
    if (match) return match;
  }

  const nameMatches = await TenantModel.find(
    {
      status: "active",
      onboardingStatus: "live",
      name: { $ilike: query }
    },
    { limit: 2 }
  );
  return nameMatches.length === 1 ? nameMatches[0] : null;
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

router.get("/address-suggest", publicAddressLimiter, async (req, res, next) => {
  try {
    // The director has no account yet on the step that uses this, so the
    // endpoint is public. It reads nothing and returns only what the upstream
    // geocoder already publishes.
    const { suggestions, provider } = await suggestAddresses(req.query.q, {
      countryCode: req.query.country
    });
    res.set("Cache-Control", "private, max-age=60");
    res.json({ suggestions, provider });
  } catch (error) {
    next(error);
  }
});

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
      applyPublicTenantCacheHeaders(res, cached);
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
    const publicPolicy = resolveTenantAccessPolicy(tenant);
    const signupMode = publicPolicy.entryMode;

    const planTier = resolveTenantFeatureTier(tenant);
    const payload = {
      id: String(tenant._id),
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
      planTier,
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
        signupMode,
        // Public because the signup form has to promise the right thing: a
        // request that waits, or an account that works straight away.
        requireSignupApproval: publicPolicy.requireApproval,
        signupEnabled: isSignupEnabled(tenant),
        selfSignupEnabled: isSignupEnabled(tenant) && signupMode !== "invite_only",
        requiresAccessCode: signupMode === "code",
        hasAccessCode: Boolean(config.accessRules.accessCodeHash || tenant?.settings?.accessCodeHash),
        demoAccessEnabled: hasDemoAccessEnabled(tenant)
      },
      modules: config.modules,
      features: listFeaturesForPlan(planTier, tenant.addOns || [])
    };

    applyPublicTenantCacheHeaders(res, tenant);
    if (cacheKey && tenantAllowsSharedCaching(tenant)) {
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
      applyPublicTenantCacheHeaders(res, cached);
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
    const statusPolicy = resolveTenantAccessPolicy(tenant);
    const signupMode = statusPolicy.entryMode;

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
      signupMode,
      requireSignupApproval: statusPolicy.requireApproval,
      selfSignupEnabled: isSignupEnabled(tenant) && signupMode !== "invite_only",
      requiresAccessCode: signupMode === "code",
      demoAccessEnabled: hasDemoAccessEnabled(tenant)
    };

    applyPublicTenantCacheHeaders(res, tenant);
    if (cacheKey && tenantAllowsSharedCaching(tenant)) {
      writePublicResponseCache(cacheKey, payload);
    }
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/tenant-lookup", publicLookupLimiter, async (req, res, next) => {
  try {
    const query = normalizePublicTenantLookup(req.query.query || req.query.q || "");
    if (query.length < 2) {
      return res.status(400).json({
        error: {
          code: "TENANT_LOOKUP_REQUIRED",
          message: "Enter a camp name or code."
        }
      });
    }

    const tenant = await findPublicTenantByIdentifier(query);
    if (!tenant) {
      return res.status(404).json({
        error: {
          code: "TENANT_NOT_FOUND",
          message: "We could not find that camp. Check the name or code and try again."
        }
      });
    }

    if (publicTenantUnavailable(tenant)) {
      return res.status(403).json({
        error: {
          code: "TENANT_UNAVAILABLE",
          message: "That camp network is not accepting member access right now."
        }
      });
    }

    const network = buildTenantUrls(tenant);
    res.set("Cache-Control", "private, max-age=60");
    return res.json({
      id: String(tenant._id || tenant.id || ""),
      slug: String(tenant.slug || "").trim().toLowerCase(),
      name: String(tenant.name || "").trim(),
      networkDisplayName:
        String(tenant?.content?.networkDisplayName || "").trim() ||
        String(tenant.name || "").trim(),
      network: {
        appUrl: network.appUrl,
        loginUrl: network.loginUrl
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/mobile-app-code/resolve", publicLookupLimiter, async (req, res, next) => {
  try {
    const submittedCode = String(req.body?.code || req.body?.appCode || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");

    if (submittedCode.length < 4) {
      return res.status(400).json({
        error: {
          code: "MOBILE_APP_CODE_REQUIRED",
          message: "Enter a valid camp app code."
        }
      });
    }

    const tenants = await TenantModel.find(
      {
        status: "active",
        onboardingStatus: "live"
      },
      {
        select: ["_id", "name", "slug", "content", "settings", "billingStatus"],
        sort: { name: 1 },
        limit: 500
      }
    );

    const matchedTenant = tenants.find((tenant) => {
      if (!isTenantBillingAccessAllowed(tenant).allowed) return false;
      const appCode = String(tenant?.settings?.mobileAppCodeLookup || "").trim().toUpperCase();
      if (appCode && appCode === submittedCode) return true;
      return String(tenant?.slug || "").trim().toUpperCase() === submittedCode;
    });

    if (!matchedTenant) {
      return res.status(404).json({
        error: {
          code: "MOBILE_APP_CODE_NOT_FOUND",
          message: "That camp code was not recognized."
        }
      });
    }

    return res.json({
      id: String(matchedTenant._id || matchedTenant.id || ""),
      slug: String(matchedTenant.slug || "").trim().toLowerCase(),
      name: String(matchedTenant.name || "").trim(),
      networkDisplayName:
        String(matchedTenant?.content?.networkDisplayName || "").trim() ||
        String(matchedTenant.name || "").trim()
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/email-preferences", publicPreferenceLimiter, async (req, res, next) => {
  try {
    const payload = readEmailPreferenceToken(req.query?.token || "");
    const [tenant, preference] = await Promise.all([
      TenantModel.findById(payload.tenantId),
      EmailPreferenceModel.findForRecipient(payload)
    ]);
    if (!tenant) {
      return res.status(404).json({
        error: {
          code: "EMAIL_PREFERENCE_TENANT_NOT_FOUND",
          message: "This email preference link is no longer available."
        }
      });
    }
    return res.json({
      campName: String(
        tenant?.content?.networkDisplayName || tenant?.name || "Camp community"
      ).trim(),
      email: maskPreferenceEmail(payload.email),
      topicKey: payload.topicKey,
      topicLabel: "Community updates",
      status: preference?.status === "unsubscribed" ? "unsubscribed" : "subscribed"
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/email-preferences", publicPreferenceLimiter, async (req, res, next) => {
  const requestedStatus = String(req.body?.status || "unsubscribed").trim().toLowerCase();
  if (!new Set(["subscribed", "unsubscribed"]).has(requestedStatus)) {
    return res.status(400).json({
      error: {
        code: "EMAIL_PREFERENCE_STATUS_INVALID",
        message: "Choose subscribed or unsubscribed."
      }
    });
  }
  try {
    const result = await setEmailPreferenceFromToken({
      token: req.body?.token,
      status: requestedStatus,
      source: requestedStatus === "subscribed" ? "recipient_resubscribe" : "recipient_manage_page"
    });
    const tenant = await TenantModel.findById(result.payload.tenantId);
    return res.json({
      ok: true,
      campName: String(
        tenant?.content?.networkDisplayName || tenant?.name || "Camp community"
      ).trim(),
      email: maskPreferenceEmail(result.payload.email),
      topicKey: result.payload.topicKey,
      topicLabel: "Community updates",
      status: result.preference.status
    });
  } catch (error) {
    return next(error);
  }
});

// RFC 8058-style one-click endpoint for List-Unsubscribe-Post. GET never
// mutates preferences, which protects recipients from automated link scanners.
router.post("/email-preferences/one-click", publicPreferenceLimiter, async (req, res, next) => {
  try {
    await setEmailPreferenceFromToken({
      token: req.query?.token || req.body?.token,
      status: "unsubscribed",
      source: "list_unsubscribe_one_click"
    });
    res.set("Cache-Control", "no-store");
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
});

export default router;
