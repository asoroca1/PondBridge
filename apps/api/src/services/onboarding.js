import {
  defaultNetworkDisplayNameForCamp,
  hasFeature,
  normalizeCampType,
  normalizeHeroImagePosition,
  normalizeHeroImageSize,
  onboardingPatchSchema,
  replaceAlumniForCampType,
  tenantContentSchema,
  tenantModulesSchema,
  tenantSettingsSchema,
  tenantThemeSchema
} from "@pondbridge/shared";
import { hashPassword } from "../utils/auth.js";
import { TenantAdminAuditLogModel } from "../db/models/index.js";
import { isBillingReadyForLaunch } from "./billingState.js";

const CHECKLIST_ORDER = [
  {
    id: "name_branding",
    label: "Brand your network"
  },
  {
    id: "welcome_message",
    label: "Name and welcome message"
  },
  {
    id: "signup_controls",
    label: "Choose who can join"
  },
  {
    id: "import_alumni",
    label: "Import your alumni list"
  },
  {
    id: "modules",
    label: "Enable modules"
  },
  {
    id: "review_launch",
    label: "Review and launch"
  }
];

const STEP_TO_CHECKLIST_MAP = new Map(CHECKLIST_ORDER.map((item) => [item.id, item.id]));
const FONT_TOKEN_TO_FAMILY = {
  cedar_default: '"Inter", "Avenir Next", "Segoe UI", sans-serif',
  modern_clean: '"Inter", "Avenir Next", "Segoe UI", sans-serif',
  classic_serif: '"Lora", "Roboto Slab", serif'
};
const SIMPLE_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function deepClone(value = {}) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeFooterLinks(value = []) {
  if (!Array.isArray(value)) return [];
  return value
    .map((link) => ({
      label: String(link?.label || "").trim(),
      url: String(link?.url || "").trim()
    }))
    .filter((link) => link.label && link.url)
    .slice(0, 8);
}

function normalizeEmailFooterPresetName(value = "") {
  return String(value || "").trim().slice(0, 72);
}

function normalizeEmailFooterField(value = "", max = 140) {
  return String(value || "").trim().slice(0, max);
}

function normalizeEmailFooter(value = {}, fallback = {}) {
  const source = value && typeof value === "object" ? value : {};
  const base = fallback && typeof fallback === "object" ? fallback : {};
  const senderEmailRaw = normalizeEmailFooterField(source.senderEmail ?? base.senderEmail ?? "", 160).toLowerCase();
  const logoUrl = normalizeEmailFooterField(source.logoUrl ?? base.logoUrl ?? "", 1200);
  return {
    signOff: normalizeEmailFooterField(source.signOff ?? base.signOff ?? "Warmly,", 80),
    senderName: normalizeEmailFooterField(source.senderName ?? base.senderName ?? "", 120),
    senderRole: normalizeEmailFooterField(source.senderRole ?? base.senderRole ?? "Director", 120),
    senderEmail: SIMPLE_EMAIL_REGEX.test(senderEmailRaw) ? senderEmailRaw : "",
    senderPhone: normalizeEmailFooterField(source.senderPhone ?? base.senderPhone ?? "", 48),
    showLogo: source.showLogo !== undefined ? Boolean(source.showLogo) : base.showLogo !== false,
    logoUrl
  };
}

function normalizeEmailFooterPresets(value = [], { fallbackFooter = null } = {}) {
  const source = Array.isArray(value) ? value : [];
  const normalized = [];
  const seen = new Set();
  const fallback = normalizeEmailFooter(
    fallbackFooter || {},
    {
      signOff: "Warmly,",
      senderName: "",
      senderRole: "Director",
      senderEmail: "",
      senderPhone: "",
      showLogo: true,
      logoUrl: ""
    }
  );

  for (let index = 0; index < source.length; index += 1) {
    const item = source[index] || {};
    const rawId = String(item?.id || "").trim();
    const id = rawId
      ? rawId.slice(0, 90)
      : `footer_${index + 1}`;
    if (!id || seen.has(id)) continue;

    const name = normalizeEmailFooterPresetName(item?.name || "");
    if (!name) continue;

    seen.add(id);
    normalized.push({
      id,
      name,
      footer: normalizeEmailFooter(item?.footer || {}, fallback),
      updatedAt: String(item?.updatedAt || "")
    });
    if (normalized.length >= 20) break;
  }

  if (normalized.length === 0) {
    return [
      {
        id: "default_footer",
        name: "Default Footer",
        footer: fallback,
        updatedAt: ""
      }
    ];
  }

  return normalized;
}

