const CONTACT_VISIBILITY_VALUES = new Set(["members", "admins_only", "hidden"]);

export function normalizeContactVisibility(value = "", fallback = "members") {
  const normalized = String(value || "").trim().toLowerCase();
  return CONTACT_VISIBILITY_VALUES.has(normalized) ? normalized : fallback;
}

export function normalizeProfilePrivacy(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    email: normalizeContactVisibility(source.email),
    phone: normalizeContactVisibility(source.phone)
  };
}

function canViewContact({ visibility, isOwner, isAdmin }) {
  if (isOwner) return true;
  if (visibility === "members") return true;
  if (visibility === "admins_only") return isAdmin;
  return false;
}

export function canViewProfileContact(profile = {}, field = "email", viewer = {}) {
  const privacy = normalizeProfilePrivacy(profile?.privacy);
  const viewerUserId = String(viewer?.userId || viewer?.id || "").trim();
  const profileUserId = String(profile?.userId || "").trim();
  const roleSet = new Set(
    (Array.isArray(viewer?.roles) ? viewer.roles : [])
      .map((role) => String(role || "").trim().toLowerCase())
      .filter(Boolean)
  );
  return canViewContact({
    visibility: privacy[field] || "members",
    isOwner: Boolean(viewerUserId && profileUserId && viewerUserId === profileUserId),
    isAdmin: roleSet.has("tenant_admin") || roleSet.has("admin") || roleSet.has("super_admin")
  });
}

export function filterProfileContactFields(profile = {}, viewer = {}) {
  const privacy = normalizeProfilePrivacy(profile?.privacy);
  const showEmail = canViewProfileContact(profile, "email", viewer);
  const showPhone = canViewProfileContact(profile, "phone", viewer);

  return {
    ...profile,
    privacy,
    emails: showEmail ? (Array.isArray(profile?.emails) ? profile.emails : []) : [],
    phones: showPhone ? (Array.isArray(profile?.phones) ? profile.phones : []) : []
  };
}
