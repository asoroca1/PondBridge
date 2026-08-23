import { describe, expect, it } from "vitest";
import {
  CEDAR_PUBLIC_SEO,
  CEDAR_SEO_URL,
  cedarHeadMarkup,
  cedarLandingFallbackMarkup,
  cedarRobotsTxt,
  cedarSitemapXml,
  isCedarSeoHostname,
  requestTargetsCedar
} from "./cedarSeo.js";

describe("Camp Cedar public SEO", () => {
  it("targets only the stable Cedar production hostname", () => {
    expect(isCedarSeoHostname("cedar.pondbridgealumni.com")).toBe(true);
    expect(isCedarSeoHostname("CEDAR.PONDBRIDGEALUMNI.COM.")).toBe(true);
    expect(isCedarSeoHostname("pine-ridge.pondbridgealumni.com")).toBe(false);
    expect(requestTargetsCedar(new Request(CEDAR_SEO_URL))).toBe(true);
    expect(requestTargetsCedar(new Request("https://pine-ridge.pondbridgealumni.com/"))).toBe(false);
  });

  it("provides Cedar-specific canonical and social metadata", () => {
    const markup = cedarHeadMarkup();

    expect(CEDAR_PUBLIC_SEO.title).toBe("Camp Cedar Alumni Network");
    expect(markup).toContain(`rel="canonical" href="${CEDAR_SEO_URL}"`);
    expect(markup).toContain('property="og:title" content="Camp Cedar Alumni Network"');
    expect(markup).toContain('type="application/ld+json"');
    expect(markup).not.toContain("pine-ridge");
  });

  it("renders meaningful crawlable landing content", () => {
    const markup = cedarLandingFallbackMarkup();

    expect(markup).toContain("Camp Cedar");
    expect(markup).toContain("Alumni&nbsp;Network");
    expect(markup).toContain('href="/create-account"');
    expect(markup).toContain('href="/login"');
  });

  it("publishes a Cedar sitemap and keeps private routes out of crawl", () => {
    const robots = cedarRobotsTxt();
    const sitemap = cedarSitemapXml();

    expect(robots).toContain("User-agent: *");
    expect(robots).toContain("Disallow: /login");
    expect(robots).toContain(`Sitemap: ${CEDAR_SEO_URL}sitemap.xml`);
    expect(sitemap).toContain(`<loc>${CEDAR_SEO_URL}</loc>`);
    expect(sitemap).not.toContain("pine-ridge");
  });
});
