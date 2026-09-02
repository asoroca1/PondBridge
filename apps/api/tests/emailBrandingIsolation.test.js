import { buildTenantEmailBranding } from "../src/services/email.js";

describe("tenant email branding isolation", () => {
  const cedar = {
    id: "tenant-cedar",
    slug: "cedar",
    name: "Camp Cedar",
    content: {
      networkDisplayName: "Camp Cedar Alumni Network",
      contactEmail: "director@campcedar.example"
    },
    theme: {
      brandPrimary: "#14532d",
      logoUrl: "https://assets.example/cedar-logo.png"
    }
  };

  const pineRidge = {
    id: "tenant-pine-ridge",
    slug: "pine-ridge",
    name: "Pine Ridge Camp",
    content: {
      networkDisplayName: "Pine Ridge Community",
      contactEmail: "director@pineridge.example"
    },
    theme: {
      brandPrimary: "#7c2d12",
      logoUrl: "https://assets.example/pine-ridge-logo.png"
    }
  };

  test("builds Cedar branding only from the Cedar tenant", () => {
    expect(buildTenantEmailBranding(cedar)).toMatchObject({
      networkName: "Camp Cedar Alumni Network",
      replyTo: "director@campcedar.example",
      brandPrimary: "#14532d",
      logoUrl: "https://assets.example/cedar-logo.png"
    });
  });

  test("does not leak any Cedar branding into a control camp", () => {
    const branding = buildTenantEmailBranding(pineRidge);

    expect(branding).toMatchObject({
      networkName: "Pine Ridge Community",
      replyTo: "director@pineridge.example",
      brandPrimary: "#7c2d12",
      logoUrl: "https://assets.example/pine-ridge-logo.png"
    });
    expect(branding.from).toContain("Pine Ridge Community");
    expect(JSON.stringify(branding).toLowerCase()).not.toContain("cedar");
    expect(JSON.stringify(branding)).not.toContain("#14532d");
    expect(JSON.stringify(branding)).not.toContain("cedar-logo.png");
  });

  test("uses a neutral fallback when tenant branding is incomplete", () => {
    const branding = buildTenantEmailBranding({ slug: "new-camp" });

    expect(branding.networkName).toContain("New Camp");
    expect(JSON.stringify(branding).toLowerCase()).not.toContain("cedar");
  });
});
