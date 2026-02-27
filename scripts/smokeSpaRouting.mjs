#!/usr/bin/env node
const baseUrl = String(process.env.SMOKE_BASE_URL || "https://app.pondbridgealumni.com").replace(/\/+$/, "");

const checks = [
  { path: "/super/login", expectedStatus: 200, mustContain: "<!doctype html>" },
  { path: "/super/tenants", expectedStatus: 200, mustContain: "<!doctype html>" },
  { path: "/assets/does-not-exist.js", expectedStatus: 404, mustContain: "404 Not Found" }
];

async function runCheck({ path, expectedStatus, mustContain }) {
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, { redirect: "manual" });
  const body = await res.text();
  if (res.status !== expectedStatus) {
    throw new Error(`${path} returned ${res.status}, expected ${expectedStatus}`);
  }
  if (mustContain && !body.includes(mustContain)) {
    throw new Error(`${path} body did not contain expected marker: ${mustContain}`);
  }
  console.log(`PASS ${path} -> ${res.status}`);
}

for (const check of checks) {
  await runCheck(check);
}

console.log(`SPA routing smoke checks passed for ${baseUrl}`);
