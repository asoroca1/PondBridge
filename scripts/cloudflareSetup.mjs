#!/usr/bin/env node

import fs from "fs";
import path from "path";
import process from "process";

function parseDotEnv(filePath) {
  const output = {};
  if (!fs.existsSync(filePath)) return output;

  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex < 1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    output[key] = value;
  }
  return output;
}

function envValue(key, fallback = "") {
  const val = process.env[key];
  return typeof val === "string" && val.length > 0 ? val : fallback;
}

function toBool(value, fallback = false) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  return ["1", "true", "yes", "on"].includes(normalized);
}

function stripProtocolAndPath(value = "") {
  const safe = String(value || "").trim();
  if (!safe) return "";
  const noProto = safe.replace(/^https?:\/\//i, "");
  return noProto.split("/")[0].split(":")[0].toLowerCase();
}

function fqdn(name, rootDomain) {
  const trimmed = String(name || "").trim();
  const root = String(rootDomain || "").trim().toLowerCase();
  if (!trimmed || trimmed === "@") return root;
  if (trimmed.endsWith(`.${root}`)) return trimmed.toLowerCase();
  return `${trimmed.toLowerCase()}.${root}`;
}

function makeApiBase(token) {
  return {
    token,
    baseUrl: "https://api.cloudflare.com/client/v4"
  };
}

async function cfRequest(client, method, endpoint, body) {
  const response = await fetch(`${client.baseUrl}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${client.token}`,
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

async function findDnsRecord(client, zoneId, type, name) {
  const q = new URLSearchParams({ type, name, per_page: "1" });
  const payload = await cfRequest(client, "GET", `/zones/${zoneId}/dns_records?${q.toString()}`);
  return payload?.result?.[0] || null;
}

async function upsertCnameRecord(client, zoneId, { name, content, proxied, ttl, dryRun }) {
  const existing = await findDnsRecord(client, zoneId, "CNAME", name);
  const payload = { type: "CNAME", name, content, proxied, ttl };

  if (dryRun) {
    const mode = existing ? "UPDATE" : "CREATE";
    console.log(`[dry-run] DNS ${mode} CNAME ${name} -> ${content} (proxied=${proxied})`);
    return;
  }

  if (existing) {
    await cfRequest(client, "PUT", `/zones/${zoneId}/dns_records/${existing.id}`, payload);
    console.log(`Updated DNS CNAME ${name} -> ${content}`);
    return;
  }

  await cfRequest(client, "POST", `/zones/${zoneId}/dns_records`, payload);
  console.log(`Created DNS CNAME ${name} -> ${content}`);
}

async function bindPagesDomain(client, accountId, projectName, domain, dryRun) {
  if (!accountId || !projectName || !domain) return;
  if (domain.includes("*")) {
    console.log(`Skipping Pages wildcard bind for ${domain} (unsupported by Pages API).`);
    return;
  }
  if (dryRun) {
    console.log(`[dry-run] Pages bind domain ${domain} -> ${projectName}`);
    return;
  }

  try {
    await cfRequest(
      client,
      "POST",
      `/accounts/${accountId}/pages/projects/${projectName}/domains`,
      { name: domain }
    );
    console.log(`Bound Pages domain ${domain}`);
  } catch (error) {
    const msg = String(error?.message || "");
    const normalized = msg.toLowerCase();
    if (
      normalized.includes("already exists") ||
      normalized.includes("already added this custom domain")
    ) {
      console.log(`Pages domain ${domain} already bound`);
      return;
    }
    throw error;
  }
}

function usage() {
  console.log("Usage: node scripts/cloudflareSetup.mjs [--dry-run]");
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--help") || args.has("-h")) {
    usage();
    return;
  }
  const dryRun = args.has("--dry-run");

  const rootEnvPath = path.resolve(process.cwd(), ".env");
  const parsedFileEnv = parseDotEnv(rootEnvPath);
  for (const [key, value] of Object.entries(parsedFileEnv)) {
    if (!(key in process.env)) process.env[key] = value;
  }

  const apiToken = envValue("CLOUDFLARE_API_TOKEN");
  const zoneId = envValue("CLOUDFLARE_ZONE_ID");
  const rootDomain = envValue("CLOUDFLARE_ROOT_DOMAIN", "pondbridgealumni.com");
  const apiRecordName = envValue("CLOUDFLARE_API_RECORD_NAME", "api");
  const webRecordName = envValue("CLOUDFLARE_WEB_RECORD_NAME", "app");
  const wildcardName = envValue("CLOUDFLARE_WILDCARD_RECORD_NAME", "*");
  const apiOriginHost = stripProtocolAndPath(envValue("CLOUDFLARE_API_ORIGIN"));
  const webCnameTarget = stripProtocolAndPath(envValue("CLOUDFLARE_WEB_CNAME_TARGET"));
  const createWildcard = toBool(envValue("CLOUDFLARE_CREATE_WILDCARD", "true"), true);
  const createApex = toBool(envValue("CLOUDFLARE_CREATE_APEX", "true"), true);
  const createWww = toBool(envValue("CLOUDFLARE_CREATE_WWW", "true"), true);
  const defaultProxied = toBool(envValue("CLOUDFLARE_PROXIED", "true"), true);
  const apiProxied = toBool(envValue("CLOUDFLARE_API_PROXIED", String(defaultProxied)), defaultProxied);
  const webProxied = toBool(envValue("CLOUDFLARE_WEB_PROXIED", String(defaultProxied)), defaultProxied);
  const ttl = Number(envValue("CLOUDFLARE_TTL", "1")) || 1;

  const bindPagesDomains = toBool(envValue("CLOUDFLARE_BIND_PAGES_DOMAINS", "false"), false);
  const accountId = envValue("CLOUDFLARE_ACCOUNT_ID");
  const pagesProject = envValue("CLOUDFLARE_PAGES_PROJECT_NAME");

  if (!apiToken || !zoneId) {
    throw new Error("Missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ZONE_ID in root .env.");
  }
  if (!apiOriginHost) {
    throw new Error("Missing CLOUDFLARE_API_ORIGIN in root .env (the actual API host).");
  }
  if (!webCnameTarget) {
    throw new Error(
      "Missing CLOUDFLARE_WEB_CNAME_TARGET in root .env (for Pages use <project>.pages.dev)."
    );
  }

  const client = makeApiBase(apiToken);

  const apiFqdn = fqdn(apiRecordName, rootDomain);
  const webFqdn = fqdn(webRecordName, rootDomain);
  const wildcardFqdn = wildcardName === "*" ? `*.${rootDomain}` : fqdn(wildcardName, rootDomain);
  const apexFqdn = rootDomain;
  const wwwFqdn = `www.${rootDomain}`;

  console.log(`Configuring Cloudflare zone ${zoneId} for ${rootDomain}${dryRun ? " (dry-run)" : ""}...`);

  await upsertCnameRecord(client, zoneId, {
    name: apiFqdn,
    content: apiOriginHost,
    proxied: apiProxied,
    ttl,
    dryRun
  });

  await upsertCnameRecord(client, zoneId, {
    name: webFqdn,
    content: webCnameTarget,
    proxied: webProxied,
    ttl,
    dryRun
  });

  if (createWildcard) {
    await upsertCnameRecord(client, zoneId, {
      name: wildcardFqdn,
      content: webCnameTarget,
      proxied: webProxied,
      ttl,
      dryRun
    });
  }

  if (createApex) {
    await upsertCnameRecord(client, zoneId, {
      name: apexFqdn,
      content: webCnameTarget,
      proxied: webProxied,
      ttl,
      dryRun
    });
  }

  if (createWww) {
    await upsertCnameRecord(client, zoneId, {
      name: wwwFqdn,
      content: webCnameTarget,
      proxied: webProxied,
      ttl,
      dryRun
    });
  }

  if (bindPagesDomains) {
    if (!accountId || !pagesProject) {
      throw new Error(
        "CLOUDFLARE_BIND_PAGES_DOMAINS=true requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_PAGES_PROJECT_NAME."
      );
    }
    await bindPagesDomain(client, accountId, pagesProject, webFqdn, dryRun);
    if (createWildcard) await bindPagesDomain(client, accountId, pagesProject, wildcardFqdn, dryRun);
    if (createApex) await bindPagesDomain(client, accountId, pagesProject, apexFqdn, dryRun);
    if (createWww) await bindPagesDomain(client, accountId, pagesProject, wwwFqdn, dryRun);
  }

  console.log("Cloudflare setup complete.");
}

main().catch((error) => {
  console.error(`Setup failed: ${error.message}`);
  process.exit(1);
});
