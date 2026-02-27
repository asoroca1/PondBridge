import { Router } from "express";
import rateLimit from "express-rate-limit";
import { TenantModel } from "../db/models/index.js";
import { listFeaturesForPlan } from "@pondbridge/shared";
import {
  buildTenantConfig,
  normalizeSignupMode,
  resolveContent,
  resolveSettings,
  resolveTheme
} from "../services/onboarding.js";
import { buildTenantUrls } from "../utils/domainProvisioning.js";
import { buildBillingPublicSnapshot } from "../services/billing.js";
import { isTenantBillingAccessAllowed } from "../services/billingState.js";
import { resolveTenantFromRequest } from "../utils/tenantResolution.js";

const router = Router();

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

    const config = buildTenantConfig(tenant, { includeSensitive: false });
    const network = buildTenantUrls(tenant);
    const billing = buildBillingPublicSnapshot(tenant);

    return res.json({
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
        signupMode: normalizeSignupMode(config.accessRules.signupMode || "open"),
        signupEnabled: isSignupEnabled(tenant)
      },
      modules: config.modules,
      features: listFeaturesForPlan(tenant.planTier, tenant.addOns || [])
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/tenant-status", publicLookupLimiter, async (req, res, next) => {
  try {
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

    const settings = resolveSettings(tenant);
    const billingAccess = isTenantBillingAccessAllowed(tenant);

    return res.json({
      slug: tenant.slug,
      status: tenant.status,
      onboardingStatus: tenant.onboardingStatus,
      signupEnabled: isSignupEnabled(tenant),
      billingAccess: {
        allowed: billingAccess.allowed,
        reason: billingAccess.reason,
        inGrace: billingAccess.inGrace
      },
      signupMode: normalizeSignupMode(settings.signupMode || "open")
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
