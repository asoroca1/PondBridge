import fs from "node:fs";
import {
  buildDirectorCopilotTools,
  isReadOnlyCopilotTool
} from "../src/services/directorCopilot.js";
import {
  buildSuperCopilotTools,
  isReadOnlySuperCopilotTool
} from "../src/services/superCopilot.js";
import {
  evaluateCopilotResult,
  isExplicitStagingUrl,
  validateCopilotEvalCases
} from "../src/services/copilotEvals.js";

const evalCases = JSON.parse(
  fs.readFileSync(new URL("../evals/copilot-safety-cases.json", import.meta.url), "utf8")
);
const MUTATING_TOOL_NAME = /^(?:create|update|delete|send|execute|approve|deny|launch|charge|refund|retry|provision|reset|close)(?:_|$)/i;

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function validateStrictTool(tool, { role = "" } = {}) {
  requireCondition(tool?.type === "function", `${tool?.name || "unknown"}: tool type must be function`);
  requireCondition(tool?.strict === true, `${tool.name}: strict mode must be enabled`);
  requireCondition(tool?.parameters?.type === "object", `${tool.name}: parameters must be an object schema`);
  requireCondition(tool?.parameters?.additionalProperties === false, `${tool.name}: additional properties must be rejected`);
  requireCondition(!MUTATING_TOOL_NAME.test(tool.name), `${tool.name}: mutating tool names are forbidden`);
  if (role) {
    requireCondition(
      isReadOnlySuperCopilotTool(tool.name, role),
      `${tool.name}: tool is outside the ${role} allowlist`
    );
  } else {
    requireCondition(isReadOnlyCopilotTool(tool.name), `${tool.name}: director tool is outside the allowlist`);
  }
}

function runOfflineContracts() {
  const dataset = validateCopilotEvalCases(evalCases);
  requireCondition(dataset.passed, `Eval dataset is invalid: ${dataset.issues.join(", ")}`);

  const directorTools = buildDirectorCopilotTools();
  directorTools.forEach((tool) => validateStrictTool(tool));
  requireCondition(directorTools.length === 3, "Director Copilot must expose exactly three v1 tools");

  for (const role of ["super_admin", "support_admin", "finance_admin"]) {
    const tools = buildSuperCopilotTools(role);
    tools.forEach((tool) => validateStrictTool(tool, { role }));
    if (role === "finance_admin") {
      const names = tools.map((tool) => tool.name);
      requireCondition(!names.includes("get_platform_pulse"), "Finance cannot access platform pulse tools");
      requireCondition(!names.includes("get_camp_health"), "Finance cannot access camp health tools");
    }
  }

  return {
    cases: evalCases.length,
    directorTools: directorTools.map((tool) => tool.name),
    superTools: buildSuperCopilotTools("super_admin").map((tool) => tool.name),
    supportTools: buildSuperCopilotTools("support_admin").map((tool) => tool.name),
    financeTools: buildSuperCopilotTools("finance_admin").map((tool) => tool.name)
  };
}

function stagingConfig() {
  const baseUrl = String(process.env.COPILOT_EVAL_API_BASE || "").trim().replace(/\/$/, "");
  requireCondition(
    process.env.COPILOT_EVAL_ACK === "staging-read-only",
    "Set COPILOT_EVAL_ACK=staging-read-only to confirm the provider-backed staging eval."
  );
  requireCondition(isExplicitStagingUrl(baseUrl), "COPILOT_EVAL_API_BASE must be an explicit staging, preview, test, dev, or local URL.");
  const config = {
    baseUrl,
    tenantSlug: String(process.env.COPILOT_EVAL_TENANT_SLUG || "").trim().toLowerCase(),
    tokens: {
      tenant_admin: String(process.env.COPILOT_EVAL_DIRECTOR_TOKEN || "").trim(),
      super_admin: String(process.env.COPILOT_EVAL_SUPER_TOKEN || "").trim(),
      support_admin: String(process.env.COPILOT_EVAL_SUPPORT_TOKEN || "").trim(),
      finance_admin: String(process.env.COPILOT_EVAL_FINANCE_TOKEN || "").trim()
    }
  };
  requireCondition(config.tenantSlug, "COPILOT_EVAL_TENANT_SLUG is required.");
  for (const [role, token] of Object.entries(config.tokens)) {
    requireCondition(token, `A staging token is required for ${role}.`);
  }
  return config;
}

async function askStaging(caseItem, config) {
  const isDirector = caseItem.surface === "director";
  const path = isDirector
    ? `/api/t/${encodeURIComponent(config.tenantSlug)}/admin/copilot/ask`
    : "/api/super/copilot/ask";
  const response = await fetch(`${config.baseUrl}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.tokens[caseItem.role]}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ question: caseItem.prompt }),
    signal: AbortSignal.timeout(45_000)
  });
  const payload = await response.json().catch(() => ({}));
  requireCondition(response.ok, `${caseItem.id}: staging request failed with HTTP ${response.status}`);
  const result = evaluateCopilotResult({
    answer: payload.answer,
    links: payload.links,
    surface: caseItem.surface,
    role: caseItem.role
  });
  requireCondition(result.passed, `${caseItem.id}: ${result.issues.join(", ")}`);
  requireCondition(/read[- ]only/i.test(String(payload.disclaimer || "")), `${caseItem.id}: missing read-only disclaimer`);
  return { id: caseItem.id, passed: true, linkCount: Array.isArray(payload.links) ? payload.links.length : 0 };
}

async function fetchCapability(path, token, label, config) {
  const response = await fetch(`${config.baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000)
  });
  const payload = await response.json().catch(() => ({}));
  requireCondition(response.ok, `${label}: capability check failed with HTTP ${response.status}`);
  requireCondition(payload.available === true, `${label}: provider-backed mode is not available`);
  requireCondition(payload.mode === "read_only", `${label}: capability mode must be read_only`);
  return payload;
}

async function checkStagingCapabilities(config) {
  const director = await fetchCapability(
    `/api/t/${encodeURIComponent(config.tenantSlug)}/admin/copilot/capabilities`,
    config.tokens.tenant_admin,
    "director",
    config
  );
  const superRoles = {};
  for (const role of ["super_admin", "support_admin", "finance_admin"]) {
    const capability = await fetchCapability(
      "/api/super/copilot/capabilities",
      config.tokens[role],
      role,
      config
    );
    requireCondition(capability.role === role, `${role}: capability role mismatch`);
    superRoles[role] = {
      role: capability.role,
      toolCount: Array.isArray(capability.tools) ? capability.tools.length : 0
    };
  }
  return {
    director: {
      featureEnabled: director.featureEnabled === true,
      providerConfigured: director.providerConfigured === true,
      toolCount: Array.isArray(director.tools) ? director.tools.length : 0
    },
    superRoles
  };
}

async function main() {
  const offline = runOfflineContracts();
  console.log(JSON.stringify({ mode: "offline", passed: true, ...offline }, null, 2));
  if (!process.argv.includes("--staging")) return;

  const config = stagingConfig();
  const capabilities = await checkStagingCapabilities(config);
  const results = [];
  for (const caseItem of evalCases) {
    results.push(await askStaging(caseItem, config));
  }
  console.log(JSON.stringify({ mode: "staging", passed: true, capabilities, cases: results }, null, 2));
}

main().catch((error) => {
  console.error(`[copilot:eval] ${error.message}`);
  process.exitCode = 1;
});
