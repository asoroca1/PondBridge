import {
  hasFeature,
  MEMBER_EVENTS_PAGES_ENABLED,
  TENANT_MODULE_CATALOG,
  normalizeCampType,
  replaceAlumniForCampType,
  resolveTenantModules
} from "@pondbridge/shared";
import { getEmailServiceStatus } from "./email.js";
import { evaluateFeatureRollout } from "./featureRollouts.js";
import { getMobileNotificationProviderStatus } from "./mobileNotifications.js";
import { getR2ServiceStatus } from "./objectStorage.js";
import {
  DIRECTOR_COPILOT_FLAG,
  getDirectorCopilotProviderStatus
} from "./directorCopilot.js";
import {
  DIRECTOR_EMAIL_AGENT_FLAG,
  getDirectorEmailAgentProviderStatus,
  getDirectorEmailAgentUsage
} from "./directorEmailAgent.js";
import {
  CAMP_AI_SEARCH_FLAG,
  getCampAiSearchProviderStatus,
  getCampAiSearchUsage
} from "./campAiSearch.js";
import { isBillingReadyForLaunch, resolveTenantFeatureTier } from "./billingState.js";
import { getAlumniGrowthStorageStatus } from "./alumniGrowth.js";

function tenantPath(slug, path) {
  const safeSlug = encodeURIComponent(String(slug || "").trim().toLowerCase());
  return safeSlug ? `/t/${safeSlug}${path}` : path;
}

function tenantAiName(tenant = {}) {
  const content = tenant?.content && typeof tenant.content === "object" ? tenant.content : {};
  const configured = String(content.aiAssistantName || "").trim().slice(0, 60);
  if (configured) return configured;
  const campName = String(tenant?.name || "Camp")
    .replace(/\s+[—-]\s+local staging\b.*$/i, "")
    .replace(/^(?:the\s+)?camp\s+/i, "")
    .trim() || "Camp";
  return /\bai$/i.test(campName) ? campName : `${campName} AI`;
}

function planCapability({ tenant, key, label, description, requiredFeature, path }) {
  const planTier = resolveTenantFeatureTier(tenant);
  const included = hasFeature(planTier, requiredFeature, tenant?.addOns || []);
  return {
    key,
    label,
    description,
    category: "plan",
    status: included ? "active" : "locked",
    statusLabel: included ? "Included" : "Premium",
    available: included,
    requiredFeature,
    href: tenantPath(tenant?.slug, path),
    managedBy: "plan"
  };
}

export function buildCommunityModuleInventory(tenant = {}) {
  const planTier = resolveTenantFeatureTier(tenant);
  const modules = resolveTenantModules(tenant?.modules || {});
  const content = tenant?.content && typeof tenant.content === "object" ? tenant.content : {};
  const campType = normalizeCampType(content.campType || tenant?.settings?.campType || "coed");
  const merchShopUrl = String(content.merchShopUrl || "").trim();

  return TENANT_MODULE_CATALOG.map((definition) => {
    const locked = definition.requiredFeature
      ? !hasFeature(planTier, definition.requiredFeature, tenant?.addOns || [])
      : false;
    const platformDisabled = definition.key === "events" && !MEMBER_EVENTS_PAGES_ENABLED;
    const selected = Boolean(modules[definition.key]);
    const setupRequired = selected && definition.setupField === "merchShopUrl" && !merchShopUrl;
    let status = "active";
    let statusLabel = "On";
    if (locked) {
      status = "locked";
      statusLabel = "Premium";
    } else if (platformDisabled) {
      status = "unavailable";
      statusLabel = "Unavailable";
    } else if (!selected) {
      status = "disabled";
      statusLabel = "Off";
    } else if (setupRequired) {
      status = "setup_required";
      statusLabel = "Setup required";
    }

    return {
      ...definition,
      label: replaceAlumniForCampType(definition.label, campType),
      description: replaceAlumniForCampType(definition.description, campType),
      enabled: locked || platformDisabled ? false : selected,
      effectiveEnabled: status === "active",
      locked,
      platformDisabled,
      setupRequired,
      status,
      statusLabel,
      disabledReason: platformDisabled
        ? "Temporarily unavailable across PondBridge."
        : setupRequired
          ? "Add the camp storefront URL before members can use this module."
          : "",
      href: tenantPath(tenant?.slug, definition.directorPath || definition.memberPath || "/home"),
      externalHref: definition.key === "merchShop" ? merchShopUrl : ""
    };
  });
}

