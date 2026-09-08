export function savedSearchStorageKey(slug, userId) {
  if (!slug || !userId) return null;
  return `pb.savedSearches.v2.${encodeURIComponent(slug)}.${encodeURIComponent(userId)}`;
}
