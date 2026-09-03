import { ProfileModel } from "../db/models/index.js";
import { ACTIVE_ALUMNI_FILTER } from "./alumniTotals.js";

/**
 * The camp headline numbers the super console shows.
 *
 * `members` uses the shared alumni rule, so the console agrees with the camp's
 * own director dashboard. It previously counted every profile row, which read
 * 360 for a camp whose director was looking at 358 on the same day.
 *
 * `profiles` is the raw row count, returned only for older callers reading the
 * previous response shape. It is not a number to show beside `members`: every
 * user row owns exactly one profile row, so the two always matched and the
 * console rendered the same figure twice under different labels.
 */
export async function loadCampCounts(tenantId, { profileModel = ProfileModel } = {}) {
  const [members, profiles] = await Promise.all([
    profileModel.count({ tenantId, ...ACTIVE_ALUMNI_FILTER }),
    profileModel.count({ tenantId })
  ]);

  return { members, profiles };
}