function normalizeDomains(value = []) {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .map((domain) => String(domain || "").trim().toLowerCase().replace(/^@/, ""))
      .filter(Boolean)
  )].slice(0, 20);
}

function normalizeLabelList(value = [], fallback = []) {
  const next = Array.isArray(value)
    ? [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))]
    : [];
  if (!next.length) {
    return Array.isArray(fallback) ? fallback : [];
  }
  return next.slice(0, 20);
}

function normalizeAddress(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    line1: String(source.line1 || "").trim(),
    line2: String(source.line2 || "").trim(),
    city: String(source.city || "").trim(),
    state: String(source.state || "").trim(),
    postalCode: String(source.postalCode || "").trim(),
    country: String(source.country || "United States").trim() || "United States"
  };
}

export function normalizeSignupMode(value = "") {
  const mode = String(value || "").trim().toLowerCase();
  if (mode === "invite") return "invite_only";
  if (["open", "code", "invite_only", "approval_queue"].includes(mode)) return mode;
  return "open";
}

function normalizeFontToken(value = "") {
  const token = String(value || "").trim();
  if (Object.prototype.hasOwnProperty.call(FONT_TOKEN_TO_FAMILY, token)) return token;
  return "cedar_default";
}

function checklistOrderForCampType(campType = "coed") {
  const normalizedCampType = normalizeCampType(campType || "coed");
  return CHECKLIST_ORDER.map((item) => ({
    ...item,
    label: replaceAlumniForCampType(item.label, normalizedCampType)
  }));
}

function resolveChecklistCampType(tenant = null) {
  return normalizeCampType(
    tenant?.onboardingDraft?.content?.campType ||
      tenant?.content?.campType ||
      tenant?.settings?.campType ||
      "coed"
  );
}

export function createDefaultChecklist(campType = "coed") {
  return checklistOrderForCampType(campType).map((item) => ({
    ...item,
    status: "not_started",
    completedAt: null
  }));
}

export function mergeChecklist(current = [], incoming = [], campType = "coed") {
  const normalizedCampType = normalizeCampType(campType || "coed");
  const checklistOrder = checklistOrderForCampType(normalizedCampType);
  const currentMap = new Map(
    (Array.isArray(current) ? current : [])
      .filter((item) => item && item.id)
      .map((item) => [item.id, item])
  );
  const incomingMap = new Map(
    (Array.isArray(incoming) ? incoming : [])
      .filter((item) => item && item.id)
      .map((item) => [item.id, item])
  );

  return checklistOrder.map((defaultItem) => {
    const next = incomingMap.get(defaultItem.id) || currentMap.get(defaultItem.id);
    const status = next?.status || "not_started";
    return {
      id: defaultItem.id,
      label: replaceAlumniForCampType(String(next?.label || defaultItem.label), normalizedCampType),
      status,
      completedAt:
        status === "completed"
          ? next?.completedAt
            ? new Date(next.completedAt)
            : new Date()
          : null
    };
  });
}

export function updateChecklistStatus(checklist = [], stepId, status) {
  return checklist.map((item) => {
    if (item.id !== stepId) return item;
    return {
      ...item,
      status,
      completedAt: status === "completed" ? new Date() : item.completedAt || null
    };
  });
}

export function getCurrentStepFromChecklist(checklist = [], fallback = "name_branding") {
  const current = CHECKLIST_ORDER.find((item) => {
    const found = checklist.find((entry) => entry.id === item.id);
    return !found || found.status !== "completed";
  });
  return current?.id || fallback;
}

