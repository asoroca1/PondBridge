/**
 * Everything about a member worth typing into a search box, as one string.
 * The full name is included as well as its parts, so "Dylan Garber" matches
 * the person whose first name is Dylan and last name is Garber.
 */
export function memberSearchHaystack(profile = {}) {
  const first = String(profile?.firstName || "").trim();
  const last = String(profile?.lastName || "").trim();
  return [
    first,
    last,
    `${first} ${last}`.trim(),
    `${last} ${first}`.trim(),
    ...(Array.isArray(profile?.emails) ? profile.emails : []),
    profile?.cityState,
    profile?.roleAtCamp,
    ...(Array.isArray(profile?.collegeYears) ? profile.collegeYears : [])
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/**
 * Every word typed has to appear somewhere, so extra words narrow the results
 * instead of eliminating them. Matching the query as one blob meant a full name
 * found nobody, because it was tested against each name part on its own.
 */
export function matchesMemberQuery(profile = {}, query = "") {
  const tokens = String(query || "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return true;
  const haystack = memberSearchHaystack(profile);
  return tokens.every((token) => haystack.includes(token));
}
