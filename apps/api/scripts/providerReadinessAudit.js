#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "../../..");

const PROVIDERS = [
  {
    id: "render",
    label: "Render API",
    source: "render.yaml",
    required: true,
    requiredConfiguration: [],
    operatorConfiguration: ["RENDER_API_KEY", "RENDER_SERVICE_ID"],
    thresholds: {
      observedPlan: "legacy starter: 0.5 CPU / 512 MiB",
      reviewAt:
        "sustained peak CPU or memory at 70-80%, rising p95 latency, or connection saturation",
    },
  },
  {
    id: "cloudflare_pages",
    label: "Cloudflare Pages",
    source: "apps/web",
    required: true,
    requiredConfiguration: [],
    operatorConfiguration: [
      "CLOUDFLARE_ACCOUNT_ID",
      "CLOUDFLARE_API_TOKEN",
      "CLOUDFLARE_PAGES_PROJECT_NAME",
    ],
    thresholds: {
      buildsPerMonth: 500,
      concurrentBuilds: 1,
      maxFilesPerSite: 20_000,
      maxFileBytes: 25 * 1024 * 1024,
    },
  },
  {
    id: "cloudflare_r2",
    label: "Cloudflare R2",
    source: "apps/api/src/services/objectStorage.js",
    required: true,
    requiredConfiguration: ["R2_BUCKET_NAME", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"],
    oneOfConfiguration: [["R2_ENDPOINT", "CLOUDFLARE_ACCOUNT_ID"]],
    thresholds: {
      includedGbMonth: 10,
      classAOperationsPerMonth: 1_000_000,
      classBOperationsPerMonth: 10_000_000,
      defaultMaxUploadBytes: 20 * 1024 * 1024,
    },
  },
  {
    id: "cloudflare_stream",
    label: "Cloudflare Stream",
    source: "apps/api/src/services/cloudflareStream.js",
    required: false,
    enabledWhen: (environment) =>
      hasValue(environment, "CLOUDFLARE_ACCOUNT_ID") &&
      (hasValue(environment, "CLOUDFLARE_STREAM_API_TOKEN") ||
        hasValue(environment, "CLOUDFLARE_API_TOKEN")),
    requiredConfiguration: ["CLOUDFLARE_ACCOUNT_ID"],
    oneOfConfiguration: [["CLOUDFLARE_STREAM_API_TOKEN", "CLOUDFLARE_API_TOKEN"]],
    recommendedConfiguration: ["CLOUDFLARE_STREAM_API_TOKEN", "CLOUDFLARE_STREAM_WEBHOOK_SECRET"],
    thresholds: {
      storedMinutesPricePerThousandUsd: 5,
      deliveredMinutesPricePerThousandUsd: 1,
    },
  },
  {
    id: "supabase",
    label: "Supabase",
    source: "apps/api/src/db/provider.js",
    required: true,
    requiredConfiguration: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
    thresholds: {
      connections: "account-specific; record the observed maximum and alert threshold",
      backups: "account-specific; verify PITR and retention",
    },
  },
  {
    id: "clerk",
    label: "Clerk",
    source: "apps/api/src/services/clerkIdentity.js",
    required: false,
    enabledWhen: (environment) =>
      ["clerk", "hybrid"].includes(normalized(environment.AUTH_PROVIDER)),
    requiredConfiguration: ["CLERK_SECRET_KEY", "CLERK_WEBHOOK_SIGNING_SECRET"],
    recommendedConfiguration: ["CLERK_AUTHORIZED_PARTIES"],
    thresholds: {
      usage: "track monthly retained users and 429 responses; plan is account-specific",
    },
  },
  {
    id: "stripe",
    label: "Stripe",
    source: "apps/api/src/services/billing.js",
    required: false,
    enabledWhen: (environment) =>
      normalized(environment.BILLING_MODE) === "stripe" ||
      (normalized(environment.BILLING_MODE) === "auto" &&
        hasValue(environment, "STRIPE_SECRET_KEY")),
    requiredConfiguration: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
    thresholds: { liveApiRequestsPerSecond: 100, sandboxApiRequestsPerSecond: 25 },
  },
  {
    id: "resend",
    label: "Resend",
    source: "apps/api/src/services/email.js",
    required: false,
    enabledWhen: (environment) => normalized(environment.EMAIL_MODE) === "resend",
    requiredConfiguration: ["RESEND_API_KEY", "RESEND_WEBHOOK_SECRET", "EMAIL_FROM"],
    thresholds: {
      freeEmailsPerMonth: 3000,
      freeEmailsPerDay: 100,
      defaultRequestsPerSecond: 5,
    },
  },
  {
    id: "openai",
    label: "OpenAI API",
    source: "apps/api/src/services/aiUsage.js",
    required: false,
    enabledWhen: (environment) => hasValue(environment, "OPENAI_API_KEY"),
    requiredConfiguration: ["OPENAI_API_KEY"],
    thresholds: {
      applicationBudgets: [
        "EMAIL_AGENT_MONTHLY_BUDGET_USD",
        "AI_SEARCH_MONTHLY_BUDGET_USD",
        "PROFILE_IMPORT_MONTHLY_BUDGET_USD",
      ],
      vendorUsage: "reconcile by project in the OpenAI Usage and Costs dashboards",
    },
  },
];

function normalized(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function hasValue(environment, key) {
  return String(environment?.[key] || "").trim().length > 0;
}

function looksLikeHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function missingOneOf(environment, groups = []) {
  return groups
    .filter((group) => !group.some((key) => hasValue(environment, key)))
    .map((group) => group.join("|"));
}

function configurationErrors(provider, environment) {
  const errors = [];
  if (
    provider.id === "supabase" &&
    hasValue(environment, "SUPABASE_URL") &&
    !looksLikeHttpUrl(environment.SUPABASE_URL)
  ) {
    errors.push("SUPABASE_URL must be an http(s) URL");
  }
  if (
    provider.id === "cloudflare_r2" &&
    hasValue(environment, "R2_ENDPOINT") &&
    !looksLikeHttpUrl(environment.R2_ENDPOINT)
  ) {
    errors.push("R2_ENDPOINT must be an http(s) URL");
  }
  return errors;
}

function configurationWarnings(provider, environment) {
  const warnings = (provider.recommendedConfiguration || [])
    .filter((key) => !hasValue(environment, key))
    .map((key) => `${key} is recommended`);

  if (
    provider.id === "cloudflare_stream" &&
    !hasValue(environment, "CLOUDFLARE_STREAM_API_TOKEN") &&
    hasValue(environment, "CLOUDFLARE_API_TOKEN")
  ) {
    warnings.push("using the broader CLOUDFLARE_API_TOKEN fallback");
  }
  return warnings;
}

export function assessProvider(provider, environment = process.env) {
  const sourcePath = path.join(REPO_ROOT, provider.source);
  const sourcePresent = fs.existsSync(sourcePath);
  const enabled = provider.required || Boolean(provider.enabledWhen?.(environment));
  const missing = enabled
    ? [
        ...(provider.requiredConfiguration || []).filter((key) => !hasValue(environment, key)),
        ...missingOneOf(environment, provider.oneOfConfiguration),
      ]
    : [];
  const errors = enabled ? configurationErrors(provider, environment) : [];
  const warnings = enabled ? configurationWarnings(provider, environment) : [];

  let status = "disabled";
  if (enabled && (!sourcePresent || errors.length)) status = "failure";
  else if (enabled && missing.length) status = "unverified";
  else if (enabled && warnings.length) status = "configured_with_warnings";
  else if (enabled) status = "configured";

  return {
    label: provider.label,
    source: provider.source,
    required: provider.required,
    enabled,
    status,
    sourcePresent,
    missingConfiguration: missing,
    missingOperatorConfiguration: (provider.operatorConfiguration || []).filter(
      (key) => !hasValue(environment, key)
    ),
    configurationErrors: errors,
    warnings,
    accountEvidence: "unknown",
    usageEvidence: "unknown",
    thresholds: provider.thresholds,
  };
}

export function buildProviderReadinessAudit(environment = process.env) {
  const providers = Object.fromEntries(
    PROVIDERS.map((provider) => [provider.id, assessProvider(provider, environment)])
  );
  const values = Object.values(providers);
  return {
    generatedAt: new Date().toISOString(),
    mode: "read-only-local-configuration",
    redaction:
      "only configuration names and statuses are emitted; values and identifiers are never emitted",
    providers,
    summary: {
      configured: values.filter((item) => item.status === "configured").length,
      configuredWithWarnings: values.filter((item) => item.status === "configured_with_warnings")
        .length,
      unverified: values.filter((item) => item.status === "unverified").length,
      disabled: values.filter((item) => item.status === "disabled").length,
      failures: values.filter((item) => item.status === "failure").length,
      accountChecksPerformed: 0,
      usageChecksPerformed: 0,
    },
  };
}

function formatText(audit) {
  return [
    "PondBridge provider readiness (read-only local configuration)",
    ...Object.entries(audit.providers).map(([id, item]) => {
      const details = [
        item.missingConfiguration.length
          ? `missing=${item.missingConfiguration.join(",")}`
          : "missing=none",
        item.missingOperatorConfiguration.length
          ? `operator_missing=${item.missingOperatorConfiguration.join(",")}`
          : "operator_missing=none",
        item.warnings.length ? `warnings=${item.warnings.join(";")}` : "warnings=none",
        `account=${item.accountEvidence}`,
        `usage=${item.usageEvidence}`,
      ];
      return `${id}: ${item.status}; ${details.join("; ")}`;
    }),
    `Summary: configured=${audit.summary.configured} configured_with_warnings=${audit.summary.configuredWithWarnings} unverified=${audit.summary.unverified} disabled=${audit.summary.disabled} failures=${audit.summary.failures}`,
  ].join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const audit = buildProviderReadinessAudit();
  const output = process.argv.includes("--json")
    ? JSON.stringify(audit, null, 2)
    : formatText(audit);
  process.stdout.write(`${output}\n`);

  const strict = process.argv.includes("--strict");
  if (audit.summary.failures > 0 || (strict && audit.summary.unverified > 0)) {
    process.exitCode = 1;
  }
}
