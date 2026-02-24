import { env } from "../config/env.js";

const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";

function toBool(value, fallback = false) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  return ["1", "true", "yes", "on"].includes(normalized);
}

function sanitizeDomain(value = "") {
  const safe = String(value || "").trim().replace(/^https?:\/\//i, "");
  return safe.split("/")[0].split(":")[0].toLowerCase();
}

function cloudflareEnabled() {
  return Boolean(
    env.CLOUDFLARE_API_TOKEN &&
      env.CLOUDFLARE_ZONE_ID &&
      env.CLOUDFLARE_ACCOUNT_ID &&
      env.CLOUDFLARE_PAGES_PROJECT_NAME
  );
}

function webCnameTarget() {
  const explicit = sanitizeDomain(env.CLOUDFLARE_WEB_CNAME_TARGET || "");
  if (explicit) return explicit;
  if (!env.CLOUDFLARE_PAGES_PROJECT_NAME) return "";
  return `${env.CLOUDFLARE_PAGES_PROJECT_NAME}.pages.dev`;
}

async function cfRequest(method, endpoint, body) {
  const response = await fetch(`${CLOUDFLARE_API_BASE}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    const messages = Array.isArray(payload?.errors)
      ? payload.errors.map((item) => item.message || JSON.stringify(item)).join("; ")
      : `HTTP ${response.status}`;
    throw new Error(`Cloudflare API ${method} ${endpoint} failed: ${messages}`);
  }
  return payload;
}

async function findDnsRecord(name) {
  const q = new URLSearchParams({ type: "CNAME", name, per_page: "1" });
  const payload = await cfRequest("GET", `/zones/${env.CLOUDFLARE_ZONE_ID}/dns_records?${q.toString()}`);
  return payload?.result?.[0] || null;
}

async function deleteDnsRecord(name) {
  const existing = await findDnsRecord(name);
  if (!existing) return "not_found";
  await cfRequest("DELETE", `/zones/${env.CLOUDFLARE_ZONE_ID}/dns_records/${existing.id}`);
  return "deleted";
}

async function upsertCnameRecord(name, content, proxied, ttl) {
  const payload = { type: "CNAME", name, content, proxied, ttl };
  const existing = await findDnsRecord(name);
  if (existing) {
    await cfRequest("PUT", `/zones/${env.CLOUDFLARE_ZONE_ID}/dns_records/${existing.id}`, payload);
    return "updated";
  }
  await cfRequest("POST", `/zones/${env.CLOUDFLARE_ZONE_ID}/dns_records`, payload);
  return "created";
}

async function bindPagesDomain(domain) {
  try {
    await cfRequest(
      "POST",
      `/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/pages/projects/${env.CLOUDFLARE_PAGES_PROJECT_NAME}/domains`,
      { name: domain }
    );
    return "created";
  } catch (error) {
    const normalized = String(error?.message || "").toLowerCase();
    if (
      normalized.includes("already exists") ||
      normalized.includes("already added this custom domain")
    ) {
      return "already_exists";
    }
    throw error;
  }
}

export async function provisionTenantDomain(domain = "") {
  const safeDomain = sanitizeDomain(domain);
  if (!safeDomain) return { status: "skipped", reason: "missing_domain" };
  if (safeDomain.includes("*")) return { status: "skipped", reason: "wildcard_not_supported" };
  if (!cloudflareEnabled()) return { status: "skipped", reason: "cloudflare_env_missing" };

  const cnameTarget = webCnameTarget();
  if (!cnameTarget) return { status: "skipped", reason: "missing_pages_cname_target" };

  const proxied = toBool(env.CLOUDFLARE_WEB_PROXIED, true);
  const ttl = Number(env.CLOUDFLARE_TTL || "1") || 1;

  const dnsAction = await upsertCnameRecord(safeDomain, cnameTarget, proxied, ttl);
  const pagesAction = await bindPagesDomain(safeDomain);

  return {
    status: "ok",
    domain: safeDomain,
    dnsAction,
    pagesAction,
    cnameTarget,
    proxied,
    ttl
  };
}

export async function deprovisionTenantDomain(domain = "") {
  const safeDomain = sanitizeDomain(domain);
  if (!safeDomain) return { status: "skipped", reason: "missing_domain" };
  if (!cloudflareEnabled()) return { status: "skipped", reason: "cloudflare_env_missing" };

  const dnsAction = await deleteDnsRecord(safeDomain);

  let pagesAction = "not_configured";
  if (env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_PAGES_PROJECT_NAME) {
    try {
      await cfRequest(
        "DELETE",
        `/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/pages/projects/${env.CLOUDFLARE_PAGES_PROJECT_NAME}/domains/${encodeURIComponent(safeDomain)}`
      );
      pagesAction = "deleted";
    } catch (error) {
      const normalized = String(error?.message || "").toLowerCase();
      if (normalized.includes("not found") || normalized.includes("invalid request")) {
        pagesAction = "not_found";
      } else {
        throw error;
      }
    }
  }

  return {
    status: "ok",
    domain: safeDomain,
    dnsAction,
    pagesAction
  };
}
