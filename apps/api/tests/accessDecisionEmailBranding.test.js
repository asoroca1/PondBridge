import {
  accessApprovedTemplate,
  accessConsentPendingTemplate,
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
    if (_label === "approval") {
      expect(cedar.html).not.toContain("<img");
      expect(cedar.html).toContain("Essential account message");
      expect(cedar.html).not.toContain("notification preferences");
    } else {
      expect(cedar.html).toContain("https://cdn.example.com/cedar-logo.png");
    }
    expect(cedar.html).toContain(tagline);
    expect(cedar.html).not.toContain("Pine Ridge Alumni");
    expect(cedar.html).not.toContain("https://cdn.example.com/pine-logo.png");

    expect(control.html).toContain("Pine Ridge Alumni");
    expect(control.html).toContain("#176b52");
    if (_label === "approval") {
      expect(control.html).not.toContain("<img");
    } else {
      expect(control.html).toContain("https://cdn.example.com/pine-logo.png");
    }
    expect(control.html).toContain(tagline);
    expect(control.html).not.toContain("Camp Cedar Alumni Network");
    expect(control.html).not.toContain("https://cdn.example.com/cedar-logo.png");
  });
});

test("renders a precise essential setup notice without a tenant logo or active-access claim", () => {
  const message = accessConsentPendingTemplate({
    tenantName: "Camp Cedar Alumni Network",
    firstName: "Aden",
    loginUrl: "https://cedar.example.com/login",
    brandPrimary: "#8b1e2d",
    logoUrl: "https://cdn.example.com/cedar-logo.png"
  });

  expect(message.subject).toBe("Finish setting up your Camp Cedar Alumni Network account");
  expect(message.text).toContain("confirm your age eligibility and acceptance of the Terms and Privacy Policy");
  expect(message.text).toContain("No further director approval is needed");
  expect(message.text).not.toContain("You can now log in");
  expect(message.html).toContain("Finish Account Setup");
  expect(message.html).toContain("Essential account message");
  expect(message.html).not.toContain("<img");
  expect(message.html).not.toContain("https://cdn.example.com/cedar-logo.png");
});
