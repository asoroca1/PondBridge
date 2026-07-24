const EVENT_TYPES = new Set([
  "workspace_opened",
  "question_submitted",
  "evidence_opened",
  "refresh_requested",
  "launch_review_opened"
]);
const MODES = new Set(["guided", "ai"]);
const DIRECTOR_TARGETS = new Set([
  "access",
  "billing",
  "branding",
  "dashboard",
  "detailed_setup",
  "features",
  "invites",
  "legal",
  "network",
  "other"
]);
const SUPER_TARGETS = new Set([
  "billing",
  "camps",
  "dashboard",
  "email",
  "failed_payments",
  "other",
  "pulse",
  "settings"
]);

export function normalizeCopilotTelemetry({ surface, eventType, mode, target = "other" } = {}) {
  const safeSurface = surface === "super" ? "super" : surface === "director" ? "director" : "";
  const safeEventType = String(eventType || "").trim().toLowerCase();
  const safeMode = String(mode || "").trim().toLowerCase();
  const safeTarget = String(target || "other").trim().toLowerCase();
  if (!safeSurface || !EVENT_TYPES.has(safeEventType) || !MODES.has(safeMode)) return null;

  const targets = safeSurface === "director" ? DIRECTOR_TARGETS : SUPER_TARGETS;
  return {
    eventType: `${safeSurface}_agent_${safeEventType}`,
    metadata: {
      mode: safeMode,
      target: targets.has(safeTarget) ? safeTarget : "other",
      surfaceVersion: "agent-workspace-v1"
    }
  };
}
