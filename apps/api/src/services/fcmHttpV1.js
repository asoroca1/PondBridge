import crypto from "crypto";

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_TOKEN_AUDIENCE = GOOGLE_TOKEN_URL;
const FCM_DEFAULT_CHANNEL_ID = "pondbridge_updates";
const PERMANENT_FCM_ERROR_CODES = new Set(["UNREGISTERED", "SENDER_ID_MISMATCH"]);

let accessTokenCache = null;

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function normalizePrivateKey(value = "") {
  return String(value || "").replace(/\\n/g, "\n").trim();
}

function normalizedConfig(config = {}) {
  return {
    projectId: String(config.projectId || "").trim(),
    clientEmail: String(config.clientEmail || "").trim().toLowerCase(),
    privateKey: normalizePrivateKey(config.privateKey)
  };
}

function configCacheKey(config) {
  return crypto
    .createHash("sha256")
    .update(`${config.projectId}\n${config.clientEmail}\n${config.privateKey}`)
    .digest("hex");
}

function responseErrorMessage(payload = {}, fallback = "Firebase Cloud Messaging request failed") {
  return String(payload?.error?.message || payload?.message || fallback).trim() || fallback;
}

export function hasFcmHttpV1Configuration(config = {}) {
  const normalized = normalizedConfig(config);
  return Boolean(normalized.projectId && normalized.clientEmail && normalized.privateKey);
}

export function classifyFcmHttpV1Error(payload = {}, statusCode = 0) {
  const details = Array.isArray(payload?.error?.details) ? payload.error.details : [];
  const fcmDetail = details.find((detail) =>
    String(detail?.["@type"] || "").includes("google.firebase.fcm.v1.FcmError")
  );
  const code = String(fcmDetail?.errorCode || payload?.error?.status || "").trim().toUpperCase();
  return {
    code: code || `HTTP_${Number(statusCode || 0) || "UNKNOWN"}`,
    message: responseErrorMessage(payload, `FCM HTTP ${Number(statusCode || 0) || "unknown"}`),
    permanent: PERMANENT_FCM_ERROR_CODES.has(code)
  };
}

function createServiceAccountAssertion(config, nowMs) {
  const nowSeconds = Math.floor(nowMs / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64UrlEncode(JSON.stringify({
    iss: config.clientEmail,
    scope: FCM_SCOPE,
    aud: GOOGLE_TOKEN_AUDIENCE,
    iat: nowSeconds,
    exp: nowSeconds + 3600
  }));
  const unsigned = `${header}.${claims}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned), config.privateKey);
  return `${unsigned}.${base64UrlEncode(signature)}`;
}

async function getAccessToken(config, { fetchImpl, now }) {
  const nowMs = Number(now());
  const cacheKey = configCacheKey(config);
  if (
    accessTokenCache?.cacheKey === cacheKey &&
    accessTokenCache?.token &&
    Number(accessTokenCache.expiresAt || 0) > nowMs + 60_000
  ) {
    return accessTokenCache.token;
  }

  const assertion = createServiceAccountAssertion(config, nowMs);
  const response = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    }).toString()
  });
  const payload = await response.json().catch(() => ({}));
  const token = String(payload?.access_token || "").trim();
  if (!response.ok || !token) {
    throw new Error(responseErrorMessage(payload, `Google OAuth ${response.status || "unknown"}`));
  }

  const expiresInSeconds = Math.max(60, Number(payload?.expires_in || 3600));
  accessTokenCache = {
    cacheKey,
    token,
    expiresAt: nowMs + expiresInSeconds * 1000
  };
  return token;
}

export async function sendFcmHttpV1Message({
  config,
  token,
  title,
  body,
  data = {},
  soundEnabled = true,
  channelId = FCM_DEFAULT_CHANNEL_ID,
  fetchImpl = globalThis.fetch,
  now = Date.now
}) {
  const normalized = normalizedConfig(config);
  if (!hasFcmHttpV1Configuration(normalized)) {
    return {
      ok: false,
      status: "skipped_no_provider",
      error: "FCM HTTP v1 is not configured",
      permanent: false
    };
  }
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required.");

  const accessToken = await getAccessToken(normalized, { fetchImpl, now });
  const response = await fetchImpl(
    `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(normalized.projectId)}/messages:send`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        message: {
          token: String(token || "").trim(),
          notification: {
            title: String(title || "").trim(),
            body: String(body || "").trim()
          },
          data: Object.fromEntries(
            Object.entries(data && typeof data === "object" ? data : {}).map(([key, value]) => [
              key,
              String(value ?? "")
            ])
          ),
          android: {
            priority: "HIGH",
            notification: {
              channel_id: String(channelId || FCM_DEFAULT_CHANNEL_ID).trim() || FCM_DEFAULT_CHANNEL_ID,
              ...(soundEnabled ? { sound: "default" } : {})
            }
          }
        }
      })
    }
  );
  const payload = await response.json().catch(() => ({}));

  if (response.ok && payload?.name) {
    return {
      ok: true,
      status: "delivered",
      error: "",
      permanent: false,
      providerId: String(payload.name)
    };
  }

  const failure = classifyFcmHttpV1Error(payload, response.status);
  return {
    ok: false,
    status: "failed",
    error: failure.code ? `${failure.code}: ${failure.message}` : failure.message,
    permanent: failure.permanent
  };
}

export function resetFcmHttpV1TokenCacheForTests() {
  accessTokenCache = null;
}
