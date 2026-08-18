import { ProfileModel } from "../db/models/index.js";

/**
 * The one definition of "how many alumni are in this network": profiles a
 * director has not flagged or removed.
 *
 * Every surface that shows a total reads it from here. When each one wrote its
 * own query they drifted — the member home page counted removed profiles, the
 * map counted only the members it could place on a pin, and the director
 * dashboard counted a third way, so one network read as 345, 314, and 344 on
 * three pages of the same site.
 */
export function countActiveAlumni(tenantId) {
  return ProfileModel.count(tenantId, { status: "active" });
}

/** Filter form of the same rule, for queries that read profiles rather than count them. */
export const ACTIVE_ALUMNI_FILTER = { status: "active" };
