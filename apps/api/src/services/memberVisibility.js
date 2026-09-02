function normalizedStatus(value = "") {
  return String(value || "").trim().toLowerCase();
}

export function isRemovedProfile(profile = null) {
  return normalizedStatus(profile?.status) === "removed";
}

export function isInactiveUser(user = null) {
  const status = normalizedStatus(user?.status);
  return status === "inactive" || status === "removed";
}

export function canAccessMemberProfile({ profile = null, user = null } = {}) {
  if (!profile || isRemovedProfile(profile)) return false;
  if (profile?.userId && (!user || isInactiveUser(user))) return false;
  return true;
}

function activityActorUserId(item = {}) {
  return String(item?.actorUserId || item?.actor?.id || "").trim();
}

export function filterActivityItemsForActiveUsers(items = [], users = []) {
  const existingActiveUserIds = new Set(
    (Array.isArray(users) ? users : [])
      .filter((user) => !isInactiveUser(user))
      .map((user) => String(user?._id || user?.id || "").trim())
      .filter(Boolean)
  );

  return (Array.isArray(items) ? items : []).filter((item) => {
    const actorUserId = activityActorUserId(item);
    // System-generated activity has no member actor and remains visible.
    return !actorUserId || existingActiveUserIds.has(actorUserId);
  });
}

export function activityActorUserIds(items = []) {
  return [...new Set(
    (Array.isArray(items) ? items : [])
      .map((item) => activityActorUserId(item))
      .filter(Boolean)
  )];
}
