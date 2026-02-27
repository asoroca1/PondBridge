#!/usr/bin/env node

function fail(message) {
  console.error(`Web build env validation failed: ${message}`);
  process.exit(1);
}

const nodeEnv = String(process.env.NODE_ENV || "").trim().toLowerCase();
const isProductionLike =
  process.env.CF_PAGES === "1" ||
  process.env.CI === "true" ||
  nodeEnv === "production";

if (!isProductionLike) {
  console.log("Web build env validation skipped outside production-like builds.");
  process.exit(0);
}

const apiBase = String(process.env.VITE_API_BASE || "").trim();
const authProvider = String(process.env.VITE_AUTH_PROVIDER || "").trim().toLowerCase();
const clerkKey = String(process.env.VITE_CLERK_PUBLISHABLE_KEY || "").trim();

if (!apiBase) {
  fail("VITE_API_BASE is required for production-like builds.");
}

if (/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(apiBase)) {
  fail(`VITE_API_BASE must not point to a local host in production-like builds: ${apiBase}`);
}

if ((authProvider === "clerk" || authProvider === "hybrid") && !clerkKey) {
  fail("VITE_CLERK_PUBLISHABLE_KEY is required when VITE_AUTH_PROVIDER is clerk or hybrid.");
}

console.log("Web build env validation passed.");
