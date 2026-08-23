export const CEDAR_SEO_HOST = "cedar.pondbridgealumni.com";
export const CEDAR_SEO_URL = `https://${CEDAR_SEO_HOST}/`;

export const CEDAR_PUBLIC_SEO = Object.freeze({
  title: "Camp Cedar Alumni Network",
  description:
    "Reconnect with the Camp Cedar community. Find fellow alumni, share memories and photos, and stay connected through the Camp Cedar Alumni Network.",
  canonicalUrl: CEDAR_SEO_URL,
  siteName: "Camp Cedar Alumni Network"
});

export function normalizeHostname(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
}

export function isCedarSeoHostname(value = "") {
  return normalizeHostname(value) === CEDAR_SEO_HOST;
}

export function requestTargetsCedar(request) {
  try {
    return isCedarSeoHostname(new URL(request.url).hostname);
  } catch {
    return false;
  }
}

export function cedarStructuredData() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${CEDAR_SEO_URL}#website`,
    name: CEDAR_PUBLIC_SEO.siteName,
    alternateName: "Camp Cedar Alumni",
    url: CEDAR_SEO_URL,
    description: CEDAR_PUBLIC_SEO.description,
    inLanguage: "en-US"
  };
}

export function cedarHeadMarkup() {
  const structuredData = JSON.stringify(cedarStructuredData()).replace(/</g, "\\u003c");

  return [
    `<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" data-pondbridge-seo="cedar">`,
    `<link rel="canonical" href="${CEDAR_SEO_URL}" data-pondbridge-seo="cedar">`,
    `<link rel="sitemap" type="application/xml" href="${CEDAR_SEO_URL}sitemap.xml" data-pondbridge-seo="cedar">`,
    `<meta property="og:type" content="website" data-pondbridge-seo="cedar">`,
    `<meta property="og:title" content="${CEDAR_PUBLIC_SEO.title}" data-pondbridge-seo="cedar">`,
    `<meta property="og:description" content="${CEDAR_PUBLIC_SEO.description}" data-pondbridge-seo="cedar">`,
    `<meta property="og:url" content="${CEDAR_SEO_URL}" data-pondbridge-seo="cedar">`,
    `<meta property="og:site_name" content="${CEDAR_PUBLIC_SEO.siteName}" data-pondbridge-seo="cedar">`,
    `<meta name="twitter:card" content="summary" data-pondbridge-seo="cedar">`,
    `<meta name="twitter:title" content="${CEDAR_PUBLIC_SEO.title}" data-pondbridge-seo="cedar">`,
    `<meta name="twitter:description" content="${CEDAR_PUBLIC_SEO.description}" data-pondbridge-seo="cedar">`,
    `<script type="application/ld+json" data-pondbridge-seo="cedar">${structuredData}</script>`
  ].join("\n");
}

export function cedarLandingFallbackMarkup() {
  return `<section class="landing-hero" data-pondbridge-seo="cedar-fallback">
  <div class="landing-overlay"></div>
  <div class="landing-content">
    <span class="landing-preline">Welcome to the</span>
    <h1 class="landing-headline">
      <span class="landing-headline-camp">Camp Cedar</span>
      <span class="landing-headline-network">Alumni&nbsp;Network</span>
    </h1>
    <p class="landing-subtitle">${CEDAR_PUBLIC_SEO.description}</p>
    <div class="landing-cta">
      <a class="landing-btn landing-btn-primary" href="/create-account">Create Account</a>
      <a class="landing-btn landing-btn-secondary" href="/login">Login</a>
    </div>
  </div>
</section>`;
}

export function cedarRobotsTxt() {
  return `User-agent: *
Allow: /
Disallow: /admin
Disallow: /auth
Disallow: /create-account
Disallow: /director-
Disallow: /forgot-password
Disallow: /home
Disallow: /login
Disallow: /request-access
Sitemap: ${CEDAR_SEO_URL}sitemap.xml
`;
}

export function cedarSitemapXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${CEDAR_SEO_URL}</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`;
}
