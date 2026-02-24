import { Router } from "express";
import multer from "multer";
import { listFeaturesForPlan } from "@pondbridge/shared";
import { env } from "../config/env.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { getTenantContext } from "../middleware/tenantContext.js";
import {
  TenantModel,
  UserModel,
  ProfileModel,
  ImportReportModel
} from "../db/models/index.js";
import {
  buildBillingPublicSnapshot,
  createBillingPortalUrl,
  createTenantCheckoutSession,
  getBillingCatalog,
  getBillingMode,
  getFoundersAvailability,
  isStripeEnabled
} from "../services/billing.js";
import { runTenantCsvImport } from "../services/csvImport.js";
import {
  buildOnboardingResponse,
  buildSettingsStorePayload,
  createAuditLog,
  createDefaultChecklist,
  getBillingReadiness,
  getCurrentStepFromChecklist,
  getReadinessChecklist,
  markChecklistForStep,
  mergeChecklist,
  normalizeSignupMode,
  resolveDraft,
  resolveModules,
  resolveTheme,
  validateContentPayload,
  validateModulesPayload,
  validateOnboardingPatchPayload,
  validateThemePayload
} from "../services/onboarding.js";
import { buildTenantUrls, resolveTenantDomain } from "../utils/domainProvisioning.js";
import { resolveTenantBilling } from "../services/billingState.js";

const router = Router();

const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const isCsv =
      file.mimetype.includes("csv") || file.originalname.toLowerCase().endsWith(".csv");

    if (!isCsv) {
      const error = new Error("CSV file required");
      error.statusCode = 400;
      error.code = "CSV_REQUIRED";
      return cb(error);
    }

    return cb(null, true);
  }
});

const stepIndexById = {
  name_branding: 1,
  welcome_message: 2,
  signup_controls: 3,
  import_alumni: 4,
  modules: 5,
  review_launch: 6
};

function toBoolean(value) {
  if (typeof value === "boolean") return value;
  return String(value || "").toLowerCase().trim() === "true";
}

function toBoundedInt(value, { min = 0, max = 4, fallback = 1 } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

const DEFAULT_TERMS_VERSION = "2026-02-21";
const DEFAULT_PRIVACY_VERSION = "2026-02-21";
const VALID_BILLING_PLAN_CODES = new Set(["legacy", "founders", "institutional"]);

function hasOwn(source, key) {
  return Boolean(source && Object.prototype.hasOwnProperty.call(source, key));
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

function validateAddress(address) {
  if (!address.line1) return "Address line 1 is required.";
  if (!address.city) return "City is required.";
  if (!address.state) return "State/Province is required.";
  if (!address.postalCode) return "Postal code is required.";
  if (!address.country) return "Country is required.";
  return "";
}

function normalizeCompletedSteps(values = []) {
  return [...new Set((values || []).map((step) => Number(step)).filter(Number.isFinite))].sort(
    (a, b) => a - b
  );
}

function buildProgressUpdate(tenant, { checklist, onboardingStep, importStats, launchedAt } = {}) {
  const previous = tenant.onboardingProgress || {};
  const completedFromChecklist = (checklist || [])
    .filter((item) => item.status === "completed" && stepIndexById[item.id])
    .map((item) => stepIndexById[item.id]);

  const completedSteps = normalizeCompletedSteps([
    ...(previous.completedSteps || []),
    ...completedFromChecklist
  ]);

  return {
    currentStep: stepIndexById[onboardingStep] || previous.currentStep || 1,
    completedSteps,
    lastSavedAt: new Date(),
    launchedAt: launchedAt || previous.launchedAt || null,
    lastImportStats: importStats || previous.lastImportStats || { imported: 0, skipped: 0, rowsRead: 0 }
  };
}

/**
 * Unflatten dot-notation keys into nested objects so that the Supabase
 * model's `toRow` can map top-level camelCase keys to snake_case columns.
 *
 * Example:
 *   { "onboardingDraft.theme": { ... }, onboardingStep: "modules" }
 * becomes:
 *   { onboardingDraft: { theme: { ... } }, onboardingStep: "modules" }
 *
 * When the same top-level key appears both as a plain key and as a
 * dot-notation prefix, the nested properties are merged into the existing
 * object value.
 */
function unflattenPatch(patch) {
  const result = {};
  for (const [key, value] of Object.entries(patch)) {
    const parts = key.split(".");
    if (parts.length === 1) {
      result[key] = value;
    } else {
      let target = result;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!(parts[i] in target) || typeof target[parts[i]] !== "object" || target[parts[i]] === null) {
          target[parts[i]] = {};
        }
        target = target[parts[i]];
      }
      target[parts[parts.length - 1]] = value;
    }
  }
  return result;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);
}

function deepMergeObjects(baseValue, patchValue) {
  if (!isPlainObject(patchValue)) return patchValue;
  const base = isPlainObject(baseValue) ? { ...baseValue } : {};
  for (const [key, value] of Object.entries(patchValue)) {
    if (isPlainObject(value) && isPlainObject(base[key])) {
      base[key] = deepMergeObjects(base[key], value);
    } else {
      base[key] = value;
    }
  }
  return base;
}

