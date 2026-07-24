import {
  isValidTenantDomain,
  normalizeTenantDomain
} from "../src/utils/domainProvisioning.js";

describe("tenant domain normalization", () => {
  test("normalizes protocol, case, path, and port before persistence", () => {
    expect(normalizeTenantDomain(" HTTPS://Alumni.ExampleCamp.org:443/welcome ")).toBe(
      "alumni.examplecamp.org"
    );
  });

  test.each([
    "alumni.examplecamp.org",
    "camp.pondbridgealumni.com",
    "camp.localhost"
  ])("accepts valid tenant hostname %s", (domain) => {
    expect(isValidTenantDomain(domain)).toBe(true);
  });

  test.each(["", "not-a-host", "-camp.example.com", "camp_.example.com"])(
    "rejects invalid tenant hostname %s",
    (domain) => {
      expect(isValidTenantDomain(domain)).toBe(false);
    }
  );
});
