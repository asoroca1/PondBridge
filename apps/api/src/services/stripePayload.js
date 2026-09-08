// Webhook versions are independent of the API version used for outbound calls.
// Accept both the legacy and Basil/Clover shapes while that migration is staged.
export function stripeObjectId(value) {
  return typeof value === "string" ? value.trim() : String(value?.id || "").trim();
}

export function invoiceSubscriptionDetails(payload = {}) {
  if (payload.parent?.type === "subscription_details") {
    return payload.parent.subscription_details || {};
  }
  return payload.subscription_details || {};
}

export function stripeSubscriptionId(payload = {}) {
  return stripeObjectId(payload.subscription) ||
    stripeObjectId(invoiceSubscriptionDetails(payload).subscription) ||
    stripeObjectId(payload.metadata?.subscriptionId) ||
    (String(payload.id || "").startsWith("sub_") ? payload.id : "");
}

export function stripeLinePriceId(line = {}) {
  return stripeObjectId(line.price) ||
    (line.pricing?.type === "price_details"
      ? stripeObjectId(line.pricing.price_details?.price) : "");
}

export function stripeSubscriptionPeriodEnd(subscription = {}) {
  const legacy = Number(subscription.current_period_end || 0);
  if (Number.isFinite(legacy) && legacy > 0) return legacy;
  // PondBridge bills one annual recurring item. Use its period, not the latest
  // period of an unrelated item if a subscription also contains add-ons.
  const recurring = (subscription.items?.data || []).find((item) => item.price?.recurring);
  const value = Number((recurring || subscription.items?.data?.[0])?.current_period_end || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}
