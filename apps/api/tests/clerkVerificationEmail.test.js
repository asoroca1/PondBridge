import {
  classifyClerkEmail,
  enforceVerificationBrandIsolation,
  extractVerificationRouteHint,
  extractVerificationSignUpHint
} from "../src/services/clerkWebhooks.js";
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

  test("extracts authoritative tenant context from Clerk member signup metadata", () => {
    expect(
      extractVerificationSignUpHint({
        tenantSlug: "cedar",
        signupAudience: "member"
      })
    ).toEqual({ tenantSlug: "cedar", audience: "member" });

    expect(
      extractVerificationSignUpHint({
        tenantSlug: "pine-ridge",
        signupAudience: "member"
      })
    ).toEqual({ tenantSlug: "pine-ridge", audience: "member" });
  });

  test("keeps director signup explicitly PondBridge-scoped", () => {
    expect(
      extractVerificationSignUpHint({
        tenantSlug: "cedar",
        signupAudience: "director"
      })
    ).toEqual({ tenantSlug: "cedar", audience: "director" });
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

  test("never uses an existing camp association to brand a new-account code", () => {
    const cedar = { _id: "tenant_cedar", slug: "cedar", name: "Camp Cedar Alumni Network" };
    const verificationKind = classifyClerkEmail(
      { slug: "verification_code" },
      { hasOtpCode: true }
    );

    expect(
      enforceVerificationBrandIsolation(
        { tenant: cedar, audience: "member", source: "email_association" },
        verificationKind
      )
    ).toEqual({
      tenant: null,
      audience: "member",
      source: "email_association_neutralized"
    });
  });

  test("keeps authoritative signup intent while isolating director branding", () => {
    const newCamp = { _id: "tenant_new", slug: "new-camp", name: "New Camp" };
    const verificationKind = classifyClerkEmail(
      { slug: "verification_code" },
      { hasOtpCode: true }
    );
    const context = {
      tenant: newCamp,
      audience: "director",
      source: "signup_intent"
    };

    expect(enforceVerificationBrandIsolation(context, verificationKind)).toBe(context);
  });
});
