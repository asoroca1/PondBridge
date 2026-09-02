import {
  accessApprovedTemplate,
  accessDeniedTemplate
} from "../src/services/emailTemplates.js";

describe("access decision email branding", () => {
  test.each([
    ["approval", accessApprovedTemplate, { loginUrl: "https://cedar.example.com/login" }, "Membership approved"],
    ["denial", accessDeniedTemplate, { reason: "We could not verify your connection." }, "Membership request update"]
  ])("renders camp-branded access %s emails", (_label, renderTemplate, details, tagline) => {
    const cedar = renderTemplate({
      tenantName: "Camp Cedar Alumni Network",
      firstName: "Aden",
      brandPrimary: "#8b1e2d",
      logoUrl: "https://cdn.example.com/cedar-logo.png",
      ...details
    });
    const control = renderTemplate({
      tenantName: "Pine Ridge Alumni",
      firstName: "Aden",
      brandPrimary: "#176b52",
      logoUrl: "https://cdn.example.com/pine-logo.png",
      ...details
    });

    expect(cedar.html).toContain("Camp Cedar Alumni Network");
    expect(cedar.html).toContain("#8b1e2d");
    expect(cedar.html).toContain("https://cdn.example.com/cedar-logo.png");
    expect(cedar.html).toContain(tagline);
    expect(cedar.html).not.toContain("Pine Ridge Alumni");
    expect(cedar.html).not.toContain("https://cdn.example.com/pine-logo.png");

    expect(control.html).toContain("Pine Ridge Alumni");
    expect(control.html).toContain("#176b52");
    expect(control.html).toContain("https://cdn.example.com/pine-logo.png");
    expect(control.html).toContain(tagline);
    expect(control.html).not.toContain("Camp Cedar Alumni Network");
    expect(control.html).not.toContain("https://cdn.example.com/cedar-logo.png");
  });
});
