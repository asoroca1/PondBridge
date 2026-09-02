import { z } from "zod";
import {
  FEATURE_ALIASES,
  PLAN_FEATURES,
  hasFeature,
  listFeaturesForPlan,
  normalizeFeatureName
} from "./features.js";

export const PLAN_TIERS = ["base", "premium"];
export { FEATURE_ALIASES, PLAN_FEATURES, hasFeature, listFeaturesForPlan, normalizeFeatureName };
export const MEMBER_EVENTS_PAGES_ENABLED = true;

export function isMemberEventsModuleEnabled(value = true) {
  return MEMBER_EVENTS_PAGES_ENABLED && value !== false;
}

export const TENANT_MODULE_CATALOG = Object.freeze([
  {
    key: "directory",
    label: "Member Directory",
    description: "Member profiles and directory browsing.",
    memberPath: "/search"
  },
  {
    key: "search",
    label: "Advanced Search",
    description: "Search members by name, camp role, location, industry, and more.",
    memberPath: "/search",
    dependsOn: ["directory"]
  },
  {
    key: "events",
    label: "Events & Info Sessions",
    description: "Community events, registered-member info sessions, RSVP collection, and director invite campaigns.",
    memberPath: "/events",
    directorPath: "/admin/events"
  },
  {
    key: "giving",
    label: "Giving",
    description: "Camp general fund, alumni-led causes, donations, and campaign updates.",
    memberPath: "/giving",
    directorPath: "/admin/giving"
  },
  {
    key: "photoStream",
    label: "Photo Stream",
    description: "Shared gallery where members upload and browse camp photos.",
    memberPath: "/photo-stream"
  },
  {
    key: "chat",
    label: "Messaging",
    description: "Direct messages, group conversations, and community forums.",
    memberPath: "/chat-rooms?tab=personal"
  },
  {
    key: "map",
    label: "Location Map",
    description: "Interactive map showing where members live and work.",
    memberPath: "/location-map"
  },
  {
    key: "familyTrees",
    label: "Family Trees",
    description: "Visualize multi-generational camp family connections.",
    memberPath: "/family-trees",
    requiredFeature: "familyTrees"
  },
  {
    key: "relatedProfiles",
    label: "Related Profiles",
    description: "Recommend relevant member connections throughout the community.",
    memberPath: "/search",
    dependsOn: ["directory"]
  },
  {
    key: "newsletter",
    label: "Newsletter",
    description: "Newsletter archive and camp announcements for members.",
    memberPath: "/cedar-chest"
  },
  {
    key: "merchShop",
    label: "Merch Shop",
    description: "Link members to the camp's external merchandise storefront.",
    setupField: "merchShopUrl"
  },
  {
    key: "tieredAccess",
    label: "Tiered Access",
    description:
      "Divide the network into numbered tiers so members only reach their own tier and the ones below it.",
    directorPath: "/admin/people/tiers",
    // The only module that starts off: turning it on merely reveals the setup
    // tab, and nothing about the community changes until it is configured and
    // switched on there as well.
    defaultEnabled: false
  }
]);

export const DEFAULT_TENANT_MODULES = Object.freeze(
  Object.fromEntries(
    TENANT_MODULE_CATALOG.map((module) => [module.key, module.defaultEnabled !== false])
  )
);

export function resolveTenantModules(value = {}, { applyPlatformAvailability = true } = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const modules = Object.fromEntries(
    TENANT_MODULE_CATALOG.map((module) => [
      module.key,
      module.defaultEnabled === false
        ? source[module.key] === true
        : source[module.key] !== false
    ])
  );

  if (modules.directory === false) {
    modules.search = false;
    modules.relatedProfiles = false;
  }
  if (applyPlatformAvailability) {
    modules.events = isMemberEventsModuleEnabled(modules.events);
  }
  return modules;
}

// The member home page shows a row of shortcut buttons under the hero.
// Directors pick which pages fill the four slots; the catalog below is the
// menu they choose from, and every entry that names a module disappears once
// that module is turned off.
export const HOME_QUICK_ACTION_SLOTS = 4;