const JSON_MERGE_KEYS = [
  "theme",
  "content",
  "settings",
  "modules",
  "accessSettings",
  "onboardingDraft",
  "launch",
  "onboardingProgress",
  "billingDetails",
  "directorLegalAgreement"
];

async function resolveTenantForAdmin(req, { allowSuperAdmin = true } = {}) {
  const isSuperAdmin = req.user.roles?.includes("super_admin");
  const isTenantAdmin = req.user.roles?.includes("tenant_admin");

  if (!isTenantAdmin && !(allowSuperAdmin && isSuperAdmin)) {
    return {
      error: {
        status: 403,
        payload: {
          error: {
            code: "ROLE_FORBIDDEN",
            message: "Tenant admin role is required."
          }
        }
      }
    };
  }

  const tenantId =
    String(req.query.tenantId || "").trim() ||
    String(req.body?.tenantId || "").trim() ||
    String(req.user.tenantId || "").trim();

  let tenant = null;
  if (tenantId) {
    tenant = await TenantModel.findById(tenantId);
  }

  if (!tenant) {
    const context = getTenantContext(req);
    if (context.slug) {
      tenant = await TenantModel.findBySlug(context.slug);
    } else if (context.host) {
      tenant = await TenantModel.findByDomain(context.host);
    }
  }

  if (!tenant && !tenantId) {
    return {
      error: {
        status: 400,
        payload: {
          error: {
            code: "TENANT_REQUIRED",
            message:
              "No tenant context found for this admin user. Open this route from a camp domain or pass tenantId."
          }
        }
      }
    };
  }

  if (!tenant) {
    return {
      error: {
        status: 404,
        payload: {
          error: {
            code: "TENANT_NOT_FOUND",
            message: "Tenant not found"
          }
        }
      }
    };
  }

  if (!isSuperAdmin && String(req.user.tenantId) !== String(tenant._id)) {
    return {
      error: {
        status: 403,
        payload: {
          error: {
            code: "TENANT_SCOPE_DENIED",
            message: "You cannot manage another tenant"
          }
        }
      }
    };
  }

  return { tenant, isSuperAdmin, isTenantAdmin };
}

function applyChecklistAndStep(tenant, { currentChecklist, stepToComplete, nextStep }) {
  let checklist = mergeChecklist(currentChecklist || tenant.onboardingChecklist || createDefaultChecklist());

  if (stepToComplete) {
    checklist = markChecklistForStep(checklist, stepToComplete, "completed");
  }

  const onboardingStep = nextStep || tenant.onboardingStep || getCurrentStepFromChecklist(checklist);

  return {
    checklist,
    onboardingStep
  };
}

function resolveRequestedBillingPlan(body = {}, tenant = null) {
  const direct = String(body?.planCode || body?.billingPlan || "").trim().toLowerCase();
  if (direct) {
    if (!VALID_BILLING_PLAN_CODES.has(direct)) {
      return {
        error: {
          status: 400,
          payload: {
            error: {
              code: "INVALID_BILLING_PLAN",
              message: "Billing plan must be legacy, founders, or institutional."
            }
          }
        }
      };
    }
    return { planCode: direct };
  }

  const planTier = String(body?.planTier || "").trim().toLowerCase();
  if (planTier === "premium") return { planCode: "institutional" };
  if (planTier === "base") return { planCode: "legacy" };

  return {
    planCode: tenant ? resolveTenantBilling(tenant).billingPlan : "legacy"
  };
}

function onboardingPayload(tenant, counts, extra = {}) {
  return {
    ...buildOnboardingResponse(tenant, { counts, includeDraft: true }),
    features: listFeaturesForPlan(tenant.planTier, tenant.addOns || []),
    ...extra
  };
}

async function saveTenantOnboarding(tenantId, update) {
  const patch = unflattenPatch(update);
  const existing = await TenantModel.findById(tenantId);
  if (!existing) {
    const error = new Error("Tenant not found.");
    error.statusCode = 404;
    throw error;
  }

  for (const key of JSON_MERGE_KEYS) {
    if (isPlainObject(patch[key])) {
      patch[key] = deepMergeObjects(existing[key] || {}, patch[key]);
    }
  }

  return TenantModel.update(tenantId, patch);
}