export function resolveTheme(tenant) {
  const live = deepClone(tenant?.theme || {});
  const fontToken = normalizeFontToken(live.fontToken || "cedar_default");
  const defaultPosition = normalizeHeroImagePosition(live.heroImagePosition || "");
  const defaultSize = normalizeHeroImageSize(live.heroImageSize || "");
  return {
    brandPrimary: String(live.brandPrimary || "#002b5c"),
    brandSecondary: String(live.brandSecondary || "#d3dde8"),
    brandAccent: String(live.brandAccent || "#f2b134"),
    bg: String(live.bg || "#f5f7fa"),
    text: String(live.text || "#0f172a"),
    card: String(live.card || "#ffffff"),
    logoUrl: String(live.logoUrl || ""),
    heroImageUrl: String(live.heroImageUrl || ""),
    heroImagePosition: defaultPosition,
    heroImageSize: defaultSize,
    heroImagePositionLanding: normalizeHeroImagePosition(
      live.heroImagePositionLanding || live.heroImagePosition || ""
    ),
    heroImageSizeLanding: normalizeHeroImageSize(
      live.heroImageSizeLanding || live.heroImageSize || ""
    ),
    heroImagePositionMember: normalizeHeroImagePosition(
      live.heroImagePositionMember || live.heroImagePosition || ""
    ),
    heroImageSizeMember: normalizeHeroImageSize(
      live.heroImageSizeMember || live.heroImageSize || ""
    ),
    fontFamily: String(live.fontFamily || FONT_TOKEN_TO_FAMILY[fontToken]),
    typography: String(live.typography || live.fontFamily || "Inter"),
    fontToken
  };
}

export function resolveContent(tenant) {
  const live = deepClone(tenant?.content || {});
  const tenantName = String(tenant?.name || "Your Camp").trim();
  const campType = normalizeCampType(live.campType || tenant?.settings?.campType || "coed");
  const defaultAgeGroups = [
    "Super Warrior",
    "Warrior",
    "Freshman",
    "Sophomore",
    "Junior",
    "Intermediate",
    "Senior I",
    "Senior II"
  ];
  const defaultStaffRoles = ["Camper", "Counselor", "JC", "CIT", "Admin"];
  const defaultNetworkDisplayName = defaultNetworkDisplayNameForCamp(tenantName, campType);
  const defaultWelcomeHeadline = replaceAlumniForCampType("Welcome to your alumni network", campType);
  const defaultWelcomeBody = replaceAlumniForCampType("Connect with your camp alumni community.", campType);
  const defaultEmailFooter = normalizeEmailFooter(
    live.defaultEmailFooter || {},
    {
      signOff: "Warmly,",
      senderName: "",
      senderRole: "Director",
      senderEmail: String(live.contactEmail || "").trim().toLowerCase(),
      senderPhone: "",
      showLogo: true,
      logoUrl: ""
    }
  );
  const emailFooterPresets = normalizeEmailFooterPresets(live.emailFooterPresets || [], {
    fallbackFooter: defaultEmailFooter
  });
  const requestedDefaultFooterId = String(live.defaultEmailFooterPresetId || "").trim();
  const defaultEmailFooterPresetId = emailFooterPresets.some((item) => item.id === requestedDefaultFooterId)
    ? requestedDefaultFooterId
    : String(emailFooterPresets[0]?.id || "");

  return {
    campType,
    networkDisplayName: replaceAlumniForCampType(
      String(live.networkDisplayName || defaultNetworkDisplayName),
      campType
    ),
    welcomeHeadline: replaceAlumniForCampType(
      String(live.welcomeHeadline || defaultWelcomeHeadline),
      campType
    ),
    welcomeBody: replaceAlumniForCampType(
      String(live.welcomeBody || defaultWelcomeBody),
      campType
    ),
    newsletterName: String(live.newsletterName || "Newsletter"),
    ageGroups: normalizeLabelList(live.ageGroups, defaultAgeGroups),
    staffRoles: normalizeLabelList(live.staffRoles, defaultStaffRoles),
    merchShopUrl: String(live.merchShopUrl || ""),
    aboutText: replaceAlumniForCampType(String(live.aboutText || ""), campType),
    contactEmail: String(live.contactEmail || ""),
    supportUrl: String(live.supportUrl || ""),
    footerLinks: normalizeFooterLinks(live.footerLinks || []),
    emailFooterPresets,
    defaultEmailFooterPresetId
  };
}

export function resolveSettings(tenant) {
  const settings = tenant?.settings || {};

  return {
    // Access policy is retired: all networks use open join.
    signupMode: "open",
    accessCodeHash: "",
    accessCodeHint: "",
    allowedEmailDomains: [],
    allowSearchByDefault: Boolean(
      settings.allowSearchByDefault !== undefined ? settings.allowSearchByDefault : true
    ),
    allowDirectoryBrowse: Boolean(
      settings.allowDirectoryBrowse !== undefined ? settings.allowDirectoryBrowse : true
    ),
    requireProfileCompletion: false,
    hasAccessCode: false
  };
}

