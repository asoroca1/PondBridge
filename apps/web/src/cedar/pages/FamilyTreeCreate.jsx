import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTenant } from "../../context/TenantContext.jsx";
import { resolveAlumniWord } from "../../lib/campLabels.js";
import CedarBackground from "../components/CedarBackground";
import { API_BASE } from "../lib/api";
import { requestFamilyTrees } from "../lib/familyTreesApi";
import { getToken, displayName, initialsOf, avatarUrl } from "../lib/helpers.js";
import "./family-trees.css";

const REL_TYPES = [
  { value: "parent_of", label: "Parent of" },
  { value: "father_of", label: "Father of" },
  { value: "mother_of", label: "Mother of" },
  { value: "child_of", label: "Child of" },
  { value: "son_of", label: "Son of" },
  { value: "daughter_of", label: "Daughter of" },
  { value: "sibling_of", label: "Sibling of" },
  { value: "brother_of", label: "Brother of" },
  { value: "sister_of", label: "Sister of" },
  { value: "spouse_of", label: "Spouse of" },
  { value: "partner_of", label: "Partner of" },
  { value: "cousin_of", label: "Cousin of" },
];

function readCurrentUser() {
  try {
    const raw = JSON.parse(localStorage.getItem("user") || "null");
    if (!raw) return null;
    const id = String(raw._id || raw.id || "").trim();
    if (!id) return null;
    return {
      id,
      firstName: raw.firstName || "",
      lastName: raw.lastName || "",
      nickname: raw.nickname || "",
      currentJob: (() => {
        const j = Array.isArray(raw.currentJobs) ? raw.currentJobs[0] : null;
        return j ? [j.role, j.company].filter(Boolean).join(" @ ") : "";
      })(),
      photoUrl: avatarUrl(raw),
      isCurrentUser: true,
    };
  } catch {
    return null;
  }
}

function normalizeSearchResult(item = {}) {
  const id = String(item.id || item._id || "").trim();
  const firstName = item.firstName || "";
  const lastName = item.lastName || "";
  const nickname = item.nickname || "";
  const currentJob = item.currentJob || "";
  const photoUrl = avatarUrl(item);
  return { id, firstName, lastName, nickname, currentJob, photoUrl };
}

function makeEdgeRow(a = "", b = "") {
  return {
    rowId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    fromProfileId: a,
    type: "sibling_of",
    toProfileId: b,
  };
}

function ResultAvatar({ person = {} }) {
  const [errored, setErrored] = useState(false);
  const src = String(person.photoUrl || "").trim();

  useEffect(() => {
    setErrored(false);
  }, [src]);

  if (src && !errored) {
    return <img src={src} alt={displayName(person)} className="ft-result-avatar" onError={() => setErrored(true)} />;
  }

  return (
    <div className="ft-result-avatar ft-result-avatar-fallback" aria-hidden="true">
      {initialsOf(person.firstName, person.lastName, person.nickname) || "?"}
    </div>
  );
}

