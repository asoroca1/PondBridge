import { buildTenantUrls } from "../utils/domainProvisioning.js";

// The super console keeps one lightweight CRM record per camp. It lives inside
// `tenant.settings.campProfile` rather than its own column so adding it needs no
// production migration, and so a camp and its client record can never drift apart.
const CAMP_PROFILE_FIELD_LIMITS = {
  directorEmail: 200,
  contactName: 120,
  contactPhone: 60,
  notes: 5000
};

export const CAMP_PROFILE_EDITABLE_FIELDS = Object.keys(CAMP_PROFILE_FIELD_LIMITS);

function text(value, limit) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, limit);
}

function isoOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function readCampProfile(tenant = {}) {
  const stored =
    tenant?.settings?.campProfile && typeof tenant.settings.campProfile === "object"
      ? tenant.settings.campProfile
      : {};

  return {
    directorEmail: text(stored.directorEmail, CAMP_PROFILE_FIELD_LIMITS.directorEmail).toLowerCase(),
    contactName: text(stored.contactName, CAMP_PROFILE_FIELD_LIMITS.contactName),
    contactPhone: text(stored.contactPhone, CAMP_PROFILE_FIELD_LIMITS.contactPhone),
    notes: text(stored.notes, CAMP_PROFILE_FIELD_LIMITS.notes),
    // Captured when the camp was created, so the operator still has the exact
    // link they were handed even if the camp domain later changes.
    directorClaimUrl: text(stored.directorClaimUrl, 500),
    directorClaimPath: text(stored.directorClaimPath, 500),
    createdByUserId: text(stored.createdByUserId, 100),
    updatedByUserId: text(stored.updatedByUserId, 100),
    updatedAt: isoOrNull(stored.updatedAt)
  };
}

// Only the keys actually present in the request body are touched, so a PATCH
// that sends `notes` alone cannot blank out the director email.
export function normalizeCampProfilePatch(input = {}) {
  const patch = {};
  for (const field of CAMP_PROFILE_EDITABLE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(input, field)) continue;
    const value = text(input[field], CAMP_PROFILE_FIELD_LIMITS[field]);
    patch[field] = field === "directorEmail" ? value.toLowerCase() : value;
  }
  return patch;
}

export function hasCampProfilePatch(input = {}) {
  return CAMP_PROFILE_EDITABLE_FIELDS.some((field) =>
    Object.prototype.hasOwnProperty.call(input, field)
  );
}

// Returns the whole `settings` object, because the tenant model writes settings
// as one JSON column — patching it in place would drop every sibling key.
export function buildSettingsWithCampProfile(tenant = {}, patch = {}, meta = {}) {
  const settings = tenant?.settings && typeof tenant.settings === "object" ? tenant.settings : {};
  const current = readCampProfile(tenant);
  const next = { ...current, ...patch };

  if (meta.createdByUserId && !next.createdByUserId) {
    next.createdByUserId = String(meta.createdByUserId);
  }
  if (meta.updatedByUserId) {
    next.updatedByUserId = String(meta.updatedByUserId);
  }
  next.updatedAt = isoOrNull(meta.updatedAt) || new Date().toISOString();

  return { ...settings, campProfile: next };
}

// The claim link is derived from the camp domain, so it can always be rebuilt —
// losing the copy handed over at creation costs nothing. `captured` is reported
// separately only so a stale link the operator may have already shared is visible.
export function resolveDirectorClaimLinks(tenant = {}) {
  const urls = buildTenantUrls(tenant);
  const liveUrl = urls.directorClaimUrl || "";
  const fallbackPath = tenant?.slug ? `/t/${tenant.slug}/director-claim` : "";
  const capturedUrl = readCampProfile(tenant).directorClaimUrl;

  return {
    liveUrl,
    fallbackPath,
    capturedUrl,
    capturedIsStale: Boolean(capturedUrl && liveUrl && capturedUrl !== liveUrl)
  };
}

export const __testables = { CAMP_PROFILE_FIELD_LIMITS };
