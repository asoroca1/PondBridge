/**
 * How the map describes its own coverage.
 *
 * The map can only place members whose city on file resolved to coordinates,
 * so the number of people on pins is usually smaller than the network total.
 * Presenting that subset as the total is what made this page disagree with the
 * home page; when any are missing, the wording says how many of how many.
 */
export function formatMappedAlumniSummary({
  mapped = 0,
  total = 0,
  cities = 0,
  alumniWord = "alumni"
} = {}) {
  const mappedCount = Math.max(0, Number(mapped) || 0);
  const totalCount = Math.max(mappedCount, Number(total) || 0);
  const cityCount = Math.max(0, Number(cities) || 0);
  const cityLabel = `${cityCount} ${cityCount === 1 ? "city" : "cities"}`;

  return totalCount > mappedCount
    ? `${mappedCount} of ${totalCount} ${alumniWord} across ${cityLabel}`
    : `${totalCount} ${alumniWord} across ${cityLabel}`;
}