export default function FamilyTreeCreate() {
  const navigate = useNavigate();
  const { tenant } = useTenant();
  const alumniWordTitle = resolveAlumniWord(tenant, { capitalized: true });
  const me = useMemo(() => readCurrentUser(), []);

  const [name, setName] = useState("");
  const [members, setMembers] = useState(() => (me ? [me] : []));
  const [edges, setEdges] = useState([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const debounceRef = useRef(null);

  useEffect(() => {
    if (!me?.id) return;
    setMembers((prev) => {
      if (prev.some((m) => m.id === me.id)) return prev;
      return [me, ...prev];
    });
  }, [me]);

  useEffect(() => () => window.clearTimeout(debounceRef.current), []);

  function addMember(person) {
    const normalized = normalizeSearchResult(person);
    if (!normalized.id) return;
    setMembers((prev) => (prev.some((m) => m.id === normalized.id) ? prev : [...prev, normalized]));
  }

  function removeMember(id) {
    setMembers((prev) => prev.filter((m) => m.id !== id));
    setEdges((prev) =>
      prev.filter((edge) => edge.fromProfileId !== id && edge.toProfileId !== id)
    );
  }

  function upsertEdge(rowId, key, value) {
    setEdges((prev) => prev.map((edge) => (edge.rowId === rowId ? { ...edge, [key]: value } : edge)));
  }

  function deleteEdge(rowId) {
    setEdges((prev) => prev.filter((edge) => edge.rowId !== rowId));
  }

  function addEdgeRow() {
    if (members.length < 2) return;
    const a = members[0]?.id || "";
    const b = members[1]?.id || "";
    setEdges((prev) => [...prev, makeEdgeRow(a, b)]);
  }

  async function runSearch(term) {
    if (!term) {
      setResults([]);
      return;
    }

    setSearching(true);
    try {
      const res = await fetch(
        `${API_BASE}/search/names?q=${encodeURIComponent(term)}&limit=12`,
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const rows = Array.isArray(data?.items) ? data.items : [];
      setResults(rows.map(normalizeSearchResult));
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  function onSearchInput(next) {
    setQuery(next);
    window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => runSearch(next.trim()), 220);
  }

  async function onSave(e) {
    e.preventDefault();
    setError("");

    const trimmedName = name.trim();
    const memberProfileIds = [...new Set([...(members || []).map((m) => m.id), me?.id].filter(Boolean))];

    if (!trimmedName) return setError("Family tree name is required.");
    if (memberProfileIds.length < 2) return setError("Add at least 2 members.");

    const normalizedEdges = edges
      .map((edge) => ({
        fromProfileId: String(edge.fromProfileId || ""),
        toProfileId: String(edge.toProfileId || ""),
        type: String(edge.type || ""),
      }))
      .filter(
        (edge) =>
          edge.fromProfileId &&
          edge.toProfileId &&
          edge.type &&
          edge.fromProfileId !== edge.toProfileId &&
          memberProfileIds.includes(edge.fromProfileId) &&
          memberProfileIds.includes(edge.toProfileId)
      );

    if (normalizedEdges.length < 1) {
      return setError("Add at least 1 valid relationship edge.");
    }

    setSubmitting(true);
    try {
      const res = await requestFamilyTrees({
        method: "POST",
        token: getToken(),
        body: {
          name: trimmedName,
          memberProfileIds,
          edges: normalizedEdges,
        },
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 404) {
          throw new Error("Family Trees API route not found on backend. Please restart/deploy backend.");
        }
        throw new Error(data?.error || `Failed to create tree (${res.status})`);
      }

      const id = String(data?.id || data?._id || "").trim();
      if (!id) throw new Error("Tree created, but no id was returned.");
      navigate(`/family-trees/${id}`);
    } catch (err) {
      setError(err?.message || "Unable to create family tree.");
    } finally {
      setSubmitting(false);
    }
  }

  const memberLookup = useMemo(() => {
    const map = new Map();
    members.forEach((m) => map.set(m.id, m));
    return map;
  }, [members]);

  return (
    <>
      <CedarBackground behavior="fixed" opacity={0.9} zIndex={0} />
      <main className="ft-main nav2-page-shell">
        <header className="ft-simple-head">
          <div>
            <h1 className="ft-title">Create Family Tree</h1>
            <p className="ft-sub">
              {`Name your tree, add ${alumniWordTitle.toLowerCase()} members, then define relationships.`}
            </p>
          </div>
          <Link className="btn-ghost" to="/family-trees">
            Back to Family Trees
          </Link>
        </header>

        <form className="ft-form" onSubmit={onSave}>
          <section className="ft-form-card">
            <h2 className="ft-form-title">A) Tree Info</h2>
            <label className="ft-field">
              <span className="ft-label">Family Tree Name</span>
              <input
                className="ft-input"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: The Goldberg Family"
                required
              />
            </label>
          </section>

          <section className="ft-form-card">
            <h2 className="ft-form-title">B) Add Members</h2>
            <label className="ft-field">
              <span className="ft-label">{`Search ${alumniWordTitle} Profiles`}</span>
              <input
                className="ft-input"
                type="text"
                value={query}
                onChange={(e) => onSearchInput(e.target.value)}
                placeholder="Search names…"
              />
            </label>
            <ul className="ft-search-results">
              {searching && <li className="ft-result muted">Searching…</li>}
              {!searching &&
                results.map((person) => {
                  const selected = memberLookup.has(person.id);
                  return (
                    <li key={person.id} className={`ft-result ${selected ? "is-selected" : ""}`}>
                      <ResultAvatar person={person} />
                      <div className="ft-result-main">
                        <div className="ft-result-name">{displayName(person)}</div>
                        {person.currentJob && <div className="ft-result-job">{person.currentJob}</div>}
                      </div>
                      <button
                        type="button"
                        className="btn-ghost ft-inline-btn"
                        onClick={() => addMember(person)}
                        disabled={selected}
                      >
                        {selected ? "Added" : "Add"}
                      </button>
                    </li>
                  );
                })}
            </ul>

            <div className="ft-members">
              <div className="ft-members-head">Members ({members.length})</div>
              {members.length === 0 ? (
                <div className="ft-members-empty">No members selected.</div>
              ) : (
                <ul className="ft-members-list">
                  {members.map((member) => {
                    const isCurrentUser = Boolean(me?.id && member.id === me.id);
                    return (
                      <li key={member.id} className="ft-member-chip">
                        <span>{displayName(member)}</span>
                        {isCurrentUser ? (
                          <span className="ft-you-chip">You</span>
                        ) : (
                          <button
                            type="button"
                            className="ft-chip-x"
                            onClick={() => removeMember(member.id)}
                            aria-label={`Remove ${displayName(member)}`}
                          >
                            ×
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>

          <section className="ft-form-card">
            <div className="ft-rel-head">
              <h2 className="ft-form-title">C) Define Relationships</h2>
              <button
                type="button"
                className="btn-ghost ft-inline-btn"
                onClick={addEdgeRow}
                disabled={members.length < 2}
              >
                Add Relationship
              </button>
            </div>

            {edges.length === 0 && (
              <div className="ft-members-empty">
                Add at least one relationship edge to build the tree.
              </div>
            )}

            <div className="ft-edge-list">
              {edges.map((edge) => (
                <div className="ft-edge-row" key={edge.rowId}>
                  <select
                    className="ft-input"
                    value={edge.fromProfileId}
                    onChange={(e) => upsertEdge(edge.rowId, "fromProfileId", e.target.value)}
                  >
                    <option value="">Person A</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {displayName(m)}
                      </option>
                    ))}
                  </select>

                  <select
                    className="ft-input"
                    value={edge.type}
                    onChange={(e) => upsertEdge(edge.rowId, "type", e.target.value)}
                  >
                    {REL_TYPES.map((rel) => (
                      <option key={rel.value} value={rel.value}>
                        {rel.label}
                      </option>
                    ))}
                  </select>

                  <select
                    className="ft-input"
                    value={edge.toProfileId}
                    onChange={(e) => upsertEdge(edge.rowId, "toProfileId", e.target.value)}
                  >
                    <option value="">Person B</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {displayName(m)}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    className="btn-ghost ft-inline-btn"
                    onClick={() => deleteEdge(edge.rowId)}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </section>

          {error && <div className="ft-status ft-error">{error}</div>}

          <div className="ft-form-actions">
            <button type="submit" className="btn-cedar" disabled={submitting}>
              {submitting ? "Saving…" : "Save Family Tree"}
            </button>
          </div>
        </form>
      </main>
    </>
  );
}
