// Stripe.js has to be served from Stripe's own domain (bundling it breaks PCI
// compliance and Stripe's fraud signals), so this loads the official script on
// demand instead of pulling in an npm wrapper around the same URL. The CSP in
// apps/web/public/_headers already allows js.stripe.com for scripts and frames.
const STRIPE_JS_URL = "https://js.stripe.com/v3/";

let stripeScriptPromise = null;

function loadStripeGlobal() {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.reject(new Error("Stripe.js can only load in a browser."));
  }
  if (window.Stripe) return Promise.resolve(window.Stripe);
  if (stripeScriptPromise) return stripeScriptPromise;

  stripeScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${STRIPE_JS_URL}"]`);
    const script = existing || document.createElement("script");

    const settle = () => {
      if (window.Stripe) {
        resolve(window.Stripe);
        return;
      }
      stripeScriptPromise = null;
      reject(new Error("Stripe.js loaded without exposing a Stripe global."));
    };

    script.addEventListener("load", settle, { once: true });
    script.addEventListener(
      "error",
      () => {
        stripeScriptPromise = null;
        reject(new Error("Could not load Stripe.js. Check your connection and try again."));
      },
      { once: true }
    );

    if (existing) {
      // A previous mount already appended it; it may have finished loading
      // before this listener attached.
      if (window.Stripe) settle();
      return;
    }

    script.src = STRIPE_JS_URL;
    script.async = true;
    document.head.appendChild(script);
  });

  return stripeScriptPromise;
}

/**
 * Mounts Stripe's embedded Checkout form into `container`.
 *
 * Returns the checkout instance; the caller owns it and must call `destroy()`
 * when unmounting, or Stripe leaves its iframe behind.
 */
export async function mountEmbeddedCheckout({
  publishableKey = "",
  clientSecret = "",
  container = null,
  onComplete = () => {}
} = {}) {
  const key = String(publishableKey || "").trim();
  const secret = String(clientSecret || "").trim();
  if (!key) throw new Error("Stripe publishable key is missing.");
  if (!secret) throw new Error("Stripe checkout session is missing.");
  if (!container) throw new Error("Stripe checkout needs a container element.");

  const StripeGlobal = await loadStripeGlobal();
  const stripe = StripeGlobal(key);
  const checkout = await stripe.initEmbeddedCheckout({
    clientSecret: secret,
    onComplete
  });

  checkout.mount(container);
  return checkout;
}
