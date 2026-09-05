/**
 * PostgREST's server-side ceiling on rows per response.
 *
 * Verified against this project on 2026-09-04: `?limit=25000` and an explicit
 * `Range: 0-24999` both returned exactly 1,000 rows with `content-range: 0-999/2871`.
 * A client-side limit cannot raise it — asking for more rows does not get more rows,
 * it just hides the truncation behind a plausible number.
 *
 * Reads that need every row use `Model.findAllBatched()`; totals use `Model.count()`.
 */
export const POSTGREST_MAX_ROWS = 1000;

/**
 * Maximum values in a single `.in(...)` filter.
 *
 * PostgREST takes these as a query string, so a long list becomes a long URL and the
 * gateway rejects it. Measured sending member addresses to `email_suppressions` and
 * `email_preferences`:
 *
 *   250 emails -> 10.1 KB URL -> 200 OK
 *   717 emails -> 28.8 KB URL -> 400 Bad Request
 *
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

/**
 * Drain a `findAllBatched()` generator into one array.
 *
 * Use it where the caller genuinely needs every row at once — building a dedupe map,
 * tallying an aggregate in JS, resolving an audience. Where the rows can be processed
 * a page at a time, iterate the generator directly and keep memory flat.
 */
export async function collectAll(batches) {
  const rows = [];
  for await (const page of batches) rows.push(...page);
  return rows;
}