export function buildPlanCapabilityInventory(tenant = {}) {
  return [
    planCapability({
      tenant,
      key: "csv_export",
      label: "Member CSV export",
      description: "Review a field preview and export tenant-scoped member data.",
      requiredFeature: "csvExport",
      path: "/admin/members"
    }),
    planCapability({
      tenant,
      key: "pdf_export",
      label: "Member PDF reports",
      description: "Create printable tenant-scoped member reports.",
      requiredFeature: "pdfExport",
      path: "/admin/members"
    }),
    planCapability({
      tenant,
      key: "resume_parsing",
      label: "Resume & LinkedIn PDF assistant",
      description: "Let members review AI-suggested profile updates from a resume or LinkedIn profile PDF.",
      requiredFeature: "resumeParsing",
      path: "/home"
    }),
    planCapability({
      tenant,
      key: "advanced_branding",
      label: "Branding studio",
      description: "Use logos, hero images, framing, and the live site simulator.",
      requiredFeature: "tenantBrandingBasic",
      path: "/admin/settings/branding"
    }),
    planCapability({
      tenant,
      key: "custom_domain",
      label: "Custom domain",
      description: "Connect a camp-owned domain after PondBridge verifies the DNS configuration.",
      requiredFeature: "customDomain",
      path: "/admin/settings/support"
    }),
    planCapability({
      tenant,
      key: "analytics",
      label: "Community analytics",
      description: "Review measured member activity, profile completion, and communication performance.",
      requiredFeature: "profiles",
      path: "/admin/dashboard"
    })
  ].map((item) => {
    if (item.key === "custom_domain" && item.available) {
      return {
        ...item,
        statusLabel: String(tenant?.customDomain || "").trim() ? "Connected" : "Available"
      };
    }
    return item;
  });
}

function coreCapability(tenant, value) {
  return {
    category: "operations",
    status: "active",
    statusLabel: "Ready",
    available: true,
    managedBy: "director",
    ...value,
    href: tenantPath(tenant?.slug, value.path)
  };
}

function rolloutCapability({ tenant, rollout, providerConfigured, ledgerAvailable = true, value }) {
  const available = Boolean(rollout?.enabled && providerConfigured && ledgerAvailable);
  let status = "pilot";
  let statusLabel = "Controlled pilot";
  if (rollout?.enabled && !providerConfigured) {
    status = "setup_required";
    statusLabel = "Provider setup needed";
  } else if (rollout?.enabled && providerConfigured && !ledgerAvailable) {
    status = "setup_required";
    statusLabel = "Usage ledger needed";
  } else if (available) {
    status = "active";
    statusLabel = "Pilot ready";
  }
  return {
    category: "ai",
    managedBy: "PondBridge rollout",
    ...value,
    href: tenantPath(tenant?.slug, value.path),
    status,
    statusLabel,
    available,
    rolloutReason: rollout?.reason || "not_configured",
    rolloutControlAvailable: Boolean(rollout?.controlAvailable),
    providerConfigured: Boolean(providerConfigured),
    ledgerAvailable: Boolean(ledgerAvailable)
  };
}

