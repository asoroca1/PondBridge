import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Input, Select } from "@pondbridge/ui";
import { Search, UserRound } from "lucide-react";
import { tierOptionLabel } from "./tierNames.js";

function initials(person = {}) {
  const name = String(person.fullName || person.email || "?").trim();
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || "")
      .join("") || "?"
  );
}

/**
 * The tagging half of the workspace. Three things make a long roster tractable:
 * a rule that tags a whole camp role at once, an "untagged only" default with a
 * countdown, and number keys that assign without leaving the keyboard.
 */
export default function TierRosterView({ overview, roster, actions, busy }) {
  const { items, filters, setFilters, loading } = roster;
  const tiers = useMemo(() => overview?.tiers || [], [overview]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [ruleRole, setRuleRole] = useState("");
  const [ruleRank, setRuleRank] = useState("");
  const listRef = useRef(null);

  // A selection only means something for rows still on screen.
  useEffect(() => {
    setSelectedIds((ids) => ids.filter((id) => items.some((item) => item.profileId === id)));
  }, [items]);

  useEffect(() => {
    if (!ruleRole && roster.roleOptions.length) setRuleRole(roster.roleOptions[0].role);
  }, [roster.roleOptions, ruleRole]);

  useEffect(() => {
    if (!ruleRank && tiers.length) setRuleRank(String(tiers[0].rank));
  }, [ruleRank, tiers]);

  const taggedCount = Number(overview?.taggedCount || 0);
  const memberTotal = Number(overview?.memberTotal || 0);
  const percent = memberTotal ? Math.round((taggedCount / memberTotal) * 100) : 0;
  const ruleMatchCount = roster.roleOptions.find((option) => option.role === ruleRole)?.count || 0;

  const focusRow = useCallback((index) => {
    const rows = listRef.current?.querySelectorAll("[data-tier-row]");
    if (!rows?.length) return;
    const next = Math.max(0, Math.min(index, rows.length - 1));
    rows[next].focus();
  }, []);

  function assign(profileIds, rank) {
    if (!profileIds.length) return;
    // Fire and forget: the row repaints from local state straight away and the
    // hook reverts it if the write fails.
    actions.assign(profileIds, rank).catch(() => {});
    setSelectedIds((ids) => ids.filter((id) => !profileIds.includes(id)));
  }

  function toggleSelected(profileId) {
    setSelectedIds((ids) =>
      ids.includes(profileId) ? ids.filter((id) => id !== profileId) : [...ids, profileId]
    );
  }

  function handleRowKeyDown(event, person, index) {
    const digit = Number(event.key);
    if (Number.isFinite(digit) && digit >= 1 && digit <= tiers.length) {
      event.preventDefault();
      assign([person.profileId], digit);
      focusRow(index + 1);
      return;
    }
    if (event.key === " ") {
      event.preventDefault();
      toggleSelected(person.profileId);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusRow(index + 1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      focusRow(index - 1);
    }
  }

  const allOnPageSelected = items.length > 0 && items.every((item) => selectedIds.includes(item.profileId));

  return (
    <div className="pb-tiers-roster">
      <div className="pb-tiers-toolbar">
        <label className="pb-tiers-search">
          <Search aria-hidden="true" />
          <Input
            value={filters.q}
            onChange={(event) => setFilters((prev) => ({ ...prev, q: event.target.value }))}
            placeholder="Search people"
            aria-label="Search people"
          />
        </label>
        <Select
          value={filters.scope === "tier" ? `tier:${filters.rank}` : filters.scope}
          onChange={(event) => {
            const value = event.target.value;
            if (value.startsWith("tier:")) {
              setFilters((prev) => ({ ...prev, scope: "tier", rank: Number(value.slice(5)) }));
            } else {
              setFilters((prev) => ({ ...prev, scope: value, rank: 0 }));
            }
          }}
          aria-label="Which people to show"
        >
          <option value="untagged">Untagged only</option>
          <option value="all">Everyone</option>
          {tiers.map((tier) => (
            <option key={tier.id} value={`tier:${tier.rank}`}>
              {tierOptionLabel(tier)}
            </option>
          ))}
        </Select>
        <Button type="button" variant="ghost" size="sm" onClick={roster.resetFilters}>
          Reset
        </Button>
      </div>

      <div className="pb-tiers-progress">
        <div className="pb-tiers-progress-bar">
          <span style={{ width: `${percent}%` }} />
        </div>
        <span className="pb-tiers-progress-label">
          {taggedCount.toLocaleString()} of {memberTotal.toLocaleString()} tagged
        </span>
      </div>

      {roster.roleOptions.length && tiers.length ? (
        <div className="pb-tiers-rule">
          <span>Put everyone whose camp role is</span>
          <Select value={ruleRole} onChange={(event) => setRuleRole(event.target.value)} aria-label="Camp role to match">
            {roster.roleOptions.map((option) => (
              <option key={option.role} value={option.role}>
                {option.role} ({option.count})
              </option>
            ))}
          </Select>
          <span>in</span>
          <Select value={ruleRank} onChange={(event) => setRuleRank(event.target.value)} aria-label="Tier to assign">
            {tiers.map((tier) => (
              <option key={tier.id} value={String(tier.rank)}>
                {tierOptionLabel(tier)}
              </option>
            ))}
          </Select>
          <Button
            type="button"
            size="sm"
            loading={busy === "assign-role"}
            disabled={!ruleRole || !ruleRank}
            onClick={() => actions.assignByRole(ruleRole, Number(ruleRank))}
          >
            Apply to {ruleMatchCount}
          </Button>
        </div>
      ) : null}

      {selectedIds.length ? (
        <div className="pb-tiers-bulk">
          <strong>{selectedIds.length} selected</strong>
          <span>Move to:</span>
          <span className="pb-tiers-chips">
            {tiers.map((tier) => (
              <button
                key={tier.id}
                type="button"
                className="pb-tiers-chip"
                data-rank={tier.rank}
                onClick={() => assign(selectedIds, tier.rank)}
              >
                Tier {tier.rank}
              </button>
            ))}
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={() => assign(selectedIds, null)}>
            Clear tier
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedIds([])}>
            Deselect
          </Button>
        </div>
      ) : null}

      <div className="pb-tiers-list-head">
        <label className="pb-tiers-select-all">
          <input
            type="checkbox"
            checked={allOnPageSelected}
            disabled={!items.length}
            onChange={(event) =>
              setSelectedIds(event.target.checked ? items.map((item) => item.profileId) : [])
            }
          />
          Select page
        </label>
        <span>
          {roster.total.toLocaleString()} {roster.total === 1 ? "person" : "people"}
        </span>
      </div>

      <ul className="pb-tiers-rows" ref={listRef}>
        {loading ? (
          <li className="pb-tiers-placeholder">Loading…</li>
        ) : !items.length ? (
          <li className="pb-tiers-empty">
            <UserRound aria-hidden="true" />
            <strong>
              {filters.scope === "untagged" ? "Everyone has a tier." : "Nobody matches that."}
            </strong>
            <span>
              {filters.scope === "untagged"
                ? "Switch to Everyone to review or change what you have already tagged."
                : "Try a different search or filter."}
            </span>
          </li>
        ) : (
          items.map((person, index) => (
            <li key={person.profileId}>
              <div
                className="pb-tiers-row"
                data-tier-row
                tabIndex={0}
                onKeyDown={(event) => handleRowKeyDown(event, person, index)}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.includes(person.profileId)}
                  onChange={() => toggleSelected(person.profileId)}
                  aria-label={`Select ${person.fullName || person.email}`}
                />
                <span className="pb-tiers-avatar" aria-hidden="true">
                  {person.avatarUrl ? <img src={person.avatarUrl} alt="" /> : initials(person)}
                </span>
                <span className="pb-tiers-who">
                  <strong>
                    {person.fullName || person.email || "Unknown person"}
                    {person.tierRank === null ? (
                      <em className="pb-tiers-untagged-mark">untagged</em>
                    ) : (
                      <em className="pb-tiers-tagged-mark">Tier {person.tierRank}</em>
                    )}
                  </strong>
                  <small>
                    {[person.role, person.location].filter(Boolean).join(" · ") || person.email}
                  </small>
                </span>
                <span className="pb-tiers-chips">
                  {tiers.map((tier) => (
                    <button
                      key={tier.id}
                      type="button"
                      className="pb-tiers-chip"
                      data-rank={tier.rank}
                      aria-pressed={person.tierRank === tier.rank}
                      title={`Tier ${tier.rank}${tier.label ? ` · ${tier.label}` : ""}`}
                      aria-label={`Tier ${tier.rank} for ${person.fullName || person.email}`}
                      onClick={() =>
                        assign([person.profileId], person.tierRank === tier.rank ? null : tier.rank)
                      }
                    >
                      {tier.rank}
                    </button>
                  ))}
                </span>
              </div>
            </li>
          ))
        )}
      </ul>

      {roster.totalPages > 1 ? (
        <div className="pb-tiers-pagination">
          <Button
            variant="secondary"
            size="sm"
            disabled={roster.page <= 1 || loading}
            onClick={() => roster.setPage(roster.page - 1)}
          >
            Previous
          </Button>
          <span className="muted">
            Page {roster.page} of {roster.totalPages}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={roster.page >= roster.totalPages || loading}
            onClick={() => roster.setPage(roster.page + 1)}
          >
            Next
          </Button>
        </div>
      ) : null}

      <p className="pb-tiers-hint">
        Saves as you click. With a row focused, press <kbd>1</kbd>–<kbd>{tiers.length || 1}</kbd> to
        assign, <kbd>Space</kbd> to select, and the arrow keys to move.
      </p>
    </div>
  );
}