export const HOME_QUICK_ACTION_CATALOG = Object.freeze([
  { key: "search", label: "Advanced Search", memberPath: "/search", moduleKey: "search" },
  { key: "map", label: "Location Map", memberPath: "/location-map", moduleKey: "map" },
  { key: "chat", label: "Chats & Forums", memberPath: "/chat-rooms?tab=personal", moduleKey: "chat" },
  { key: "newsletter", label: "Newsletter", memberPath: "/newsletter", moduleKey: "newsletter" },
  { key: "photoStream", label: "Photo Stream", memberPath: "/photo-stream", moduleKey: "photoStream" },
  { key: "familyTrees", label: "Family Trees", memberPath: "/family-trees", moduleKey: "familyTrees" },
  { key: "events", label: "Events", memberPath: "/events", moduleKey: "events" },
  { key: "giving", label: "Giving", memberPath: "/giving", moduleKey: "giving" },
  { key: "merchShop", label: "Merch Shop", moduleKey: "merchShop", external: true },
  { key: "myProfile", label: "My Profile", memberPath: "/my-profile" }
]);

// The order the home page falls back to: it fills any slot the director left
// unset, and covers for a chosen page whose module has since been hidden.
export const DEFAULT_HOME_QUICK_ACTIONS = Object.freeze([
  "search",
  "map",
  "chat",
  "newsletter",
  "photoStream",
  "familyTrees",
  "myProfile"
]);

