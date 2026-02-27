#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const redirectsPath = process.argv[2] || path.join("apps", "web", "public", "_redirects");
const content = fs.readFileSync(redirectsPath, "utf8");

const hasBadIndexFallback = /\/\*\s+\/index\.html\s+200/.test(content);
const hasBad404AssetRule = /\/assets\/\*\s+\/404\.html\s+404/.test(content);
const hasSpaFallback = /\/\*\s+\/\s+200/.test(content);
const hasAssetsPassthrough = /\/assets\/\*\s+\/assets\/:splat\s+200/.test(content);

const issues = [];
if (hasBadIndexFallback) {
  issues.push("Invalid Cloudflare Pages fallback detected: '/* /index.html 200'. Use '/* / 200'.");
}
if (hasBad404AssetRule) {
  issues.push("Invalid asset rule detected: '/assets/* /404.html 404'. Serve assets directly instead.");
}
if (!hasSpaFallback) {
  issues.push("Missing SPA fallback rule: '/* / 200'.");
}
if (!hasAssetsPassthrough) {
  issues.push("Missing assets passthrough rule: '/assets/* /assets/:splat 200'.");
}

if (issues.length > 0) {
  console.error(`Cloudflare redirects validation failed for ${redirectsPath}:`);
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

console.log(`Cloudflare redirects validation passed for ${redirectsPath}.`);
