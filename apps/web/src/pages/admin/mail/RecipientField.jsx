import { useEffect, useMemo, useRef, useState } from "react";
import { Users, X } from "lucide-react";
import {
  DEFAULT_STAFF_ROLES,
  GROWTH_SEGMENT_OPTIONS,
  everyoneChip,
  generateYearRange,
  groupChip,
  industryChip,
  personChip,
  roleChip,
  segmentChip,
  yearChip
} from "./mailAudience.js";

const KIND_LABEL = {
  all: "Everyone",
  group: "Group",
  role: "Role",
  year: "Class year",
  industry: "Industry",
  segment: "Engagement",
  person: "Member"
};

function matches(text = "", query = "") {
  return String(text || "").toLowerCase().includes(query);
}

/**
 * A single "To" line that accepts saved groups, roles, class years, engagement
 * segments and individual members — the way a mail client's address field
 * accepts both contacts and distribution lists.
 */
export default function RecipientField({
  chips = [],
  onChange,
  request,
  savedGroups = [],
  availableRoles = DEFAULT_STAFF_ROLES,
  availableIndustries = [],
  recipientCount = 0,
  countLoading = false
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [memberResults, setMemberResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  const selectedKeys = useMemo(() => new Set(chips.map((chip) => chip.key)), [chips]);
  const trimmedQuery = query.trim().toLowerCase();

  // Member lookup only runs once the query is specific enough to be useful.
  useEffect(() => {
    if (!open || trimmedQuery.length < 2) {
      setMemberResults([]);
      setSearching(false);
      return undefined;
    }
    let active = true;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          page: "1",
          pageSize: "8",
          q: trimmedQuery,
          role: "all",
          year: "all",
          status: "all",
          completion: "all",
          sort: "name_asc"
        });
        const payload = await request(`/members?${params.toString()}`);
        if (!active) return;
        setMemberResults(Array.isArray(payload?.items) ? payload.items : []);
      } catch {
        if (active) setMemberResults([]);
      } finally {
        if (active) setSearching(false);
      }
    }, 200);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [open, request, trimmedQuery]);

  useEffect(() => {
    function handlePointerDown(event) {
      if (!wrapRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const suggestions = useMemo(() => {
    const items = [];
    const push = (chip) => {
      if (!chip?.key || selectedKeys.has(chip.key)) return;
      items.push(chip);
    };

    for (const group of savedGroups) {
      if (!trimmedQuery || matches(group.name, trimmedQuery) || matches(group.description, trimmedQuery)) {
        push(groupChip(group));
      }
    }
    if (!trimmedQuery || matches("all members everyone", trimmedQuery)) push(everyoneChip());
    for (const role of availableRoles) {
      if (!trimmedQuery || matches(role, trimmedQuery)) push(roleChip(role));
    }
    for (const industry of availableIndustries) {
      if (!trimmedQuery || matches(industry, trimmedQuery)) push(industryChip(industry));
    }
    if (trimmedQuery) {
      for (const year of generateYearRange()) {
        if (matches(`class of ${year}`, trimmedQuery) || year.includes(trimmedQuery)) push(yearChip(year));
      }
    }
    for (const option of GROWTH_SEGMENT_OPTIONS) {
      if (!trimmedQuery || matches(option.label, trimmedQuery)) push(segmentChip(option.value));
    }
    for (const member of memberResults) {
      push(personChip(member));
    }
    return items.slice(0, 12);
  }, [availableIndustries, availableRoles, memberResults, savedGroups, selectedKeys, trimmedQuery]);

  useEffect(() => {
    setActiveIndex(0);
  }, [trimmedQuery, suggestions.length]);

  function addChip(chip) {
    if (!chip || selectedKeys.has(chip.key)) return;
    onChange([...chips, chip]);
    setQuery("");
    setOpen(true);
    inputRef.current?.focus();
  }

  function removeChip(key) {
    onChange(chips.filter((chip) => chip.key !== key));
  }

  function handleKeyDown(event) {
    if (event.key === "Backspace" && !query && chips.length) {
      event.preventDefault();
      removeChip(chips[chips.length - 1].key);
      return;
    }
    if (!open && (event.key === "ArrowDown" || event.key === "Enter")) {
      setOpen(true);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, suggestions.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" || event.key === "Tab") {
      const candidate = suggestions[activeIndex];
      if (candidate) {
        event.preventDefault();
        addChip(candidate);
      }
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="pb-mail-recipients" ref={wrapRef}>
      <span className="pb-mail-recipients-label" id="pb-mail-to-label">To</span>
      <div
        className={`pb-mail-recipients-field ${open ? "is-open" : ""}`}
        onClick={() => {
          setOpen(true);
          inputRef.current?.focus();
        }}
        role="presentation"
      >
        {chips.map((chip) => (
          <span key={chip.key} className={`pb-mail-chip is-${chip.kind}`}>
            <span className="pb-mail-chip-label">{chip.label}</span>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                removeChip(chip.key);
              }}
              aria-label={`Remove ${chip.label}`}
            >
              <X aria-hidden="true" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="pb-mail-recipients-input"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={chips.length ? "" : "Add a group, role, class year, industry, or member…"}
          aria-labelledby="pb-mail-to-label"
          aria-expanded={open}
          aria-autocomplete="list"
          role="combobox"
          aria-controls="pb-mail-recipient-suggestions"
        />
        <span className="pb-mail-recipients-count" title="Eligible recipients after email preferences">
          <Users aria-hidden="true" />
          {countLoading ? "…" : recipientCount.toLocaleString()}
        </span>
      </div>

      {open ? (
        <ul className="pb-mail-suggestions" id="pb-mail-recipient-suggestions" role="listbox">
          {suggestions.length === 0 ? (
            <li className="pb-mail-suggestion-empty">
              {searching ? "Searching members…" : trimmedQuery ? "No matches." : "Start typing to search."}
            </li>
          ) : (
            suggestions.map((chip, index) => (
              <li key={chip.key}>
                <button
                  type="button"
                  className={index === activeIndex ? "is-active" : ""}
                  role="option"
                  aria-selected={index === activeIndex}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => addChip(chip)}
                >
                  <span className="pb-mail-suggestion-main">
                    <strong>{chip.label}</strong>
                    {chip.detail ? <small>{chip.detail}</small> : null}
                  </span>
                  <span className={`pb-mail-suggestion-kind is-${chip.kind}`}>{KIND_LABEL[chip.kind]}</span>
                </button>
              </li>
            ))
          )}
          {searching && suggestions.length ? (
            <li className="pb-mail-suggestion-empty">Searching members…</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