export function normalizeHomeQuickActions(value = []) {
  const source = Array.isArray(value) ? value : [];
  const known = new Set(HOME_QUICK_ACTION_CATALOG.map((action) => action.key));
  const seen = new Set();
  const keys = [];

  for (const raw of source) {
    const key = String(raw || "").trim();
    if (!known.has(key) || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
    if (keys.length >= HOME_QUICK_ACTION_SLOTS) break;
  }

  return keys;
}

/**
 * Turns the director's saved choice into the buttons a member actually sees.
 * Anything whose module is off (or, for the merch shop, whose storefront URL is
 * missing) drops out, and the default order tops the row back up so the home
 * page never renders a short or empty strip.
 */
export function resolveHomeQuickActions(selected = [], modules = {}, { merchShopUrl = "" } = {}) {
  const resolvedModules = resolveTenantModules(modules);
  const storefront = String(merchShopUrl || "").trim();
  const byKey = new Map(HOME_QUICK_ACTION_CATALOG.map((action) => [action.key, action]));
  const chosen = [];
  const used = new Set();

  function available(action) {
    if (action.moduleKey && resolvedModules[action.moduleKey] === false) return false;
    if (action.key === "merchShop" && !storefront) return false;
    return true;
  }

  function push(key) {
    if (used.has(key) || chosen.length >= HOME_QUICK_ACTION_SLOTS) return;
    const action = byKey.get(key);
    if (!action || !available(action)) return;
    used.add(key);
    chosen.push(action.external ? { ...action, href: storefront } : { ...action });
  }

  normalizeHomeQuickActions(selected).forEach(push);
  DEFAULT_HOME_QUICK_ACTIONS.forEach(push);
  return chosen;
}

export const onboardingStatuses = ["not_started", "in_progress", "live"];
export const onboardingStepIds = [
  "name_branding",
  "welcome_message",
  "signup_controls",
  "import_alumni",
  "modules",
  "review_launch"
];
export const onboardingChecklistStatuses = ["not_started", "in_progress", "completed"];
export const signupModes = ["open", "code", "invite_only", "approval_queue"];
export const fontTokens = ["cedar_default", "modern_clean", "classic_serif"];
export const campTypes = ["coed", "all_girls", "all_boys"];
export const heroImagePositionPresets = [
  "left top",
  "center top",
  "right top",
  "left center",
  "center center",
  "right center",
  "left bottom",
  "center bottom",
  "right bottom"
];
export const heroImageSizePresets = ["cover", "contain", "auto", "110%", "125%", "140%"];
export const defaultCampAgeGroups = [
  "Super Warrior",
  "Warrior",
  "Freshman",
  "Sophomore",
  "Junior",
  "Intermediate",
  "Senior I",
  "Senior II"
];
export const defaultCampStaffRoles = ["Camper", "Counselor", "JC", "CIT", "Admin"];

const HERO_IMAGE_POSITION_SET = new Set(heroImagePositionPresets);
const HERO_IMAGE_SIZE_SET = new Set(heroImageSizePresets);
const CAMP_TYPE_SET = new Set(campTypes);
const CAMP_TYPE_ALIASES = {
  coed: "coed",
  "co-ed": "coed",
  "co ed": "coed",
  mixed: "coed",
  allgirls: "all_girls",
  all_girls: "all_girls",
  "all-girls": "all_girls",
  girls: "all_girls",
  female: "all_girls",
  women: "all_girls",
  allboys: "all_boys",
  all_boys: "all_boys",
  "all-boys": "all_boys",
  boys: "all_boys",
  male: "all_boys",
  men: "all_boys"
};
const HERO_IMAGE_POSITION_ALIASES = {
  center: "center center",
  top: "center top",
  bottom: "center bottom",
  left: "left center",
  right: "right center"
};
const HERO_IMAGE_POSITION_PERCENT_PAIR = /^(-?\d+(?:\.\d+)?)%\s+(-?\d+(?:\.\d+)?)%$/;
const HERO_IMAGE_POSITION_PRESET_PERCENT = {
  "left top": { x: 0, y: 0 },
  "center top": { x: 50, y: 0 },
  "right top": { x: 100, y: 0 },
  "left center": { x: 0, y: 50 },
  "center center": { x: 50, y: 50 },
  "right center": { x: 100, y: 50 },
  "left bottom": { x: 0, y: 100 },
  "center bottom": { x: 50, y: 100 },
  "right bottom": { x: 100, y: 100 }
};

function clampNumber(value, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
}

function normalizePositionCoords(value = {}) {
  return {
    x: clampNumber(value.x, 0, 100),
    y: clampNumber(value.y, 0, 100)
  };
}

function parsePercentPair(value = "") {
  const match = String(value || "").match(HERO_IMAGE_POSITION_PERCENT_PAIR);
  if (!match) return null;
  const x = Number.parseFloat(match[1]);
  const y = Number.parseFloat(match[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return normalizePositionCoords({ x, y });
}

function formatPercent(value, precision = 1) {
  const clamped = clampNumber(value, 0, 100);
  const scale = 10 ** Math.max(0, Number(precision) || 0);
  const rounded = Math.round(clamped * scale) / scale;
  if (Number.isInteger(rounded)) return `${rounded}`;
  return `${rounded}`.replace(/(\.\d*?[1-9])0+$/, "$1");
}

function parsePositionFallback(value) {
  if (value && typeof value === "object") {
    return normalizePositionCoords(value);
  }

  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return { x: 50, y: 50 };
  const aliased = HERO_IMAGE_POSITION_ALIASES[normalized] || normalized;
  if (HERO_IMAGE_POSITION_PRESET_PERCENT[aliased]) {
    return HERO_IMAGE_POSITION_PRESET_PERCENT[aliased];
  }
  return parsePercentPair(aliased) || { x: 50, y: 50 };
}

export function formatHeroImagePositionPercent(x = 50, y = 50, { precision = 1 } = {}) {
  return `${formatPercent(x, precision)}% ${formatPercent(y, precision)}%`;
}

export function parseHeroImagePosition(value = "", fallback = { x: 50, y: 50 }) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return parsePositionFallback(fallback);

  const aliased = HERO_IMAGE_POSITION_ALIASES[normalized] || normalized;
  if (HERO_IMAGE_POSITION_PRESET_PERCENT[aliased]) {
    return HERO_IMAGE_POSITION_PRESET_PERCENT[aliased];
  }

  return parsePercentPair(aliased) || parsePositionFallback(fallback);
}

export function normalizeHeroImagePosition(value = "", fallback = "center center") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  const aliased = Object.prototype.hasOwnProperty.call(HERO_IMAGE_POSITION_ALIASES, normalized)
    ? HERO_IMAGE_POSITION_ALIASES[normalized]
    : normalized;
  if (HERO_IMAGE_POSITION_SET.has(aliased)) return aliased;
  const percentPair = parsePercentPair(aliased);
  if (percentPair) return formatHeroImagePositionPercent(percentPair.x, percentPair.y);
  return fallback;
}

export function normalizeHeroImageSize(value = "", fallback = "cover") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (HERO_IMAGE_SIZE_SET.has(normalized)) return normalized;
  if (/^\d{2,3}%$/.test(normalized)) {
    const pct = Number.parseInt(normalized.replace("%", ""), 10);
    if (Number.isFinite(pct) && pct >= 60 && pct <= 200) return `${pct}%`;
  }
  return fallback;
}

