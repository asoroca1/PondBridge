import { extractVerificationRouteHint } from "../src/services/clerkWebhooks.js";
import { verificationCodeTemplate } from "../src/services/emailTemplates.js";

describe("Clerk verification email helpers", () => {
  test("extracts director onboarding audience from tenant subdomain route", () => {
    expect(
      extractVerificationRouteHint("https://test23.pondbridgealumni.com/director-create-account")
    ).toEqual({
      tenantSlug: "test23",
      host: "test23.pondbridgealumni.com",
      audience: "director"
    });
  });

  test("extracts member onboarding audience from tenant slug route", () => {
    expect(
      extractVerificationRouteHint("Continue at https://app.pondbridgealumni.com/t/test23/create-account")
    ).toEqual({
      tenantSlug: "test23",
      host: "app.pondbridgealumni.com",
      audience: "member"
    });
  });

  test("renders director verification copy with PondBridge onboarding language", () => {
    const template = verificationCodeTemplate({
      brandName: "PondBridge",
      code: "123456",
      audience: "director"
    });

    expect(template.subject).toContain("123456");
    expect(template.text).toContain("PondBridge director account");
    expect(template.html).toContain("Director onboarding verification");
  });
});