export function resolveModules(tenant, { applyPlanGating = true } = {}) {
  const live = deepClone(tenant?.modules || {});
  const modules = {
    directory: live.directory !== false,
    search: live.search !== false,
    photoStream: live.photoStream !== false,
    chat: live.chat !== false,
    map: live.map !== false,
    familyTrees: live.familyTrees !== false,
    relatedProfiles: live.relatedProfiles !== false,
    newsletter: live.newsletter !== false,
    merchShop: live.merchShop !== false
  };

  if (applyPlanGating) {
    const plan = tenant?.planTier || "base";
    const addOns = tenant?.addOns || [];
    if (!hasFeature(plan, "familyTrees", addOns)) {
      modules.familyTrees = false;
    }
  }

  return modules;
}

export function resolveBillingDetails(tenant) {
  const live = deepClone(tenant?.billingDetails || {});
  const sameAsMailing = live.sameAsMailing !== false;
  const mailingAddress = normalizeAddress(live.mailingAddress || {});
  const billingAddress = sameAsMailing
    ? { ...mailingAddress }
    : normalizeAddress(live.billingAddress || {});

  return {
    sameAsMailing,
    mailingAddress,
    billingAddress
  };
}

export function resolveDirectorLegalAgreement(tenant) {
  const live = deepClone(tenant?.directorLegalAgreement || {});
  return {
    accepted: Boolean(live.accepted),
    acceptedAt: live.acceptedAt || null,
    acceptedByUserId: live.acceptedByUserId || null,
    termsVersion: String(live.termsVersion || "2026-02-21"),
    privacyVersion: String(live.privacyVersion || "2026-02-21")
  };
}

export function buildTenantConfig(tenant, { includeSensitive = false } = {}) {
  const theme = resolveTheme(tenant);
  const content = resolveContent(tenant);
  const settings = resolveSettings(tenant);
  const modules = resolveModules(tenant);

  return {
    branding: {
      logoUrl: theme.logoUrl,
      brandPrimary: theme.brandPrimary,
      brandSecondary: theme.brandSecondary,
      brandAccent: theme.brandAccent,
      heroImageUrl: theme.heroImageUrl,
      heroImagePosition: theme.heroImagePosition,
      heroImageSize: theme.heroImageSize,
      heroImagePositionLanding: theme.heroImagePositionLanding,
      heroImageSizeLanding: theme.heroImageSizeLanding,
      heroImagePositionMember: theme.heroImagePositionMember,
      heroImageSizeMember: theme.heroImageSizeMember,
      fontToken: theme.fontToken
    },
    content: {
      campType: content.campType,
      networkDisplayName: content.networkDisplayName,
      welcomeHeadline: content.welcomeHeadline,
      welcomeBody: content.welcomeBody,
      newsletterName: content.newsletterName,
      ageGroups: content.ageGroups,
      staffRoles: content.staffRoles,
      merchShopUrl: content.merchShopUrl,
      aboutText: content.aboutText,
      contactEmail: content.contactEmail,
      footerLinks: content.footerLinks
    },
    accessRules: {
      signupMode: settings.signupMode,
      accessCodeHash: includeSensitive ? settings.accessCodeHash : "",
      allowedEmailDomains: settings.allowedEmailDomains,
      requireProfileCompletion: settings.requireProfileCompletion
    },
    modules
  };
}

