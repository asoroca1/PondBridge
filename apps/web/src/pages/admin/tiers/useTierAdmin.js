import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const PAGE_SIZE = 25;

export const DEFAULT_ROSTER_FILTERS = { q: "", scope: "untagged", rank: 0 };

/**
 * Loads the tiers workspace. The overview and the roster are separate requests
 * because tagging repaginates constantly while the tier list and feature floors
 * rarely change; every mutation returns a fresh overview so counts stay honest
 * without a second round trip.
 */
export default function useTierAdmin({ request }) {
  const [overview, setOverview] = useState(null);
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const [filters, setFilters] = useState(DEFAULT_ROSTER_FILTERS);
  // Tier changes made in this view, applied over the fetched rows. Tagging has
  // to feel instant, and a row must not vanish the moment it is tagged or the
  // director never sees what they just did.
  const [overrides, setOverrides] = useState({});
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [roster, setRoster] = useState(null);
  const [rosterLoading, setRosterLoading] = useState(true);
  const reloadRef = useRef(0);
  const [reloadToken, setReloadToken] = useState(0);

  const reloadRoster = useCallback(() => {
    reloadRef.current += 1;
    setReloadToken(reloadRef.current);
  }, []);

  const loadOverview = useCallback(async () => {
    setError("");
    try {
      const response = await request("/tiers");
      setOverview(response);
      setAvailable(true);
    } catch (requestError) {
      if (requestError?.code === "TIERED_ACCESS_UNAVAILABLE" || requestError?.status === 404) {
        setAvailable(false);
        setOverview(null);
      } else {
        setError(requestError.message || "Could not load tiers.");
      }
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => { loadOverview(); }, [loadOverview]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(filters.q), 260);
    return () => window.clearTimeout(timer);
  }, [filters.q]);

  useEffect(() => { setPage(1); }, [debouncedQuery, filters.scope, filters.rank]);

  useEffect(() => {
    setOverrides({});
  }, [debouncedQuery, filters.scope, filters.rank, page]);

  useEffect(() => {
    if (!available) return undefined;
    let active = true;
    setRosterLoading(true);
    const params = new URLSearchParams({
      q: debouncedQuery,
      scope: filters.scope,
      rank: String(filters.rank || 0),
      page: String(page),
      pageSize: String(PAGE_SIZE)
    });
    request(`/tiers/roster?${params.toString()}`)
      .then((response) => { if (active) setRoster(response); })
      .catch((requestError) => {
        if (active) setError(requestError.message || "Could not load the roster.");
      })
      .finally(() => { if (active) setRosterLoading(false); });
    return () => { active = false; };
  }, [available, debouncedQuery, filters.rank, filters.scope, page, reloadToken, request]);

  const mutate = useCallback(
    async (label, path, options) => {
      setBusy(label);
      setError("");
      try {
        const response = await request(path, options);
        if (response?.overview) setOverview(response.overview);
        else if (response?.tiers) setOverview(response);
        return response;
      } catch (requestError) {
        setError(requestError.message || "That did not save.");
        throw requestError;
      } finally {
        setBusy("");
      }
    },
    [request]
  );

  const actions = useMemo(
    () => ({
      addTier: () => mutate("add-tier", "/tiers", { method: "POST", body: {} }),
      renameTier: (tierId, label) =>
        mutate("rename-tier", `/tiers/${tierId}`, { method: "PATCH", body: { label } }),
      removeTier: (tierId) => mutate("remove-tier", `/tiers/${tierId}`, { method: "DELETE" }),
      setSettings: (patch) =>
        mutate("settings", "/tiers/settings", { method: "PATCH", body: patch }),
      assign: async (profileIds, rank) => {
        const ids = Array.isArray(profileIds) ? profileIds : [profileIds];
        if (!ids.length) return null;

        const previous = {};
        setOverrides((current) => {
          const next = { ...current };
          for (const id of ids) {
            previous[id] = id in current ? current[id] : undefined;
            next[id] = rank;
          }
          return next;
        });

        try {
          // The overview that comes back carries the authoritative counts, so
          // the progress meter catches up a moment after the row does.
          return await request("/tiers/assign", {
            method: "POST",
            body: { profileIds: ids, rank }
          }).then((response) => {
            if (response?.overview) setOverview(response.overview);
            return response;
          });
        } catch (requestError) {
          setOverrides((current) => {
            const next = { ...current };
            for (const id of ids) {
              if (previous[id] === undefined) delete next[id];
              else next[id] = previous[id];
            }
            return next;
          });
          setError(requestError.message || "That tier change did not save.");
          throw requestError;
        }
      },
      assignByRole: async (role, rank) => {
        const response = await mutate("assign-role", "/tiers/assign-by-role", {
          method: "POST",
          body: { role, rank }
        });
        // A rule can touch rows that are not on screen, so this one does refetch.
        setOverrides({});
        reloadRoster();
        return response;
      }
    }),
    [mutate, reloadRoster, request, setError]
  );

  const items = useMemo(() => {
    const rows = Array.isArray(roster?.items) ? roster.items : [];
    if (!Object.keys(overrides).length) return rows;
    return rows.map((row) =>
      row.profileId in overrides ? { ...row, tierRank: overrides[row.profileId] } : row
    );
  }, [overrides, roster]);
  const total = Number(roster?.total || 0);

  return {
    available,
    overview,
    loading,
    error,
    setError,
    busy,
    actions,
    reloadOverview: loadOverview,
    roster: {
      items,
      total,
      page,
      setPage,
      pageSize: PAGE_SIZE,
      totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      roleOptions: roster?.roleOptions || [],
      loading: rosterLoading,
      filters,
      setFilters,
      resetFilters: () => setFilters(DEFAULT_ROSTER_FILTERS),
      reload: reloadRoster
    }
  };
}
