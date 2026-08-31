import {
  getStripePublishableKey,
  isEmbeddedCheckoutAvailable,
  normalizeCheckoutUiMode
} from "../src/services/billing.js";

describe("embedded checkout ui mode", () => {
  test("only an explicit 'embedded' request opts into the inline form", () => {
    expect(normalizeCheckoutUiMode("embedded")).toBe("embedded");
    expect(normalizeCheckoutUiMode("  EMBEDDED  ")).toBe("embedded");
  });

  test("anything else falls back to the hosted redirect", () => {
    expect(normalizeCheckoutUiMode()).toBe("hosted");
    expect(normalizeCheckoutUiMode("")).toBe("hosted");
    expect(normalizeCheckoutUiMode("hosted")).toBe("hosted");
    expect(normalizeCheckoutUiMode("nonsense")).toBe("hosted");
    expect(normalizeCheckoutUiMode(null)).toBe("hosted");
  });

  // The wizard mounts Stripe.js with whatever key the checkout response
  // carries. Reporting embedded as available without one would render an empty
  // payment panel and strand the director mid-launch.
  test("never reports embedded as available without a publishable key", () => {
    if (!getStripePublishableKey()) {
      expect(isEmbeddedCheckoutAvailable()).toBe(false);
    } else {
      expect(typeof isEmbeddedCheckoutAvailable()).toBe("boolean");
    }
  });
});