export function resolveDraft(tenant) {
  const draftSettings = deepClone(tenant?.onboardingDraft?.settings || {}) || {};
  const baseSettings = resolveSettings(tenant);
  const mergedSignupMode = normalizeSignupMode(draftSettings.signupMode || baseSettings.signupMode);
  const draftModules = deepClone(tenant?.onboardingDraft?.modules || {}) || {};
  const baseModules = resolveModules(tenant, { applyPlanGating: false });
  const draftBillingDetails = deepClone(tenant?.onboardingDraft?.billingDetails || {}) || {};
  const baseBillingDetails = resolveBillingDetails(tenant);
  const draftLegal = deepClone(tenant?.onboardingDraft?.directorLegalAgreement || {}) || {};
  const baseLegal = resolveDirectorLegalAgreement(tenant);
  const draftWizard = deepClone(tenant?.onboardingDraft?.wizard || {}) || {};

  return {
    theme: {
      ...resolveTheme(tenant),
      ...(deepClone(tenant?.onboardingDraft?.theme || {}) || {})
    },
    content: {
      ...resolveContent(tenant),
      ...(deepClone(tenant?.onboardingDraft?.content || {}) || {})
    },
    settings: {
      signupMode: mergedSignupMode,
      allowedEmailDomains: normalizeDomains(
        draftSettings.allowedEmailDomains || baseSettings.allowedEmailDomains || []
      ),
      allowSearchByDefault:
        draftSettings.allowSearchByDefault !== undefined
          ? Boolean(draftSettings.allowSearchByDefault)
          : baseSettings.allowSearchByDefault,
      allowDirectoryBrowse:
        draftSettings.allowDirectoryBrowse !== undefined
          ? Boolean(draftSettings.allowDirectoryBrowse)
          : baseSettings.allowDirectoryBrowse,
      requireProfileCompletion:
        draftSettings.requireProfileCompletion !== undefined
          ? Boolean(draftSettings.requireProfileCompletion)
          : baseSettings.requireProfileCompletion,
      accessCodeHash: String(draftSettings.accessCodeHash || baseSettings.accessCodeHash || ""),
      hasAccessCode: Boolean(draftSettings.accessCodeHash || baseSettings.hasAccessCode),
      accessCodeHint: draftSettings.accessCodeHint || baseSettings.accessCodeHint || ""
    },
    modules: {
      directory:
        draftModules.directory !== undefined ? Boolean(draftModules.directory) : baseModules.directory,
      search: draftModules.search !== undefined ? Boolean(draftModules.search) : baseModules.search,
      photoStream:
        draftModules.photoStream !== undefined
          ? Boolean(draftModules.photoStream)
          : baseModules.photoStream,
      chat: draftModules.chat !== undefined ? Boolean(draftModules.chat) : baseModules.chat,
      map: draftModules.map !== undefined ? Boolean(draftModules.map) : baseModules.map,
      familyTrees:
        draftModules.familyTrees !== undefined
          ? Boolean(draftModules.familyTrees)
          : baseModules.familyTrees,
      relatedProfiles:
        draftModules.relatedProfiles !== undefined
          ? Boolean(draftModules.relatedProfiles)
          : baseModules.relatedProfiles,
      newsletter:
        draftModules.newsletter !== undefined
          ? Boolean(draftModules.newsletter)
          : baseModules.newsletter,
      merchShop:
        draftModules.merchShop !== undefined
          ? Boolean(draftModules.merchShop)
          : baseModules.merchShop
    },
    billingDetails: {
      sameAsMailing:
        draftBillingDetails.sameAsMailing !== undefined
          ? Boolean(draftBillingDetails.sameAsMailing)
          : baseBillingDetails.sameAsMailing,
      mailingAddress: normalizeAddress(
        draftBillingDetails.mailingAddress || baseBillingDetails.mailingAddress
      ),
      billingAddress: normalizeAddress(
        draftBillingDetails.billingAddress || baseBillingDetails.billingAddress
      )
    },
    directorLegalAgreement: {
      accepted:
        draftLegal.accepted !== undefined ? Boolean(draftLegal.accepted) : Boolean(baseLegal.accepted),
      acceptedAt: draftLegal.acceptedAt || baseLegal.acceptedAt || null,
      acceptedByUserId: draftLegal.acceptedByUserId || baseLegal.acceptedByUserId || null,
      termsVersion: String(draftLegal.termsVersion || baseLegal.termsVersion || "2026-02-21"),
      privacyVersion: String(draftLegal.privacyVersion || baseLegal.privacyVersion || "2026-02-21")
    },
    wizard: {
      step: String(draftWizard.step || "").trim().toLowerCase(),
      savedAt: draftWizard.savedAt || tenant?.onboardingDraft?.updatedAt || null
    },
    updatedAt: tenant?.onboardingDraft?.updatedAt || null,
    updatedByUserId: tenant?.onboardingDraft?.updatedByUserId || null
  };
}

export function serializeChecklist(checklist = []) {
  return (checklist || []).map((item) => ({
    id: item.id,
    label: item.label,
    status: item.status,
    completedAt: item.completedAt ? new Date(item.completedAt).toISOString() : null
  }));
}

export function getOnboardingProgress(tenant) {
  const campType = resolveChecklistCampType(tenant);
  const checklist = mergeChecklist(tenant?.onboardingChecklist || [], [], campType);
  return {
    onboardingStatus: tenant?.onboardingStatus || "not_started",
    onboardingStep: tenant?.onboardingStep || getCurrentStepFromChecklist(checklist),
    checklist
  };
}

