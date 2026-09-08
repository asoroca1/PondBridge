import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

const PAGE_SIZE = 25;

const EMPTY_COUNTS = {
  all: 0, member: 0, request: 0, awaiting_setup: 0, invited: 0, expired: 0, prospect: 0, on_hold: 0
};

const EMPTY_RECOGNITION = { invited: 0, known: 0, unrecognized: 0 };

export const DEFAULT_FILTERS = {
  q: "",
  role: "all",
  year: "all",
  completion: "all",
  match: "any",
  sort: "recent"
};

function completionParams(value = "all") {
  // Mirrors the member table's bucket labels so the two agree on what "60-79%" means.
  const ranges = {
    complete: [100, 100],
    high: [80, 99],
    medium: [60, 79],
    low: [30, 59],
    minimal: [0, 29]
  };
  const range = ranges[value];
  return range ? { completionMin: String(range[0]), completionMax: String(range[1]) } : {};
}

/**
 * Filters live in the query string.
 *
 * They used to live in component state, which meant a filtered list could not
 * be linked to, shared or refreshed — and, more to the point here, that Today's
 * breakdowns had nowhere to send a director who wanted the people behind a
 * number. "Counselor 751" is only useful if it can open the 751.
 *
 * Written with replace, so typing in the search box does not fill the back
 * history with a stack of half-typed words.
 */
function filtersFromParams(params) {
  const read = (key) => params.get(key) || DEFAULT_FILTERS[key];
  return {
    q: params.get("q") || "",
    role: read("role"),
    year: read("year"),
    completion: read("completion"),
    match: read("match"),
    sort: read("sort")
  };
}

/**
 * Loads the unified people list. One request serves both the visible page and
 * the rail badge counts, so switching stages never shows stale totals.
 */
export default function usePeopleDirectory({ request, stage = "all" }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => filtersFromParams(searchParams), [searchParams]);

  const setFilters = useCallback(
    (next) => {
      setSearchParams(
        (current) => {
          const resolved = typeof next === "function" ? next(filtersFromParams(current)) : next;
          const params = new URLSearchParams(current);
          for (const [key, value] of Object.entries(resolved)) {
            // A filter at its default is absent, so a plain People link stays a
            // plain URL rather than carrying six "all"s around.
            if (!value || value === DEFAULT_FILTERS[key]) params.delete(key);
            else params.set(key, value);
          }
          return params;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );
  const [page, setPage] = useState(1);
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const reloadRef = useRef(0);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(filters.q), 260);
    return () => window.clearTimeout(timer);
  }, [filters.q]);

  // Any change to what is being asked for returns to the first page.
  useEffect(() => {
    setPage(1);
  }, [stage, debouncedQuery, filters.role, filters.year, filters.completion, filters.match, filters.sort]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      stage,
      q: debouncedQuery,
      role: filters.role,
      year: filters.year,
      match: filters.match,
      sort: filters.sort,
      page: String(page),
      pageSize: String(PAGE_SIZE),
      ...completionParams(filters.completion)
    });
    request(`/people?${params.toString()}`)
      .then((response) => { if (active) setPayload(response); })
      .catch((requestError) => {
        if (!active) return;
        setError(requestError.message || "Could not load people.");
        setPayload(null);
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [
    debouncedQuery,
    filters.completion,
    filters.match,
    filters.role,
    filters.sort,
    filters.year,
    page,
    reloadToken,
    request,
    stage
  ]);

  const reload = useCallback(() => {
    reloadRef.current += 1;
    setReloadToken(reloadRef.current);
  }, []);

  const items = useMemo(() => (Array.isArray(payload?.items) ? payload.items : []), [payload]);
  const counts = payload?.counts || EMPTY_COUNTS;
  const recognitionCounts = payload?.recognitionCounts || EMPTY_RECOGNITION;
  const total = Number(payload?.total || 0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return {
    items,
    counts,
    recognitionCounts,
    total,
    page,
    totalPages,
    setPage,
    filters,
    setFilters,
    resetFilters: () => setFilters(DEFAULT_FILTERS),
    roleOptions: payload?.filters?.roleOptions || [],
    yearOptions: payload?.filters?.yearOptions || [],
    storage: payload?.storage || { available: true },
    loading,
    error,
    setError,
    reload
  };
}
