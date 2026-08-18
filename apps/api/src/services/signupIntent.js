/**
 * Clerk's email.created webhook carries no tenant signal: there is no
 * sign_up_id, user_id is null before the account exists, and data holds only
 * instance-level app/theme values. The recipient address is the one thing both
 * sides can see, so the signup flow records which camp an address is signing up
 * for and the webhook reads it back to brand the verification email.
 *
 * Held in memory deliberately. The window between submitting the form and the
 * webhook arriving is about a second, and a miss degrades to PondBridge
 * branding rather than failing the signup.
 */
const SIGNUP_INTENT_TTL_MS = 20 * 60 * 1000;
const MAX_TRACKED_INTENTS = 5000;

const signupIntents = new Map();

function normalizeEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function pruneExpired(now = Date.now()) {
  for (const [key, entry] of signupIntents.entries()) {
    if (Number(entry?.expiresAt || 0) <= now) signupIntents.delete(key);
  }
}

export function rememberSignupIntent({ email = "", tenantSlug = "", audience = "member" } = {}) {
  const key = normalizeEmail(email);
  const slug = String(tenantSlug || "").trim().toLowerCase();
  if (!key || !slug) return false;

  const now = Date.now();
  pruneExpired(now);
  // Cap the map so a flood of signup attempts cannot grow it without bound.
  if (signupIntents.size >= MAX_TRACKED_INTENTS && !signupIntents.has(key)) {
    const oldestKey = signupIntents.keys().next().value;
    if (oldestKey) signupIntents.delete(oldestKey);
  }

  signupIntents.set(key, {
    tenantSlug: slug,
    audience: String(audience || "member").trim().toLowerCase() === "director" ? "director" : "member",
    expiresAt: now + SIGNUP_INTENT_TTL_MS
  });
  return true;
}

export function recallSignupIntent(email = "") {
  const key = normalizeEmail(email);
  if (!key) return null;

  const entry = signupIntents.get(key);
  if (!entry) return null;
  if (Number(entry.expiresAt || 0) <= Date.now()) {
    signupIntents.delete(key);
    return null;
  }
  return { tenantSlug: entry.tenantSlug, audience: entry.audience };
}

export function clearSignupIntents() {
  signupIntents.clear();
}
