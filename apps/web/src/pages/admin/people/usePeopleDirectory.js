import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const PAGE_SIZE = 25;

const EMPTY_COUNTS = {
  all: 0, member: 0, request: 0, invited: 0, expired: 0, prospect: 0, on_hold: 0
};

export const DEFAULT_FILTERS = {
  q: "",
  role: "all",
  year: "all",
  completion: "all",
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
 * Loads the unified people list. One request serves both the visible page and
 * the rail badge counts, so switching stages never shows stale totals.
 */
export default function usePeopleDirectory({ request, stage = "all" }) {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
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
  }, [stage, debouncedQuery, filters.role, filters.year, filters.completion, filters.sort]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      stage,
      q: debouncedQuery,
      role: filters.role,
      year: filters.year,
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
  const total = Number(payload?.total || 0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return {
    items,
    counts,
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
