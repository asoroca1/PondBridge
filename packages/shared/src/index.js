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
  brandPrimary: z.string().trim().min(1).default("#002b5c"),
  brandSecondary: z.string().trim().min(1).default("#d3dde8"),
  brandAccent: z.string().trim().default("#f2b134"),
  bg: z.string().trim().default("#f5f7fa"),
  text: z.string().trim().default("#0f172a"),
  card: z.string().trim().default("#ffffff"),
  logoUrl: z.string().trim().default(""),
  heroImageUrl: z.string().trim().default(""),
  fontFamily: z.string().trim().default("Inter"),
  fontToken: z.enum(fontTokens).default("cedar_default")
});

export const tenantFooterLinkSchema = z.object({
  label: z.string().trim().min(1).max(60),
  url: z.string().trim().url()
});

export const tenantContentSchema = z.object({
  networkDisplayName: z.string().trim().max(120).default("Your Camp Alumni Network"),
  welcomeHeadline: z.string().trim().max(120).default("Welcome to your alumni network"),
  welcomeBody: z.string().trim().max(1200).default("Connect with your camp alumni community."),
  newsletterName: z.string().trim().max(80).default("Newsletter"),
  ageGroups: z.array(z.string().trim().min(1).max(60)).max(20).default(defaultCampAgeGroups),
  staffRoles: z.array(z.string().trim().min(1).max(60)).max(20).default(defaultCampStaffRoles),
  merchShopUrl: z.string().trim().url().or(z.literal("")).default(""),
  aboutText: z.string().trim().max(2000).default(""),
  contactEmail: z.string().trim().email().or(z.literal("")).default(""),
  supportUrl: z.string().trim().url().or(z.literal("")).default(""),
  footerLinks: z.array(tenantFooterLinkSchema).max(8).default([])
});

export const tenantSettingsSchema = z.object({
  signupMode: z.enum(signupModes).default("open"),
  accessCode: z.string().trim().min(6).max(64).optional(),
  allowedEmailDomains: z.array(z.string().trim().toLowerCase()).max(20).default([]),
  allowSearchByDefault: z.boolean().default(true),
  allowDirectoryBrowse: z.boolean().default(true),
  requireProfileCompletion: z.boolean().default(false)
});

export const tenantModulesSchema = z.object({
  directory: z.boolean().default(true),
  search: z.boolean().default(true),
  photoStream: z.boolean().default(true),
  chat: z.boolean().default(true),
  map: z.boolean().default(true),
  familyTrees: z.boolean().default(true),
  relatedProfiles: z.boolean().default(true),
  newsletter: z.boolean().default(true),
  merchShop: z.boolean().default(true)
});

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
