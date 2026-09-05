// The title and link-preview tags a camp's pages are served with.
//
// Mail clients, iMessage and Slack unfurl a link by reading the HTML the server
// returns - they never run the bundle - so the camp's own name has to be in that
// document. App.jsx sets document.title after mount, which is right for the tab and
// useless for a preview card: an invite pasted into an email rendered as
// "PondBridge" because that is what index.html ships with.
//
// Pure so the Pages Function and its tests share one definition, the same split
// tenantBrandAssets.js uses for /brand/*.

import { campNetworkTitle, normalizeAssetUrl, resolveTenantIconUrl } from "./tenantBrandAssets.js";

// Marks the tags this rewriter owns, matching cedarSeo's data-pondbridge-seo.
export const TENANT_SEO_MARKER = "tenant";

// The card image. 512 is the largest derivative, and unfurlers downscale.
const PREVIEW_ICON_SIZE = 512;

export function resolveTenantCampName(tenant) {
  return String(tenant?.name || "").trim();
}

export function tenantPageDescription(campName = "") {
  const name = String(campName || "").trim();
  if (!name) return "";
  return `Reconnect with the ${name} community. Find fellow alumni, share photos and memories, and stay connected.`;
}

/**
 * The canonical URL for a preview card. Query strings are dropped on purpose:
 * invite links carry ?inviteToken=&email=, and og:url is echoed back by every
 * client that renders the card. A member's address must not ride along.
 */
export function previewUrl(requestUrl = "") {
  try {
    const url = new URL(requestUrl);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "";
  }
}

/**
 * Returns null when the host resolves to no camp - the platform's own pages keep
 * the PondBridge title that index.html ships with.
 */
export function buildTenantPageSeo(tenant, requestUrl = "") {
  const campName = resolveTenantCampName(tenant);
  if (!campName) return null;

  const title = campNetworkTitle(campName);
  return {
    campName,
    title,
    siteName: title,
    description: tenantPageDescription(campName),
    imageUrl: normalizeAssetUrl(resolveTenantIconUrl(tenant, PREVIEW_ICON_SIZE)),
    canonicalUrl: previewUrl(requestUrl)
  };
}

export function escapeAttribute(value = "") {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function tenantHeadMarkup(seo) {
  if (!seo) return "";
  const tag = (attr, name, content) =>
    content
      ? `<meta ${attr}="${name}" content="${escapeAttribute(content)}" data-pondbridge-seo="${TENANT_SEO_MARKER}">`
      : "";

  return [
    seo.canonicalUrl
      ? `<link rel="canonical" href="${escapeAttribute(seo.canonicalUrl)}" data-pondbridge-seo="${TENANT_SEO_MARKER}">`
      : "",
    tag("property", "og:type", "website"),
    tag("property", "og:site_name", seo.siteName),
    tag("property", "og:title", seo.title),
    tag("property", "og:description", seo.description),
    tag("property", "og:url", seo.canonicalUrl),
    tag("property", "og:image", seo.imageUrl),
    tag("property", "og:image:alt", seo.imageUrl ? `${seo.campName} logo` : ""),
    tag("name", "twitter:card", "summary"),
    tag("name", "twitter:title", seo.title),
    tag("name", "twitter:description", seo.description),
    tag("name", "twitter:image", seo.imageUrl)
  ]
    .filter(Boolean)
    .join("\n");
}