export function normalizeCampType(value = "", fallback = "coed") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return CAMP_TYPE_SET.has(fallback) ? fallback : "coed";
  const mapped = Object.prototype.hasOwnProperty.call(CAMP_TYPE_ALIASES, normalized)
    ? CAMP_TYPE_ALIASES[normalized]
    : normalized;
  if (CAMP_TYPE_SET.has(mapped)) return mapped;
  return CAMP_TYPE_SET.has(fallback) ? fallback : "coed";
}

export function isAllGirlsCampType(value = "") {
  return normalizeCampType(value) === "all_girls";
}

export function alumniPluralForCampType(campType = "", { capitalized = false } = {}) {
  const word = isAllGirlsCampType(campType) ? "alumnae" : "alumni";
  if (!capitalized) return word;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function replaceAlumniForCampType(text = "", campType = "") {
  const source = String(text || "");
  if (!source) return source;
  const lowerWord = alumniPluralForCampType(campType, { capitalized: false });
  const upperWord = alumniPluralForCampType(campType, { capitalized: true });
  return source.replace(/\b(alumni|alumnae)\b/gi, (match) => (match[0] === "A" ? upperWord : lowerWord));
}

export function defaultNetworkDisplayNameForCamp(campName = "Your Camp", campType = "coed") {
  const safeName = String(campName || "").trim() || "Your Camp";
  const networkWord = alumniPluralForCampType(campType, { capitalized: true });
  if (/\bcamp\b/i.test(safeName)) {
    return `${safeName} ${networkWord} Network`;
  }
  return `${safeName} Camp ${networkWord} Network`;
}

const jobSchema = z
  .object({
    role: z.string().trim().optional().default(""),
    company: z.string().trim().optional().default(""),
    years: z.string().trim().optional().default("")
  })
  .transform((value) => ({
    role: value.role || "",
    company: value.company || "",
    years: value.years || ""
  }));

export const resumeProfileSchema = z.object({
  firstName: z.string().trim().default(""),
  lastName: z.string().trim().default(""),
  email: z.string().trim().default(""),
  phone: z.string().trim().default(""),
  cityState: z.string().trim().default(""),
  bio: z.string().trim().max(1600).default(""),
  highSchool: z.string().trim().default(""),
  colleges: z.array(z.string().trim()).default([]),
  collegeYears: z.array(z.string().trim()).default([]),
  currentJobs: z.array(jobSchema).default([]),
  pastJobs: z.array(jobSchema).default([]),
  industry: z.string().trim().default(""),
  socials: z
    .object({
      linkedin: z.string().trim().default(""),
      instagram: z.string().trim().default(""),
      facebook: z.string().trim().default("")
    })
    .default({ linkedin: "", instagram: "", facebook: "" })
});

export const tenantThemeSchema = z.object({
  brandPrimary: z.string().trim().min(1).default("#404040"),
  brandSecondary: z.string().trim().min(1).default("#e6e6e6"),
  brandAccent: z.string().trim().default("#f2b134"),
  bg: z.string().trim().default("#fafafa"),
  text: z.string().trim().default("#1c1c1c"),
  card: z.string().trim().default("#ffffff"),
  // Optional overrides for the two neutrals the client otherwise derives from
  // brandPrimary. Empty means "derive it", which is the normal case.
  textMuted: z.string().trim().default(""),
  cardBorder: z.string().trim().default(""),
  logoUrl: z.string().trim().default(""),
  heroImageUrl: z.string().trim().default(""),
  // Optional second photo for the logged-in member home. Empty means the
  // member home reuses heroImageUrl, which is the normal case.
  heroImageUrlMember: z.string().trim().default(""),
  heroImagePosition: z
    .string()
    .trim()
    .default("center center")
    .transform((value) => normalizeHeroImagePosition(value)),
  heroImageSize: z
    .string()
    .trim()
    .default("cover")
    .transform((value) => normalizeHeroImageSize(value)),
  heroImagePositionLanding: z
    .string()
    .trim()
    .default("center center")
    .transform((value) => normalizeHeroImagePosition(value)),
  heroImageSizeLanding: z
    .string()
    .trim()
    .default("cover")
    .transform((value) => normalizeHeroImageSize(value)),
  heroImagePositionMember: z
    .string()
    .trim()
    .default("center center")
    .transform((value) => normalizeHeroImagePosition(value)),
  heroImageSizeMember: z
    .string()
    .trim()
    .default("cover")
    .transform((value) => normalizeHeroImageSize(value)),
  fontFamily: z.string().trim().default("Inter Variable"),
  fontToken: z.enum(fontTokens).default("cedar_default")
});

export const tenantFooterLinkSchema = z.object({
  label: z.string().trim().min(1).max(60),
  url: z.string().trim().url()
});

export const tenantEmailFooterSchema = z.object({
  signOff: z.string().trim().max(80).default("Warmly,"),
  senderName: z.string().trim().max(120).default(""),
  senderRole: z.string().trim().max(120).default("Director"),
  senderEmail: z.string().trim().email().or(z.literal("")).default(""),
  senderPhone: z.string().trim().max(48).default(""),
  showLogo: z.boolean().default(true),
  logoUrl: z.string().trim().url().or(z.literal("")).default("")
});

export const tenantEmailFooterPresetSchema = z.object({
  id: z.string().trim().min(1).max(90),
  name: z.string().trim().min(1).max(72),
  footer: tenantEmailFooterSchema.default({}),
  updatedAt: z.string().trim().max(80).default("")
});

// A single audience rule. Recipient groups are saved rules, not frozen member
// lists, so a "Counselors" group keeps matching new counselors over time.
export const tenantEmailAudienceRuleSchema = z.object({
  mode: z.enum(["all", "role", "year", "segment", "custom"]).default("all"),
  roles: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  years: z.array(z.string().trim().min(1).max(10)).max(80).default([]),
  profileIds: z.array(z.string().trim().min(1).max(90)).max(2000).default([]),
  segment: z.string().trim().max(40).default("")
});

// A group is a list of rules unioned together, so "Counselors plus these three
// people" is one saveable group rather than two things to remember.
export const tenantEmailRecipientGroupSchema = z.object({
  id: z.string().trim().min(1).max(90),
  name: z.string().trim().min(1).max(72),
  description: z.string().trim().max(180).default(""),
  rules: z.array(tenantEmailAudienceRuleSchema).max(25).default([]),
  updatedAt: z.string().trim().max(80).default("")
});

export const tenantMemberExportPresetSchema = z.object({
  id: z.string().trim().min(1).max(90),
  name: z.string().trim().min(1).max(72),
  fields: z.array(z.string().trim().min(1).max(60)).max(80).default([]),
  updatedAt: z.string().trim().max(80).default("")
});

export const tenantEmailTemplateSchema = z.object({
  id: z.string().trim().min(1).max(90),
  name: z.string().trim().min(1).max(72),
  subject: z.string().trim().max(160).default(""),
  preheader: z.string().trim().max(160).default(""),
  body: z.string().max(20000).default(""),
  updatedAt: z.string().trim().max(80).default("")
});

export const tenantContentSchema = z.object({
  campType: z.enum(campTypes).default("coed"),
  networkDisplayName: z.string().trim().max(120).default("Your Camp Alumni Network"),
  welcomeHeadline: z.string().trim().max(120).default("Welcome to your alumni network"),
  welcomeBody: z.string().trim().max(1200).default("Connect with your camp alumni community."),
  newsletterName: z.string().trim().max(80).default("Newsletter"),
  ageGroups: z.array(z.string().trim().min(1).max(60)).max(20).default(defaultCampAgeGroups),
  staffRoles: z.array(z.string().trim().min(1).max(60)).max(20).default(defaultCampStaffRoles),
  merchShopUrl: z.string().trim().url().or(z.literal("")).default(""),
  homeQuickActions: z
    .array(z.string())
    .default([])
    .transform((value) => normalizeHomeQuickActions(value)),
  aboutText: z.string().trim().max(2000).default(""),
  contactEmail: z.string().trim().email().or(z.literal("")).default(""),
  supportUrl: z.string().trim().url().or(z.literal("")).default(""),
  footerLinks: z.array(tenantFooterLinkSchema).max(8).default([]),
  emailFooterPresets: z.array(tenantEmailFooterPresetSchema).max(20).default([]),
  defaultEmailFooterPresetId: z.string().trim().max(90).default(""),
  emailRecipientGroups: z.array(tenantEmailRecipientGroupSchema).max(60).default([]),
  emailTemplates: z.array(tenantEmailTemplateSchema).max(40).default([]),
  memberExportPresets: z.array(tenantMemberExportPresetSchema).max(30).default([])
});

export const tenantSettingsSchema = z.object({
  signupMode: z.enum(signupModes).default("open"),
  accessCode: z.string().trim().min(6).max(64).optional(),
  mobileAppCode: z.string().trim().min(4).max(32).optional(),
  allowedEmailDomains: z.array(z.string().trim().toLowerCase()).max(20).default([]),
  allowSearchByDefault: z.boolean().default(true),
  allowDirectoryBrowse: z.boolean().default(true),
  requireProfileCompletion: z.boolean().default(false),
  // The review gate sits on top of whichever signup mode is chosen: it decides
  // whether a signup becomes a member immediately or waits for a director.
  requireSignupApproval: z.boolean().default(false)
});

export const tenantModulesSchema = z.object({
  directory: z.boolean().default(true),
  search: z.boolean().default(true),
  events: z.boolean().default(true),
  photoStream: z.boolean().default(true),
  chat: z.boolean().default(true),
  map: z.boolean().default(true),
  familyTrees: z.boolean().default(true),
  relatedProfiles: z.boolean().default(true),
  newsletter: z.boolean().default(true),
  merchShop: z.boolean().default(true)
}).transform((modules) => resolveTenantModules(modules, { applyPlatformAvailability: false }));

export const onboardingChecklistItemSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  status: z.enum(onboardingChecklistStatuses).default("not_started"),
  completedAt: z.string().datetime().nullable().optional()
});

export const onboardingPatchSchema = z.object({
  onboardingStep: z.enum(onboardingStepIds).optional(),
  checklist: z.array(onboardingChecklistItemSchema).max(30).optional()
});

export function normalizeSlug(value = "") {
  const normalized = String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (!normalized) return "";

  const withoutCampPrefix = normalized.replace(/^(camp-)+/, "");
  if (withoutCampPrefix) return withoutCampPrefix;

  // "camp" alone should not become a tenant slug.
  if (normalized === "camp") return "";

  return normalized;
}

export { INDUSTRIES } from "./industries.js";
export * from "./tiers.js";
