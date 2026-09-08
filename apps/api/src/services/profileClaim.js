/**
 * Shaping for the claim gate: what an imported profile shows the person it was
 * created for, so they can answer "is this me?" before anything becomes visible.
 *
 * Kept separate from the access route so it can be tested without loading express
 * and every service the route pulls in.
 */

function text(value = "") {
  return String(value || "").trim();
}

function list(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => text(item)).filter(Boolean);
}

/**
 * Deliberately a summary and not the whole profile: enough to recognise yourself,
 * and nothing that would turn an unclaimed row into a way to read a stranger's
 * contact details by signing up with a guessed address. Emails and phone numbers
 * are never included for that reason.
 */
export function claimSummaryFromProfile(profile = {}) {
  const socials = profile?.socials && typeof profile.socials === "object" ? profile.socials : {};
  const camperYears = socials.camperYears && typeof socials.camperYears === "object"
    ? socials.camperYears
    : {};
  const jobs = Array.isArray(profile?.currentJobs) ? profile.currentJobs : [];

  return {
    firstName: text(profile?.firstName),
    lastName: text(profile?.lastName),
    cityState: text(profile?.cityState),
    roleAtCamp: text(profile?.roleAtCamp),
    // Only the two ends of the range; the group names are camp-internal and mean
    // nothing to someone being asked to recognise themselves.
    campYears: [camperYears.firstYear, camperYears.lastYear].map((year) => text(year)).filter(Boolean),
    highSchool: text(profile?.highSchool),
    colleges: list(profile?.colleges),
    industry: text(profile?.industry),
    currentJobs: jobs
      .map((job) => ({ role: text(job?.role), company: text(job?.company) }))
      .filter((job) => job.role || job.company)
  };
}