export function buildOnboardingResponse(tenant, { counts = null, includeDraft = true } = {}) {
  const content = resolveContent(tenant);
  const checklist = mergeChecklist(tenant?.onboardingChecklist || [], [], content.campType);
  const base = {
    tenant: {
      id: String(tenant._id),
      slug: tenant.slug,
      name: tenant.name,
      status: tenant.status,
      planTier: tenant.planTier,
      onboardingStatus: tenant.onboardingStatus,
      onboardingStep: tenant.onboardingStep || getCurrentStepFromChecklist(checklist),
      customDomain: tenant.customDomain || "",
      onboardingChecklist: serializeChecklist(checklist),
      theme: resolveTheme(tenant),
      content,
      settings: {
        ...resolveSettings(tenant),
        accessCodeHash: undefined
      },
      modules: resolveModules(tenant),
      config: buildTenantConfig(tenant, { includeSensitive: false }),
      launch: {
        launchedAt: tenant?.launch?.launchedAt || tenant?.onboardingProgress?.launchedAt || null,
        launchedByUserId: tenant?.launch?.launchedByUserId || null
      },
      billingDetails: resolveBillingDetails(tenant),
      directorLegalAgreement: resolveDirectorLegalAgreement(tenant),
      onboardingProgress: tenant.onboardingProgress || {}
    },
    counts
  };

  if (includeDraft) {
    base.tenant.onboardingDraft = resolveDraft(tenant);
  }

  return base;
}

export function getReadinessChecklist(tenant, { importedCount = 0 } = {}) {
  const draft = resolveDraft(tenant);
  const billingReadiness = getBillingReadiness(tenant);
  const campType = normalizeCampType(draft?.content?.campType || resolveChecklistCampType(tenant));
  const checks = [
    {
      id: "logo",
      label: "Logo uploaded",
      ok: Boolean(draft.theme.logoUrl)
    },
    {
      id: "headline",
      label: "Network name and welcome message configured",
      ok: Boolean(draft.content.networkDisplayName && draft.content.welcomeHeadline && draft.content.welcomeBody)
    },
    {
      id: "signup",
      label: "Signup policy selected",
      ok: ["open", "code", "invite_only", "approval_queue"].includes(
        normalizeSignupMode(draft.settings.signupMode)
      )
    },
    {
      id: "import",
      label: replaceAlumniForCampType("At least 5 alumni imported", campType),
      ok: Number(importedCount || 0) >= 5
    },
    {
      id: "modules",
      label: "Core modules enabled",
      ok: Boolean(draft.modules.directory && draft.modules.search)
    },
    {
      id: "billing",
      label: "Billing and onboarding fee are ready",
      ok: billingReadiness.ok
    },
    {
      id: "legal",
      label: "Director has accepted terms, agreements, and privacy policy",
      ok: Boolean(draft?.directorLegalAgreement?.accepted)
    }
  ];

  return {
    checks,
    isReady: checks.every((item) => item.ok)
  };
}

export function getBillingReadiness(tenant) {
  const billing = isBillingReadyForLaunch(tenant);

  return {
    billingPlan: billing.billingPlan,
    billingStatus: billing.legacyStatus,
    lifecycleStatus: billing.lifecycleStatus,
    billingStatusReady: billing.lifecycleReady,
    onboardingFeeAmount: billing.onboardingFeeAmount,
    onboardingFeePaid: billing.onboardingFeePaid,
    onboardingFeeStatus: billing.onboardingFeeStatus,
    onboardingFeeWaived: billing.onboardingFeeWaived,
    onboardingFeeReady: billing.feeReady,
    currentPeriodEnd: billing.currentPeriodEnd,
    foundersReserved: billing.foundersReserved,
    foundersSlot: billing.foundersSlot,
    foundersEligible: billing.foundersEligible,
    ok: billing.ok
  };
}

export async function validateThemePayload(payload = {}) {
  const result = tenantThemeSchema.safeParse(payload || {});
  if (!result.success) {
    const error = new Error("Invalid theme settings.");
    error.code = "VALIDATION_ERROR";
    error.statusCode = 400;
    error.details = result.error.flatten();
    throw error;
  }
  return result.data;
}