export async function buildDirectorCapabilityInventory(tenant = {}) {
  const email = getEmailServiceStatus();
  const storage = getR2ServiceStatus();
  const mobile = getMobileNotificationProviderStatus();
  const directorCopilotProvider = getDirectorCopilotProviderStatus();
  const emailAgentProvider = getDirectorEmailAgentProviderStatus();
  const campAiSearchProvider = getCampAiSearchProviderStatus();
  const billing = isBillingReadyForLaunch(tenant);
  const aiName = tenantAiName(tenant);
  const [
    directorCopilotRollout,
    emailAgentRollout,
    campAiSearchRollout,
    emailAgentLedgerAvailable,
    campAiSearchUsageStatus,
    alumniGrowthStorage
  ] = await Promise.all([
    evaluateFeatureRollout(DIRECTOR_COPILOT_FLAG, tenant).catch(() => ({
      enabled: false,
      reason: "status_unavailable",
      controlAvailable: false
    })),
    evaluateFeatureRollout(DIRECTOR_EMAIL_AGENT_FLAG, tenant).catch(() => ({
      enabled: false,
      reason: "status_unavailable",
      controlAvailable: false
    })),
    evaluateFeatureRollout(CAMP_AI_SEARCH_FLAG, tenant).catch(() => ({
      enabled: false,
      reason: "status_unavailable",
      controlAvailable: false
    })),
    getDirectorEmailAgentUsage(String(tenant?._id || ""))
      .then(() => true)
      .catch(() => false),
    getCampAiSearchUsage(String(tenant?._id || ""))
      .then((usage) => ({ available: true, usage }))
      .catch(() => ({ available: false, usage: null })),
    getAlumniGrowthStorageStatus(String(tenant?._id || ""))
  ]);

  const capabilities = [
    {
      ...coreCapability(tenant, {
        key: "alumni_growth",
        label: "Alumni growth & engagement",
        description: "Track known alumni before they join, measure invitation conversion, and act on engagement opportunities.",
        path: "/admin/growth"
      }),
      status: alumniGrowthStorage.available ? "active" : "setup_required",
      statusLabel: alumniGrowthStorage.available ? "Growth tools ready" : "Storage setup needed",
      available: true,
      managedBy: "director"
    },
    coreCapability(tenant, {
      key: "network_content",
      label: "Network identity & content",
      description: "Manage the network name, welcome copy, camp terminology, newsletter name, and contact details.",
      path: "/admin/settings/network"
    }),
    coreCapability(tenant, {
      key: "access_controls",
      label: "Access & signup policy",
      description: "Control open, access-code, invitation-only, approval, domain, and profile-completion rules.",
      path: "/admin/settings/access"
    }),
    coreCapability(tenant, {
      key: "admin_team",
      label: "Director & admin team",
      description: "Review current camp administrators and the safe process for changing access.",
      path: "/admin/settings/admins"
    }),
    coreCapability(tenant, {
      key: "member_operations",
      label: "Members, approvals & invitations",
      description: "Manage members, review access requests, and send reviewed invitations.",
      path: "/admin/members"
    }),
    {
      ...coreCapability(tenant, {
        key: "email_campaigns",
        label: "Email campaigns",
        description: "Draft, preview, schedule, send, and audit recipient-controlled camp email.",
        path: "/admin/email/compose"
      }),
      status: email.configured && email.mode !== "mock" ? "active" : "setup_required",
      statusLabel: email.configured && email.mode !== "mock" ? "Provider ready" : email.mode === "mock" ? "Test mode" : "Provider setup needed",
      available: Boolean(email.configured),
      managedBy: "provider"
    },
    {
      ...coreCapability(tenant, {
        key: "billing",
        label: "Billing & subscription",
        description: "Review the active plan, payment lifecycle, onboarding fee, invoices, and billing portal.",
        path: "/admin/billing"
      }),
      status: billing.ok ? "active" : "setup_required",
      statusLabel: billing.ok ? "Billing ready" : "Billing needs attention",
      available: true,
      managedBy: "billing provider"
    },
    {
      ...coreCapability(tenant, {
        key: "mobile_alerts",
        label: "Mobile alerts & inbox",
        description: "Send reviewed inbox alerts, with push delivery when APNs or FCM is configured.",
        path: "/admin/settings/notifications"
      }),
      status: mobile.available ? "active" : "limited",
      statusLabel: mobile.available ? "Push ready" : "Inbox only",
      available: true,
      managedBy: "provider"
    },
    {
      ...coreCapability(tenant, {
        key: "uploads",
        label: "Photos, files & attachments",
        description: "Store branding, photos, newsletters, and private message attachments.",
        path: "/admin/settings/branding"
      }),
      status: storage.configured ? "active" : "setup_required",
      statusLabel: storage.configured ? "Storage ready" : "Storage setup needed",
      available: storage.configured,
      managedBy: "provider"
    },
    ...buildPlanCapabilityInventory(tenant),
    rolloutCapability({
      tenant,
      rollout: directorCopilotRollout,
      providerConfigured: directorCopilotProvider.configured,
      value: {
        key: "director_copilot",
        label: `${aiName} for directors`,
        description: "Read-only, evidence-linked help for setup and daily camp operations.",
        path: "/onboarding"
      }
    }),
    rolloutCapability({
      tenant,
      rollout: emailAgentRollout,
      providerConfigured: emailAgentProvider.configured,
      ledgerAvailable: emailAgentLedgerAvailable,
      value: {
        key: "communications_agent",
        label: "Communications Agent",
        description: "Draft-only AI campaign assistance with metered cost controls and director approval.",
        path: "/admin/email/compose"
      }
    }),
    rolloutCapability({
      tenant,
      rollout: campAiSearchRollout,
      providerConfigured: campAiSearchProvider.configured,
      ledgerAvailable: campAiSearchUsageStatus.available,
      value: {
        key: "camp_ai_search",
        label: `${aiName} for members`,
        description: "Let members and directors search the camp directory in natural language without sending member records to the model.",
        path: "/ai",
        usage: campAiSearchUsageStatus.usage
      }
    })
  ];

  return {
    capabilities,
    summary: {
      ready: capabilities.filter((item) => item.status === "active").length,
      attention: capabilities.filter((item) => ["setup_required", "limited"].includes(item.status)).length,
      lockedOrPilot: capabilities.filter((item) => ["locked", "pilot"].includes(item.status)).length,
      total: capabilities.length
    }
  };
}

export async function buildTenantFeatureInventory(tenant = {}) {
  const modules = buildCommunityModuleInventory(tenant);
  const director = await buildDirectorCapabilityInventory(tenant);
  return {
    modules,
    capabilities: director.capabilities,
    summary: {
      activeModules: modules.filter((item) => item.status === "active").length,
      moduleAttention: modules.filter((item) => item.status === "setup_required").length,
      totalModules: modules.length,
      ...director.summary
    }
  };
}
