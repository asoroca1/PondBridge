import { useMemo } from "react";
import { hasAnySocialProfileField, resolveProfileFields } from "@pondbridge/shared";
import { resolveTenantContent } from "./campLabels.js";

/**
 * Which optional profile fields this camp collects.
 *
 * Always a complete map: a tenant that has never touched the setting, or one
 * whose config has not loaded yet, gets the catalog defaults rather than a
 * profile with every field missing.
 */
export function resolveTenantProfileFields(tenant) {
  return resolveProfileFields(resolveTenantContent(tenant).profileFields);
}

export function useProfileFields(tenant) {
  return useMemo(() => {
    const fields = resolveTenantProfileFields(tenant);
    return {
      fields,
      /** `has("phone")` — the one call every render site makes. */
      has: (key) => Boolean(fields[String(key || "")]),
      hasAnySocial: hasAnySocialProfileField(fields)
    };
  }, [tenant]);
}

/** The maiden name a member entered, wherever it happens to be on the payload. */
export function readMaidenName(profile = {}) {
  const socials = profile?.social || profile?.socials || {};
  return String(profile?.maidenName || socials?.maidenName || "").trim();
}

/**
 * Last name as it should be shown: "Chen (Whitfield)" when a maiden name is on
 * file and the camp collects them, and just "Chen" otherwise.
 */
export function formatLastNameWithMaidenName(lastName = "", maidenName = "") {
  const last = String(lastName || "").trim();
  const maiden = String(maidenName || "").trim();
  if (!maiden) return last;
  if (!last) return maiden;
  // A member who typed the same thing in both boxes should not see it twice.
  if (last.toLowerCase() === maiden.toLowerCase()) return last;
  return `${last} (${maiden})`;
}