export async function validateContentPayload(payload = {}) {
  const result = tenantContentSchema.safeParse(payload || {});
  if (!result.success) {
    const error = new Error("Invalid content settings.");
    error.code = "VALIDATION_ERROR";
    error.statusCode = 400;
    error.details = result.error.flatten();
    throw error;
  }
  const data = result.data;
  const campType = normalizeCampType(data.campType || "coed");
  return {
    ...data,
    campType,
    networkDisplayName: replaceAlumniForCampType(String(data.networkDisplayName || ""), campType),
    welcomeHeadline: replaceAlumniForCampType(String(data.welcomeHeadline || ""), campType),
    welcomeBody: replaceAlumniForCampType(String(data.welcomeBody || ""), campType),
    aboutText: replaceAlumniForCampType(String(data.aboutText || ""), campType)
  };
}

export async function validateSettingsPayload(payload = {}) {
  const normalized = {
    ...payload,
    signupMode: normalizeSignupMode(payload?.signupMode),
    allowedEmailDomains: normalizeDomains(payload?.allowedEmailDomains || [])
  };
  const result = tenantSettingsSchema.safeParse(normalized);
  if (!result.success) {
    const error = new Error("Invalid signup and directory settings.");
    error.code = "VALIDATION_ERROR";
    error.statusCode = 400;
    error.details = result.error.flatten();
    throw error;
  }

  return result.data;
}

export async function validateModulesPayload(payload = {}) {
  const result = tenantModulesSchema.safeParse(payload || {});
  if (!result.success) {
    const error = new Error("Invalid module settings.");
    error.code = "VALIDATION_ERROR";
    error.statusCode = 400;
    error.details = result.error.flatten();
    throw error;
  }

  return result.data;
}

export async function validateOnboardingPatchPayload(payload = {}) {
  const normalized = {
    ...payload,
    onboardingStep: payload?.onboardingStep || undefined
  };
  const result = onboardingPatchSchema.safeParse(normalized);
  if (!result.success) {
    const error = new Error("Invalid onboarding state.");
    error.code = "VALIDATION_ERROR";
    error.statusCode = 400;
    error.details = result.error.flatten();
    throw error;
  }

  return result.data;
}

export async function buildSettingsStorePayload(settingsInput = {}, previousTenant = null) {
  const validated = await validateSettingsPayload(settingsInput);
  const next = {
    signupMode: normalizeSignupMode(validated.signupMode),
    allowedEmailDomains: normalizeDomains(validated.allowedEmailDomains || []),
    allowSearchByDefault: validated.allowSearchByDefault,
    allowDirectoryBrowse: validated.allowDirectoryBrowse,
    requireProfileCompletion: validated.requireProfileCompletion
  };

  const rawAccessCode = String(settingsInput.accessCode || "").trim();
  if (next.signupMode === "code") {
    const fallbackHash =
      String(settingsInput.accessCodeHash || "").trim() ||
      String(previousTenant?.onboardingDraft?.settings?.accessCodeHash || "").trim() ||
      String(previousTenant?.settings?.accessCodeHash || "").trim();
    const fallbackHint =
      String(settingsInput.accessCodeHint || "").trim() ||
      String(previousTenant?.onboardingDraft?.settings?.accessCodeHint || "").trim() ||
      String(previousTenant?.settings?.accessCodeHint || "").trim() ||
      "Configured";

    if (rawAccessCode) {
      next.accessCodeHash = await hashPassword(rawAccessCode);
      next.accessCodeHint = `Set (${new Date().toLocaleDateString("en-US")})`;
    } else if (fallbackHash) {
      next.accessCodeHash = fallbackHash;
      next.accessCodeHint = fallbackHint;
    } else {
      const error = new Error("Access code is required when signup mode is code.");
      error.code = "ACCESS_CODE_REQUIRED";
      error.statusCode = 400;
      throw error;
    }
  } else {
    next.accessCodeHash = "";
    next.accessCodeHint = "";
  }

  return next;
}

export async function createAuditLog({
  tenantId,
  actorUserId = null,
  event,
  metadata = {}
}) {
  if (!tenantId || !event) return;
  await TenantAdminAuditLogModel.create({
    tenantId,
    actorUserId,
    event,
    metadata
  });
}

export function markChecklistForStep(checklist, stepId, status = "completed") {
  if (!STEP_TO_CHECKLIST_MAP.has(stepId)) return checklist;
  return updateChecklistStatus(checklist, STEP_TO_CHECKLIST_MAP.get(stepId), status);
}
