import { useEffect, useState } from "react";
import { Input } from "@pondbridge/ui";

/**
 * Type-ahead over the network's members. Used anywhere a director needs to
 * point at a real person — presenters today, and whatever comes next.
 */
export default function MemberPicker({
  request,
  placeholder = "Search members by name or email",
  excludeIds = [],
  disabled = false,
  onSelect
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const needle = query.trim();
    if (needle.length < 2) {
      setResults([]);
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
          q: needle,
          role: "all",
          year: "all",
          status: "active",
          completion: "all",
          sort: "name_asc"
        });
        const payload = await request(`/members?${params.toString()}`);
        if (active) setResults(Array.isArray(payload?.items) ? payload.items : []);
      } catch {
        if (active) setResults([]);
      } finally {
        if (active) setSearching(false);
      }
    }, 220);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query, request]);

  const excluded = new Set((excludeIds || []).map((id) => String(id || "")));
  const visible = results.filter((member) => !excluded.has(String(member?.id || "")));

  return (
    <div className="pb-events-member-picker">
      <Input
        value={query}
        disabled={disabled}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={placeholder}
      />
      {query.trim().length >= 2 && !searching && !visible.length ? (
        <p className="pb-events-picker-empty">No members match “{query.trim()}”.</p>
      ) : null}
      {visible.length ? (
        <ul className="pb-events-host-results">
          {visible.map((member) => (
            <li key={member.id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  onSelect?.(member);
                  setQuery("");
                  setResults([]);
                }}
              >
                <strong>{member.fullName || "Member"}</strong>
                <small>{member.email}</small>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
