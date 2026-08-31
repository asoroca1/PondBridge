import crypto from "crypto";
import { comparePassword } from "../utils/auth.js";
import { env } from "../config/env.js";

const VALID_SIGNUP_MODES = new Set(["open", "code", "invite_only", "approval_queue"]);

export function normalizeSignupMode(value = "") {
  const mode = String(value || "").trim().toLowerCase();
  if (mode === "invite") return "invite_only";
  return VALID_SIGNUP_MODES.has(mode) ? mode : "open";
}

export function normalizeAllowedEmailDomains(value = []) {
  const values = Array.isArray(value) ? value : [];
  return [
    ...new Set(
      values
        .map((domain) =>
          String(domain || "")
            .trim()
            .toLowerCase()
            .replace(/^@/, "")
            .replace(/\.$/, "")
        )
        .filter((domain) => /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(domain))
    )
  ].slice(0, 20);
}

export function resolveTenantAccessPolicy(tenant = null) {
  const settings = tenant?.settings && typeof tenant.settings === "object" ? tenant.settings : {};
  const legacy =
    tenant?.accessSettings && typeof tenant.accessSettings === "object" ? tenant.accessSettings : {};
  const signupMode = normalizeSignupMode(settings.signupMode || legacy.signupMode || "open");
  const accessCodeHash = String(settings.accessCodeHash || "").trim();
  const legacyAccessCode = String(legacy.accessCode || "").trim();

  // How someone reaches the signup form, and whether a director has to say yes,
  // are two separate questions. "approval_queue" is the old single-setting way
  // of asking both at once; it still reads as open entry with the gate on, so
  // tenants saved before the gate existed keep behaving exactly as they did.
  const entryMode = signupMode === "approval_queue" ? "open" : signupMode;
  const requireApproval =
    signupMode === "approval_queue" || Boolean(settings.requireSignupApproval);

  return {
    signupMode,
    entryMode,
    requireApproval,
    joinMode:
      requireApproval
        ? "approval_required"
        : entryMode === "invite_only"
          ? "invite_only"
          : entryMode === "code"
            ? "code_join"
            : "open_join",
    accessCodeHash,
    legacyAccessCode,
    accessCodeHint: String(settings.accessCodeHint || "").trim(),
    allowedEmailDomains: normalizeAllowedEmailDomains(settings.allowedEmailDomains || []),
    requireProfileCompletion: Boolean(settings.requireProfileCompletion),
    hasAccessCode: Boolean(accessCodeHash || legacyAccessCode)
  };
}

export function emailDomain(value = "") {
  const email = String(value || "").trim().toLowerCase();
  const separatorIndex = email.lastIndexOf("@");
  if (separatorIndex <= 0 || separatorIndex === email.length - 1) return "";
  return email.slice(separatorIndex + 1).replace(/\.$/, "");
}

export function isEmailAllowedByPolicy(policy = {}, email = "") {
  const allowedDomains = normalizeAllowedEmailDomains(policy.allowedEmailDomains || []);
  if (allowedDomains.length === 0) return true;
  const domain = emailDomain(email);
  return Boolean(domain && allowedDomains.includes(domain));
}

function constantTimeStringMatch(left = "", right = "") {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export async function verifyTenantAccessCode(tenant = null, submittedCode = "") {
  const policy = resolveTenantAccessPolicy(tenant);
  const code = String(submittedCode || "").trim();
  if (policy.entryMode !== "code" || !code || !policy.hasAccessCode) return false;

  if (policy.accessCodeHash) {
    return comparePassword(code, policy.accessCodeHash).catch(() => false);
  }

  return constantTimeStringMatch(code, policy.legacyAccessCode);
}

function accessGrantSignature(payload = "") {
  return crypto.createHmac("sha256", env.JWT_SECRET).update(payload).digest("base64url");
}

export function createTenantAccessCodeGrant(tenant = null, { ttlMs = 10 * 60 * 1000 } = {}) {
  const tenantId = String(tenant?._id || "").trim();
  if (!tenantId) throw new Error("Tenant is required to issue an access-code grant.");
  const payload = Buffer.from(
    JSON.stringify({
      v: 1,
      purpose: "tenant_access_code",
      tenantId,
      expiresAt: Date.now() + Math.max(60_000, Number(ttlMs) || 0),
      nonce: crypto.randomBytes(12).toString("base64url")
    })
  ).toString("base64url");
  return `${payload}.${accessGrantSignature(payload)}`;
}

export function verifyTenantAccessCodeGrant(tenant = null, grant = "") {
  const [payload = "", submittedSignature = "", ...extra] = String(grant || "").split(".");
  if (!payload || !submittedSignature || extra.length > 0) return false;
  if (!constantTimeStringMatch(accessGrantSignature(payload), submittedSignature)) return false;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Boolean(
      parsed?.v === 1 &&
        parsed?.purpose === "tenant_access_code" &&
        String(parsed?.tenantId || "") === String(tenant?._id || "") &&
        Number(parsed?.expiresAt || 0) > Date.now()
    );
  } catch {
    return false;
  }
}
