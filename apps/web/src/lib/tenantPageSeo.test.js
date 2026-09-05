import { describe, expect, it } from "vitest";
import {
  buildTenantPageSeo,
  previewUrl,
  tenantHeadMarkup,
  tenantPageDescription
} from "./tenantPageSeo.js";

const INVITE_URL =
  "https://greenlane.pondbridgealumni.com/create-account?inviteToken=abc123&email=member%40example.com";

const TENANT = {
  name: "Camp Green Lane",
  theme: {
    logoUrl: "https://cdn.example.com/greenlane/logo.webp",
    iconUrls: { 512: "https://cdn.example.com/greenlane/icon-512.png" }
  }
};

describe("tenant page SEO", () => {
  it("titles a camp's pages with the camp, not the platform", () => {
    const seo = buildTenantPageSeo(TENANT, INVITE_URL);

    expect(seo.title).toBe("Camp Green Lane Alumni Network");
    expect(seo.title).not.toContain("PondBridge");
    expect(tenantHeadMarkup(seo)).not.toContain("PondBridge");
  });

  it("keeps the invite token and member email out of the preview URL", () => {
    expect(previewUrl(INVITE_URL)).toBe(
      "https://greenlane.pondbridgealumni.com/create-account"
    );

    const markup = tenantHeadMarkup(buildTenantPageSeo(TENANT, INVITE_URL));
    expect(markup).not.toContain("inviteToken");
    expect(markup).not.toContain("member%40example.com");
    expect(markup).toContain(
      '<meta property="og:url" content="https://greenlane.pondbridgealumni.com/create-account"'
    );
  });

  it("uses the camp's own icon as the card image", () => {
    const markup = tenantHeadMarkup(buildTenantPageSeo(TENANT, INVITE_URL));

    expect(markup).toContain(
      '<meta property="og:image" content="https://cdn.example.com/greenlane/icon-512.png"'
    );
    expect(markup).toContain('content="Camp Green Lane logo"');
    expect(markup).toContain('<meta name="twitter:card" content="summary"');
  });

  it("falls back to the camp logo when no square derivative was generated", () => {
    const seo = buildTenantPageSeo({ name: "Camp Cedar", theme: { logoUrl: TENANT.theme.logoUrl } }, INVITE_URL);
    expect(seo.imageUrl).toBe("https://cdn.example.com/greenlane/logo.webp");
  });

  it("omits the image tags rather than pointing at a camp with no artwork", () => {
    const markup = tenantHeadMarkup(buildTenantPageSeo({ name: "Camp Nowhere" }, INVITE_URL));

    expect(markup).not.toContain("og:image");
    expect(markup).not.toContain("twitter:image");
    expect(markup).toContain('<meta property="og:title" content="Camp Nowhere Alumni Network"');
  });

  it("labels a camp that already carries the word Camp only once", () => {
    expect(buildTenantPageSeo({ name: "Green Lane" }, INVITE_URL).title).toBe(
      "Camp Green Lane Alumni Network"
    );
    expect(tenantPageDescription("Camp Green Lane")).toContain("Camp Green Lane community");
  });

  it("leaves the platform's own pages alone when no camp resolves", () => {
    expect(buildTenantPageSeo(null, "https://pondbridgealumni.com/")).toBeNull();
    expect(buildTenantPageSeo({ name: "   " }, "https://pondbridgealumni.com/")).toBeNull();
    expect(tenantHeadMarkup(null)).toBe("");
  });

  it("escapes a camp name so branding cannot break out of an attribute", () => {
    const markup = tenantHeadMarkup(
      buildTenantPageSeo({ name: 'Camp "Quote" & <Angle>' }, INVITE_URL)
    );

    expect(markup).toContain("&quot;Quote&quot; &amp; &lt;Angle&gt;");
    expect(markup).not.toContain('<Angle>');
  });
});