router.patch("/me/onboarding/draft", requireAuth, async (req, res, next) => {
  try {
    const resolved = await resolveTenantForAdmin(req, { allowSuperAdmin: true });
    if (resolved.error) {
      return res.status(resolved.error.status).json(resolved.error.payload);
    }

    const { tenant } = resolved;
    const body = req.body || {};
    const update = {
      "onboardingDraft.updatedAt": new Date(),
      "onboardingDraft.updatedByUserId": req.user.id
    };

    if (body.theme && typeof body.theme === "object") {
      const existing = tenant.onboardingDraft?.theme || {};
      update["onboardingDraft.theme"] = { ...existing, ...body.theme };
    }
    if (body.modules && typeof body.modules === "object") {
      update["onboardingDraft.modules"] = body.modules;
    }
    if (body.content && typeof body.content === "object") {
      const existing = tenant.onboardingDraft?.content || {};
      update["onboardingDraft.content"] = { ...existing, ...body.content };
    }
    if (body.billingDetails && typeof body.billingDetails === "object") {
      update["onboardingDraft.billingDetails"] = body.billingDetails;
    }

    await saveTenantOnboarding(tenant._id, update);
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

router.get("/me/onboarding", requireAuth, async (req, res) => {
  const resolved = await resolveTenantForAdmin(req, { allowSuperAdmin: true });
  if (resolved.error) {
    return res.status(resolved.error.status).json(resolved.error.payload);
  }

  const { tenant } = resolved;
  const [users, profiles] = await Promise.all([
    UserModel.count(tenant._id),
    ProfileModel.count(tenant._id)
  ]);

  const readiness = getReadinessChecklist(tenant, { importedCount: profiles });

  return res.json(
    onboardingPayload(tenant, { users, profiles }, {
      readiness,
      nextRecommendedStep:
        tenant.onboardingStep || getCurrentStepFromChecklist(tenant.onboardingChecklist || [])
    })
  );
});

router.patch("/me/onboarding", requireAuth, async (req, res, next) => {
  try {
    const resolved = await resolveTenantForAdmin(req, { allowSuperAdmin: true });
    if (resolved.error) {
      return res.status(resolved.error.status).json(resolved.error.payload);
    }

    const { tenant } = resolved;
    const parsed = await validateOnboardingPatchPayload(req.body || {});

    const checklist = mergeChecklist(tenant.onboardingChecklist || [], parsed.checklist || []);
    const onboardingStep = parsed.onboardingStep || getCurrentStepFromChecklist(checklist);

    const onboardingProgress = buildProgressUpdate(tenant, {
      checklist,
      onboardingStep
    });

    const updated = await saveTenantOnboarding(tenant._id, {
      onboardingStep,
      onboardingChecklist: checklist,
      onboardingStatus: tenant.onboardingStatus === "live" ? "live" : "in_progress",
      onboardingProgress
    });

    await createAuditLog({
      tenantId: tenant._id,
      actorUserId: req.user.id,
      event: "onboarding_progress_updated",
      metadata: {
        onboardingStep,
        checklistStatus: checklist.map((item) => ({ id: item.id, status: item.status }))
      }
    });

    return res.json(onboardingPayload(updated, null));
  } catch (error) {
    return next(error);
  }
});

router.patch("/me/theme", requireAuth, async (req, res, next) => {
  try {
    const resolved = await resolveTenantForAdmin(req, { allowSuperAdmin: true });
    if (resolved.error) {
      return res.status(resolved.error.status).json(resolved.error.payload);
    }

    const { tenant } = resolved;
    const incoming = req.body.theme || req.body || {};
    const validTheme = await validateThemePayload({
      ...resolveDraft(tenant).theme,
      ...incoming
    });

    const { checklist, onboardingStep } = applyChecklistAndStep(tenant, {
      stepToComplete: "name_branding",
      nextStep: "welcome_message"
    });

    const update = {
      "onboardingDraft.theme": validTheme,
      "onboardingDraft.updatedAt": new Date(),
      "onboardingDraft.updatedByUserId": req.user.id,
      onboardingChecklist: checklist,
      onboardingStep,
      onboardingStatus: tenant.onboardingStatus === "live" ? "live" : "in_progress",
      onboardingProgress: buildProgressUpdate(tenant, { checklist, onboardingStep })
    };

    if (tenant.onboardingStatus === "live") {
      update.theme = validTheme;
    }

    const updated = await saveTenantOnboarding(tenant._id, update);

    await createAuditLog({
      tenantId: tenant._id,
      actorUserId: req.user.id,
      event: "theme_updated",
      metadata: {
        onboardingStatus: updated.onboardingStatus
      }
    });

    return res.json(onboardingPayload(updated, null));
  } catch (error) {
    return next(error);
  }
});

router.patch("/me/content", requireAuth, async (req, res, next) => {
  try {
    const resolved = await resolveTenantForAdmin(req, { allowSuperAdmin: true });
    if (resolved.error) {
      return res.status(resolved.error.status).json(resolved.error.payload);
    }

    const { tenant } = resolved;
    const incoming = req.body.content || req.body || {};
    const validContent = await validateContentPayload({
      ...resolveDraft(tenant).content,
      ...incoming
    });

    const { checklist, onboardingStep } = applyChecklistAndStep(tenant, {
      stepToComplete: "welcome_message",
      nextStep: "signup_controls"
    });

    const update = {
      "onboardingDraft.content": validContent,
      "onboardingDraft.updatedAt": new Date(),
      "onboardingDraft.updatedByUserId": req.user.id,
      onboardingChecklist: checklist,
      onboardingStep,
      onboardingStatus: tenant.onboardingStatus === "live" ? "live" : "in_progress",
      onboardingProgress: buildProgressUpdate(tenant, { checklist, onboardingStep })
    };

    if (tenant.onboardingStatus === "live") {
      update.content = validContent;
    }

    const updated = await saveTenantOnboarding(tenant._id, update);

    await createAuditLog({
      tenantId: tenant._id,
      actorUserId: req.user.id,
      event: "content_updated",
      metadata: {
        fields: Object.keys(incoming || {})
      }
    });

    return res.json(onboardingPayload(updated, null));
  } catch (error) {
    return next(error);
  }
});

router.patch("/me/settings", requireAuth, async (req, res, next) => {
  try {
    const resolved = await resolveTenantForAdmin(req, { allowSuperAdmin: true });
    if (resolved.error) {
      return res.status(resolved.error.status).json(resolved.error.payload);
    }

    const { tenant } = resolved;
    const storedSettings = await buildSettingsStorePayload(req.body || {}, tenant);

    const { checklist, onboardingStep } = applyChecklistAndStep(tenant, {
      stepToComplete: "signup_controls",
      nextStep: "import_alumni"
    });

    const normalizedSignupMode = normalizeSignupMode(storedSettings.signupMode);

    const update = {
      "onboardingDraft.settings": storedSettings,
      "onboardingDraft.updatedAt": new Date(),
      "onboardingDraft.updatedByUserId": req.user.id,
      onboardingChecklist: checklist,
      onboardingStep,
      onboardingStatus: tenant.onboardingStatus === "live" ? "live" : "in_progress",
      onboardingProgress: buildProgressUpdate(tenant, { checklist, onboardingStep }),
      "accessSettings.signupMode": normalizedSignupMode,
      "accessSettings.accessCode": ""
    };

    if (tenant.onboardingStatus === "live") {
      update.settings = storedSettings;
    }

    const updated = await saveTenantOnboarding(tenant._id, update);

    await createAuditLog({
      tenantId: tenant._id,
      actorUserId: req.user.id,
      event: "signup_mode_changed",
      metadata: {
        signupMode: normalizedSignupMode,
        hasAccessCode: Boolean(storedSettings.accessCodeHash)
      }
    });

    return res.json(onboardingPayload(updated, null));
  } catch (error) {
    return next(error);
  }
});

router.patch("/me/modules", requireAuth, async (req, res, next) => {
  try {
    const resolved = await resolveTenantForAdmin(req, { allowSuperAdmin: true });
    if (resolved.error) {
      return res.status(resolved.error.status).json(resolved.error.payload);
    }

    const { tenant } = resolved;
    const incoming = req.body.modules || req.body || {};
    const validModules = await validateModulesPayload({
      ...resolveModules(tenant, { applyPlanGating: false }),
      ...incoming
    });

    const { checklist, onboardingStep } = applyChecklistAndStep(tenant, {
      stepToComplete: "modules",
      nextStep: "review_launch"
    });

    const update = {
      "onboardingDraft.modules": validModules,
      "onboardingDraft.updatedAt": new Date(),
      "onboardingDraft.updatedByUserId": req.user.id,
      onboardingChecklist: checklist,
      onboardingStep,
      onboardingStatus: tenant.onboardingStatus === "live" ? "live" : "in_progress",
      onboardingProgress: buildProgressUpdate(tenant, { checklist, onboardingStep })
    };

    if (tenant.onboardingStatus === "live") {
      update.modules = validModules;
    }

    const updated = await saveTenantOnboarding(tenant._id, update);

    await createAuditLog({
      tenantId: tenant._id,
      actorUserId: req.user.id,
      event: "modules_updated",
      metadata: {
        enabled: Object.entries(validModules).filter(([, enabled]) => enabled).map(([key]) => key)
      }
    });

    return res.json(onboardingPayload(updated, null));
  } catch (error) {
    return next(error);
  }
});

router.post("/me/admins", requireAuth, async (req, res) => {
  const resolved = await resolveTenantForAdmin(req, { allowSuperAdmin: true });
  if (resolved.error) {
    return res.status(resolved.error.status).json(resolved.error.payload);
  }

  const { tenant } = resolved;
  const email = String(req.body.email || "").trim().toLowerCase();

  if (!email) {
    return res.status(400).json({
      error: {
        code: "EMAIL_REQUIRED",
        message: "Admin email is required."
      }
    });
  }

  const user = await UserModel.findOne(tenant._id, { email });
  if (!user) {
    return res.status(404).json({
      error: {
        code: "USER_NOT_FOUND",
        message: "User must create an account before becoming an admin."
      }
    });
  }

  const roleSet = new Set(user.roles || []);
  roleSet.add("user");
  roleSet.add("tenant_admin");
  const updatedRoles = [...roleSet];
  const updatedUser = await UserModel.update(user._id, { roles: updatedRoles });

  await createAuditLog({
    tenantId: tenant._id,
    actorUserId: req.user.id,
    event: "tenant_admin_added",
    metadata: {
      email,
      addedUserId: user._id
    }
  });

  const safe = { ...updatedUser };
  delete safe.passwordHash;

  return res.status(201).json({
    ok: true,
    admin: safe
  });
});

async function runImportCsvHandler(req, res, next) {
  try {
    const resolved = await resolveTenantForAdmin(req, { allowSuperAdmin: true });
    if (resolved.error) {
      return res.status(resolved.error.status).json(resolved.error.payload);
    }

    const { tenant } = resolved;
    const skipImport = toBoolean(req.body?.skip);

    if (skipImport) {
      const { checklist, onboardingStep } = applyChecklistAndStep(tenant, {
        stepToComplete: "import_alumni",
        nextStep: "modules"
      });

      const updated = await saveTenantOnboarding(tenant._id, {
        onboardingChecklist: checklist,
        onboardingStep,
        onboardingStatus: tenant.onboardingStatus === "live" ? "live" : "in_progress",
        onboardingProgress: buildProgressUpdate(tenant, {
          checklist,
          onboardingStep,
          importStats: {
            imported: 0,
            skipped: 0,
            rowsRead: 0
          }
        })
      });

      await createAuditLog({
        tenantId: tenant._id,
        actorUserId: req.user.id,
        event: "csv_import_skipped",
        metadata: {}
      });

      return res.json({
        ok: true,
        skippedImport: true,
        importSummary: { imported: 0, skipped: 0, rowsRead: 0, errors: [] },
        onboarding: onboardingPayload(updated, null)
      });
    }

    if (!req.file?.buffer) {
      return res.status(400).json({
        error: {
          code: "CSV_REQUIRED",
          message: "Upload CSV file under field name 'file'"
        }
      });
    }

    const enableFuzzyMatch = toBoolean(req.body?.enableFuzzyMatch);
    const fuzzyDistance = toBoundedInt(req.body?.fuzzyDistance, {
      min: 0,
      max: 4,
      fallback: 1
    });

    const importResult = await runTenantCsvImport({
      tenantId: tenant._id,
      userId: req.user.id,
      fileName: req.file.originalname || "import.csv",
      csvBuffer: req.file.buffer,
      options: { enableFuzzyMatch, fuzzyDistance }
    });

    const imported = importResult.createdCount + importResult.updatedCount;
    const skipped = importResult.skippedDuplicates + importResult.errors.length;
    const errors = importResult.errors.slice(0, 25).map((item) => ({
      row: item.rowNumber,
      reason: item.message
    }));

    const { checklist, onboardingStep } = applyChecklistAndStep(tenant, {
      stepToComplete: "import_alumni",
      nextStep: "modules"
    });

    const updated = await saveTenantOnboarding(tenant._id, {
      onboardingChecklist: checklist,
      onboardingStep,
      onboardingStatus: tenant.onboardingStatus === "live" ? "live" : "in_progress",
      onboardingProgress: buildProgressUpdate(tenant, {
        checklist,
        onboardingStep,
        importStats: {
          imported,
          skipped,
          rowsRead: importResult.rowsRead
        }
      })
    });

    await createAuditLog({
      tenantId: tenant._id,
      actorUserId: req.user.id,
      event: "csv_import_run",
      metadata: {
        reportId: importResult.reportId,
        createdCount: importResult.createdCount,
        updatedCount: importResult.updatedCount,
        skippedDuplicates: importResult.skippedDuplicates,
        errorCount: importResult.errors.length
      }
    });

    return res.json({
      ok: true,
      importSummary: {
        reportId: importResult.reportId,
        createdCount: importResult.createdCount,
        updatedCount: importResult.updatedCount,
        skippedDuplicates: importResult.skippedDuplicates,
        errorCount: importResult.errors.length,
        imported,
        skipped,
        rowsRead: importResult.rowsRead,
        errors,
        failureCsvDownloadPath: importResult.failureCsv
          ? `/api/t/${tenant.slug}/admin/imports/${importResult.reportId}/failures.csv`
          : ""
      },
      onboarding: onboardingPayload(updated, null)
    });
  } catch (error) {
    if (error?.code === "CSV_INVALID_FORMAT") {
      return res.status(400).json({
        error: {
          code: "CSV_INVALID_FORMAT",
          message: error.message
        }
      });
    }

    return next(error);
  }
}

router.post("/me/import-csv", requireAuth, csvUpload.single("file"), runImportCsvHandler);
router.post("/me/import/csv", requireAuth, csvUpload.single("file"), runImportCsvHandler);

router.get("/me/import/history", requireAuth, async (req, res) => {
  const resolved = await resolveTenantForAdmin(req, { allowSuperAdmin: true });
  if (resolved.error) {
    return res.status(resolved.error.status).json(resolved.error.payload);
  }

  const { tenant } = resolved;
  const reports = await ImportReportModel.find(tenant._id, {}, {
    sort: { createdAt: -1 },
    limit: 50
  });

  return res.json({
    total: reports.length,
    items: reports.map((report) => ({
      id: String(report._id),
      fileName: report.fileName,
      createdAt: report.createdAt,
      summary: report.summary,
      options: report.options,
      errorCount: report.summary?.errorCount || 0
    }))
  });
});

router.post("/me/launch", requireAuth, async (req, res) => {
  const resolved = await resolveTenantForAdmin(req, { allowSuperAdmin: true });
  if (resolved.error) {
    return res.status(resolved.error.status).json(resolved.error.payload);
  }

  const { tenant, isSuperAdmin } = resolved;
  const superAdminOverride = isSuperAdmin && toBoolean(req.body?.superAdminOverride);
  const launchMode = String(req.body?.mode || "").trim().toLowerCase();
  const fromDirectorWizard = launchMode === "director_wizard";
  const requestedLegalAgreementAccepted = hasOwn(req.body, "legalAgreementAccepted")
    ? Boolean(req.body.legalAgreementAccepted)
    : undefined;
  const termsVersion = String(req.body?.termsVersion || DEFAULT_TERMS_VERSION).trim() || DEFAULT_TERMS_VERSION;
  const privacyVersion =
    String(req.body?.privacyVersion || DEFAULT_PRIVACY_VERSION).trim() || DEFAULT_PRIVACY_VERSION;

  if (tenant.status !== "active") {
    return res.status(403).json({
      error: {
        code: "TENANT_INACTIVE",
        message: "This camp is inactive. Contact PondBridge support."
      }
    });
  }

  const profilesCount = await ProfileModel.count(tenant._id);
  const readiness = getReadinessChecklist(tenant, { importedCount: profilesCount });
  const billingReadiness = getBillingReadiness(tenant);
  const checklistBlockers = readiness.checks.filter(
    (item) => !item.ok && item.id !== "billing" && item.id !== "legal"
  );
  const legalAccepted =
    requestedLegalAgreementAccepted !== undefined
      ? requestedLegalAgreementAccepted
      : Boolean(
          tenant?.onboardingDraft?.directorLegalAgreement?.accepted ||
            tenant?.directorLegalAgreement?.accepted
        );
  const legalBlockers = !fromDirectorWizard || superAdminOverride
    ? []
    : legalAccepted
    ? []
    : [
        {
          id: "legal",
          label: "Director legal agreement must be accepted",
          ok: false
        }
      ];
  const blockingChecklist = fromDirectorWizard ? [] : checklistBlockers;
  const billingBlockers =
    superAdminOverride || (fromDirectorWizard && !env.DIRECTOR_WIZARD_REQUIRE_BILLING)
      ? []
      : readiness.checks.filter((item) => !item.ok && item.id === "billing");
  const launchBlockers = [
    ...blockingChecklist,
    ...legalBlockers,
    ...billingBlockers
  ];

  if (launchBlockers.length > 0) {
    return res.status(400).json({
      error: {
        code: "LAUNCH_BLOCKED",
        message: "Complete required onboarding steps before launch.",
        details: {
          blockers: launchBlockers,
          billing: billingReadiness,
          superAdminOverrideApplied: superAdminOverride
        }
      }
    });
  }

  const draft = resolveDraft(tenant);
  const checklist = markChecklistForStep(
    mergeChecklist(tenant.onboardingChecklist || []),
    "review_launch",
    "completed"
  );

  const launchDate = new Date();
  const onboardingStep = "review_launch";
  const liveSettings = await buildSettingsStorePayload(draft.settings || {}, tenant);
  const resolvedDomain = resolveTenantDomain(tenant);
  const legalAgreementPayload = {
    accepted: true,
    acceptedAt: launchDate,
    acceptedByUserId: req.user.id,
    termsVersion,
    privacyVersion
  };
  const updated = await saveTenantOnboarding(tenant._id, {
    theme: resolveTheme({ theme: draft.theme }),
    content: draft.content,
    settings: liveSettings,
    modules: draft.modules,
    "onboardingDraft.directorLegalAgreement": legalAgreementPayload,
    directorLegalAgreement: legalAgreementPayload,
    customDomain: resolvedDomain,
    "accessSettings.signupMode": normalizeSignupMode(liveSettings.signupMode),
    "accessSettings.accessCode": "",
    onboardingStatus: "live",
    onboardingStep,
    onboardingChecklist: checklist,
    launch: {
      launchedAt: launchDate,
      launchedByUserId: req.user.id
    },
    onboardingProgress: buildProgressUpdate(tenant, {
      checklist,
      onboardingStep,
      launchedAt: launchDate
    })
  });

  await createAuditLog({
    tenantId: tenant._id,
    actorUserId: req.user.id,
    event: "launched",
    metadata: {
      launchedAt: launchDate,
      superAdminOverride,
      billingReady: billingReadiness.ok
    }
  });

  return res.json({
    ok: true,
    network: buildTenantUrls(updated),
    onboarding: onboardingPayload(updated, null, {
      readiness,
      billing: getBillingReadiness(updated),
      launchMeta: {
        superAdminOverride,
        fromDirectorWizard
      }
    })
  });
});

router.patch("/me/billing", requireAuth, async (req, res) => {
  const resolved = await resolveTenantForAdmin(req, { allowSuperAdmin: true });
  if (resolved.error) {
    return res.status(resolved.error.status).json(resolved.error.payload);
  }

  const { tenant, isSuperAdmin } = resolved;
  const mode = getBillingMode();
  const manualAllowed = mode === "mock" || isSuperAdmin;

  const requestedStatus = String(req.body?.billingStatus || "").trim().toLowerCase();
  const requestedFeePaid =
    req.body && Object.prototype.hasOwnProperty.call(req.body, "onboardingFeePaid")
      ? Boolean(req.body.onboardingFeePaid)
      : undefined;
  const requestedInvoiceId = String(req.body?.onboardingFeeInvoiceId || "").trim();
  const billingPayload =
    req.body?.billingDetails && typeof req.body.billingDetails === "object"
      ? req.body.billingDetails
      : req.body || {};
  const hasBillingDetailsUpdate =
    hasOwn(billingPayload, "mailingAddress") ||
    hasOwn(billingPayload, "billingAddress") ||
    hasOwn(billingPayload, "sameAsMailing") ||
    hasOwn(req.body, "mailingAddress") ||
    hasOwn(req.body, "billingAddress") ||
    hasOwn(req.body, "billingAddressSameAsMailing");

  const hasBillingStateUpdate = Boolean(
    requestedStatus || requestedFeePaid !== undefined || requestedInvoiceId
  );

  if (!manualAllowed && hasBillingStateUpdate) {
    return res.status(403).json({
      error: {
        code: "BILLING_MANAGED_EXTERNALLY",
        message: "Billing state is managed by Stripe and cannot be changed manually."
      }
    });
  }

  if (!hasBillingStateUpdate && !hasBillingDetailsUpdate) {
    return res.status(400).json({
      error: {
        code: "NO_BILLING_UPDATES",
        message: "Provide at least one billing field to update."
      }
    });
  }

  const allowedStatuses = new Set(["trialing", "active", "past_due", "canceled"]);
  if (requestedStatus && !allowedStatuses.has(requestedStatus)) {
    return res.status(400).json({
      error: {
        code: "INVALID_BILLING_STATUS",
        message: "Billing status must be trialing, active, past_due, or canceled."
      }
    });
  }

  const update = {};
  if (requestedStatus) update.billingStatus = requestedStatus;
  if (requestedFeePaid !== undefined) update.onboardingFeePaid = requestedFeePaid;
  if (requestedInvoiceId) update.onboardingFeeInvoiceId = requestedInvoiceId;
  if (hasBillingDetailsUpdate) {
    const sourceMailingAddress = hasOwn(billingPayload, "mailingAddress")
      ? billingPayload.mailingAddress
      : req.body?.mailingAddress;
    const sourceBillingAddress = hasOwn(billingPayload, "billingAddress")
      ? billingPayload.billingAddress
      : req.body?.billingAddress;
    const sameAsMailing = hasOwn(billingPayload, "sameAsMailing")
      ? Boolean(billingPayload.sameAsMailing)
      : hasOwn(req.body, "billingAddressSameAsMailing")
      ? Boolean(req.body.billingAddressSameAsMailing)
      : tenant?.billingDetails?.sameAsMailing !== false;

    const mailingAddress = normalizeAddress(
      sourceMailingAddress || tenant?.billingDetails?.mailingAddress || {}
    );
    const billingAddress = sameAsMailing
      ? { ...mailingAddress }
      : normalizeAddress(sourceBillingAddress || tenant?.billingDetails?.billingAddress || {});

    const mailingError = validateAddress(mailingAddress);
    const billingError = sameAsMailing ? "" : validateAddress(billingAddress);
    if (mailingError || billingError) {
      return res.status(400).json({
        error: {
          code: "INVALID_BILLING_ADDRESS",
          message: mailingError || billingError
        }
      });
    }

    const normalizedDetails = {
      sameAsMailing,
      mailingAddress,
      billingAddress
    };
    update.billingDetails = normalizedDetails;
    update["onboardingDraft.billingDetails"] = normalizedDetails;
  }
  update.onboardingStatus = tenant.onboardingStatus === "live" ? "live" : "in_progress";

  const updated = await saveTenantOnboarding(tenant._id, update);

  await createAuditLog({
    tenantId: tenant._id,
    actorUserId: req.user.id,
    event: "billing_state_updated",
    metadata: {
      mode,
      update
    }
  });

  return res.json({
    ok: true,
    mode,
    stripeEnabled: isStripeEnabled(),
    tenant: {
      id: String(updated._id),
      slug: updated.slug,
      name: updated.name,
      planTier: updated.planTier,
      billingStatus: updated.billingStatus,
      onboardingFeeAmount: updated.onboardingFeeAmount,
      onboardingFeePaid: Boolean(updated.onboardingFeePaid),
      onboardingFeeInvoiceId: updated.onboardingFeeInvoiceId || "",
      billingDetails: updated.billingDetails || {}
    },
    billing: getBillingReadiness(updated)
  });
});

router.patch("/me/plan", requireAuth, async (req, res) => {
  const resolved = await resolveTenantForAdmin(req, { allowSuperAdmin: true });
  if (resolved.error) {
    return res.status(resolved.error.status).json(resolved.error.payload);
  }

  const { tenant } = resolved;
  const requestedPlanTier = String(req.body?.planTier || "").trim().toLowerCase();
  if (!["base", "premium"].includes(requestedPlanTier)) {
    return res.status(400).json({
      error: {
        code: "INVALID_PLAN_TIER",
        message: "Plan tier must be base or premium."
      }
    });
  }

  const updated = await TenantModel.update(tenant._id, {
    planTier: requestedPlanTier,
    onboardingStatus: tenant.onboardingStatus === "live" ? "live" : "in_progress"
  });

  await createAuditLog({
    tenantId: tenant._id,
    actorUserId: req.user.id,
    event: "plan_updated",
    metadata: {
      from: tenant.planTier,
      to: requestedPlanTier
    }
  });

  return res.json({
    ok: true,
    tenant: {
      id: String(updated._id),
      slug: updated.slug,
      name: updated.name,
      planTier: updated.planTier,
      billingStatus: updated.billingStatus,
      onboardingFeeAmount: updated.onboardingFeeAmount,
      onboardingFeePaid: Boolean(updated.onboardingFeePaid),
      onboardingFeeInvoiceId: updated.onboardingFeeInvoiceId || ""
    },
    features: listFeaturesForPlan(updated.planTier, updated.addOns || [])
  });
});

router.post("/me/billing/checkout", requireAuth, async (req, res, next) => {
  try {
    const resolved = await resolveTenantForAdmin(req, { allowSuperAdmin: true });
    if (resolved.error) {
      return res.status(resolved.error.status).json(resolved.error.payload);
    }

    const { tenant } = resolved;
    const requestedPlan = resolveRequestedBillingPlan(req.body || {}, tenant);
    if (requestedPlan.error) {
      return res.status(requestedPlan.error.status).json(requestedPlan.error.payload);
    }
    const planCode = requestedPlan.planCode;
    const checkout = await createTenantCheckoutSession({
      tenant,
      billingOperator: req.user,
      planCode,
      successUrl: req.body?.successUrl,
      cancelUrl: req.body?.cancelUrl
    });

    const updatedTenant = checkout?.tenant || (await TenantModel.findById(tenant._id));
    const [foundersAvailability] = await Promise.all([
      getFoundersAvailability()
    ]);

    await createAuditLog({
      tenantId: tenant._id,
      actorUserId: req.user.id,
      event: "billing_checkout_started",
      metadata: {
        mode: checkout.mode,
        planCode,
        sessionId: checkout.sessionId || ""
      }
    });

    return res.status(201).json({
      ok: true,
      mode: checkout.mode,
      stripeEnabled: isStripeEnabled(),
      checkoutUrl: checkout.checkoutUrl,
      sessionId: checkout.sessionId || "",
      notes: checkout.message || "",
      catalog: getBillingCatalog(),
      foundersAvailability,
      billing: buildBillingPublicSnapshot(updatedTenant),
      tenant: {
        id: String(updatedTenant._id),
        slug: updatedTenant.slug,
        name: updatedTenant.name,
        planTier: updatedTenant.planTier,
        billingStatus: updatedTenant.billingStatus,
        onboardingFeeAmount: updatedTenant.onboardingFeeAmount,
        onboardingFeePaid: Boolean(updatedTenant.onboardingFeePaid),
        onboardingFeeInvoiceId: updatedTenant.onboardingFeeInvoiceId || ""
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/me/billing", requireAuth, async (req, res) => {
  const resolved = await resolveTenantForAdmin(req, { allowSuperAdmin: true });
  if (resolved.error) {
    return res.status(resolved.error.status).json(resolved.error.payload);
  }

  const { tenant, isSuperAdmin } = resolved;

  if (!isSuperAdmin && String(req.user.tenantId) !== String(tenant._id)) {
    return res.status(403).json({
      error: {
        code: "TENANT_SCOPE_DENIED",
        message: "You cannot view billing for another tenant"
      }
    });
  }

  const [portal, foundersAvailability] = await Promise.all([
    createBillingPortalUrl({ tenant: { ...tenant } }),
    getFoundersAvailability()
  ]);
  const billing = buildBillingPublicSnapshot(tenant);

  return res.json({
    mode: getBillingMode(),
    stripeEnabled: isStripeEnabled(),
    tenant: {
      id: String(tenant._id),
      slug: tenant.slug,
      name: tenant.name,
      planTier: tenant.planTier,
      billingPlan: billing.billingPlan,
      billingStatus: billing.billingStatus,
      billingLifecycleStatus: billing.lifecycleStatus,
      stripeCustomerId: tenant.stripeCustomerId,
      stripeSubscriptionId: tenant.stripeSubscriptionId,
      stripePriceId: tenant.stripePriceId,
      onboardingFeeAmount: billing.onboardingFeeAmount,
      onboardingFeePaid: billing.onboardingFeePaid,
      onboardingFeeStatus: billing.onboardingFeeStatus,
      onboardingFeeWaived: billing.onboardingFeeWaived,
      onboardingFeeInvoiceId: tenant.onboardingFeeInvoiceId || "",
      billingDetails: tenant.billingDetails || {},
      directorLegalAgreement: tenant.directorLegalAgreement || {},
      currentPeriodEnd: billing.currentPeriodEnd,
      foundersReserved: billing.foundersReserved,
      foundersSlot: billing.foundersSlot,
      foundersEligible: billing.foundersEligible
    },
    features: listFeaturesForPlan(tenant.planTier, tenant.addOns || []),
    catalog: getBillingCatalog(),
    foundersAvailability,
    billing,
    manageSubscriptionUrl: portal.url || "",
    notes: portal.message || ""
  });
});

export default router;
