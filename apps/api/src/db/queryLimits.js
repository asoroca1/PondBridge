/**
 * Ceilings for reads that legitimately need a whole tenant.
 *
 * PostgREST returns at most 1,000 rows when a query supplies no limit, and it does
 * so silently — `find()` returns 1,000 rows and nothing indicates the other rows
 * exist. Several surfaces derived a total from `rows.length` and so reported 1,000
 * members for a network of 3,000: member browse, the home Community Pulse tile, the
 * alumni map, and the director's own People list (which also feeds Export).
 *
 * Two rules follow from that:
 *
 * 1. A total belongs to `Model.count()` — see services/alumniTotals.js — never to
 *    the length of a fetched array.
 * 2. A read that genuinely needs every row must say so with an explicit limit, so
 *    the ceiling is visible in the call site rather than inherited from PostgREST.
 */

/**
 * PostgREST's server-side ceiling on rows per response. Verified against this project
 * on 2026-09-04: `?limit=25000` and an explicit `Range: 0-24999` both returned exactly
 * 1,000 rows with `content-range: 0-999/2871`.
 *
 * This is the important part: a client-side limit CANNOT raise it. Asking for more
 * rows does not get more rows, it just hides the truncation behind a plausible number.
 * Reads that need the whole tenant must page -- see `Model.findAll()`.
 */
export const POSTGREST_MAX_ROWS = 1000;

/** Upper bound on a paged whole-tenant scan, so one request can never run unbounded. */
export const TENANT_SCAN_LIMIT = 25_000;

/**
 * Maximum values to put in a single `.in(...)` filter.
 *
 * PostgREST takes these as a query string, so a long list becomes a long URL and the
 * gateway rejects it. Measured against this project on 2026-09-04, sending member
 * addresses to `email_suppressions` and `email_preferences`:
 *
 *   250 emails -> 10.1 KB URL -> 200 OK
 *   717 emails -> 28.8 KB URL -> 400 Bad Request
 *
 * This is why the email composer worked while the audience was capped at 1,000 profiles
 * and broke the moment it read the whole tenant: ~700 recipients is past the limit.
 * 200 keeps a URL of member-sized addresses around 8 KB.
 */
export const IN_CLAUSE_CHUNK_SIZE = 200;

/** Split values into `.in(...)`-sized batches. */
export function chunkForInClause(values = [], size = IN_CLAUSE_CHUNK_SIZE) {
  const list = Array.isArray(values) ? values : [];
  const batches = [];
  for (let i = 0; i < list.length; i += size) batches.push(list.slice(i, i + size));
  return batches;
}
