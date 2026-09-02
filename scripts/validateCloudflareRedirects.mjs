#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const redirectsPath = process.argv[2] || path.join("apps", "web", "public", "_redirects");
const content = fs.readFileSync(redirectsPath, "utf8");

const hasBadIndexFallback = /\/\*\s+\/index\.html\s+200/.test(content);
const hasBad404AssetRule = /\/assets\/\*\s+\/404\.html\s+404/.test(content);
const hasSpaFallback = /\/\*\s+\/\s+200/.test(content);
const hasAssetsPassthrough = /\/assets\/\*\s+\/assets\/:splat\s+200/.test(content);

const AASA_PATH = "/.well-known/apple-app-site-association";
const aasaRule =
  /^\s*\/\.well-known\/apple-app-site-association\s+\/\.well-known\/apple-app-site-association\s+200\s*$/m;
const aasaIndex = content.search(aasaRule);
const spaFallbackIndex = content.search(/^\s*\/\*\s+\/\s+200\s*$/m);

const issues = [];
if (aasaIndex === -1) {
  issues.push(
    `Missing Universal Links passthrough rule: '${AASA_PATH} ${AASA_PATH} 200'. ` +
      "Without it the SPA fallback answers Apple with index.html and link verification fails."
  );
} else if (spaFallbackIndex !== -1 && aasaIndex > spaFallbackIndex) {
  issues.push(
    `The '${AASA_PATH}' rule must appear above the '/* / 200' SPA fallback. ` +
      "Cloudflare Pages applies the first matching rule."
  );
}
if (hasBadIndexFallback) {
  issues.push("Invalid Cloudflare Pages fallback detected: '/* /index.html 200'. Use '/* / 200'.");
}
if (hasBad404AssetRule) {
  issues.push(
    "Invalid asset rule detected: '/assets/* /404.html 404'. Serve assets directly instead."
  );
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
