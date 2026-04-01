import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useTenant } from "../../context/TenantContext.jsx";
import { resolveAlumniWord } from "../../lib/campLabels.js";
import InitialsMark from "../../components/InitialsMark.jsx";
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

const REL_TYPE_LABEL = new Map(REL_TYPES.map((x) => [x.value, x.label]));

const PARENT_OF_TYPES = new Set(["parent_of", "father_of", "mother_of"]);
const CHILD_OF_TYPES = new Set(["child_of", "son_of", "daughter_of"]);
const SIBLING_TYPES = new Set(["sibling_of", "brother_of", "sister_of"]);
const SPOUSE_TYPES = new Set(["spouse_of", "partner_of"]);

function readCurrentUserId() {
  try {
    const raw = JSON.parse(localStorage.getItem("user") || "null");
    return String(raw?._id || raw?.id || "").trim();
  } catch {
    return "";
  }
}

function normalizeMember(raw = {}) {
  const id = String(raw.profileId || raw.id || raw._id || "").trim();
  const firstName = raw.firstName || "";
  const lastName = raw.lastName || "";
  const nickname = raw.nickname || "";
  const photoUrl = avatarUrl(raw);
  const currentJob = raw.currentJob || "";
  return { id, firstName, lastName, nickname, photoUrl, currentJob };
}

function normalizeEdge(raw = {}) {
  return {
    rowId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    fromProfileId: String(raw.fromProfileId || raw.from || "").trim(),
    toProfileId: String(raw.toProfileId || raw.to || "").trim(),
    type: String(raw.type || "").trim(),
  };
}

function makeEdgeRow(a = "", b = "") {
  return {
    rowId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    fromProfileId: a,
    type: "sibling_of",
    toProfileId: b,
  };
}

function MemberAvatar({ member = {}, className = "", fallbackClassName = "" }) {
  const [errored, setErrored] = useState(false);
  const src = String(member.photoUrl || "").trim();

  useEffect(() => {
    setErrored(false);
  }, [src]);

  if (src && !errored) {
    return <img src={src} alt={displayName(member)} className={className} onError={() => setErrored(true)} />;
  }

  return (
    <div className={`${className} ${fallbackClassName}`.trim()} aria-hidden="true">
      <InitialsMark value={initialsOf(member.firstName, member.lastName, member.nickname) || "?"} />
    </div>
  );
}

function pairKey(a, b) {
  return [String(a), String(b)].sort().join("::");
}

function buildTreeLayout(members = [], edges = []) {
  const ids = members.map((m) => m.id).filter(Boolean);
  const idSet = new Set(ids);
  const lowerNameById = new Map(members.map((m) => [m.id, displayName(m).toLowerCase()]));

  const parentChild = [];
  const siblings = [];
  const spouses = [];
  const cousins = [];

  const seenParentChild = new Set();
  const seenSibling = new Set();
  const seenSpouse = new Set();
  const seenCousin = new Set();

  function addParentChild(parentId, childId, type) {
    if (!idSet.has(parentId) || !idSet.has(childId)) return;
    if (parentId === childId) return;
    const key = `${parentId}->${childId}`;
    if (seenParentChild.has(key)) return;
    seenParentChild.add(key);
    parentChild.push({ fromProfileId: parentId, toProfileId: childId, type });
  }

  function addPair(target, seen, a, b, type) {
    if (!idSet.has(a) || !idSet.has(b)) return;
    if (a === b) return;
    const key = pairKey(a, b);
    if (seen.has(key)) return;
    seen.add(key);
    target.push({ a, b, type });
  }

  for (const edge of edges || []) {
    const from = String(edge.fromProfileId || "").trim();
    const to = String(edge.toProfileId || "").trim();
    const type = String(edge.type || "").trim();
    if (!from || !to || !type) continue;

    if (PARENT_OF_TYPES.has(type)) {
      addParentChild(from, to, type);
    } else if (CHILD_OF_TYPES.has(type)) {
      addParentChild(to, from, type);
    } else if (SIBLING_TYPES.has(type)) {
      addPair(siblings, seenSibling, from, to, type);
    } else if (SPOUSE_TYPES.has(type)) {
      addPair(spouses, seenSpouse, from, to, type);
    } else if (type === "cousin_of") {
      addPair(cousins, seenCousin, from, to, type);
    }
  }

  const childrenByParent = new Map(ids.map((id) => [id, []]));
  const parentsByChild = new Map(ids.map((id) => [id, []]));
  const inDegree = new Map(ids.map((id) => [id, 0]));

  for (const edge of parentChild) {
    childrenByParent.get(edge.fromProfileId)?.push(edge.toProfileId);
    parentsByChild.get(edge.toProfileId)?.push(edge.fromProfileId);
    inDegree.set(edge.toProfileId, (inDegree.get(edge.toProfileId) || 0) + 1);
  }

  const byName = (a, b) =>
    String(lowerNameById.get(a) || "").localeCompare(String(lowerNameById.get(b) || ""), undefined, {
      sensitivity: "base",
      numeric: true,
    });

  const roots = ids.filter((id) => (inDegree.get(id) || 0) === 0).sort(byName);
  const queue = roots.length ? [...roots] : [...ids].sort(byName);
  const levelById = new Map(queue.map((id) => [id, 0]));
  const degreeWork = new Map(inDegree);

  for (let idx = 0; idx < queue.length; idx += 1) {
    const nodeId = queue[idx];
    const level = levelById.get(nodeId) || 0;
    for (const childId of childrenByParent.get(nodeId) || []) {
      levelById.set(childId, Math.max(levelById.get(childId) || 0, level + 1));
      const next = (degreeWork.get(childId) || 0) - 1;
      degreeWork.set(childId, next);
      if (next === 0) queue.push(childId);
    }
  }

  for (const id of ids) {
    if (!levelById.has(id)) levelById.set(id, 0);
  }

  const maxLevel = Math.max(...Array.from(levelById.values()), 0);
  const levels = Array.from({ length: maxLevel + 1 }, () => []);

  for (const id of ids) {
    const level = levelById.get(id) || 0;
    levels[level].push(id);
  }

  function firstParentName(id) {
    const parents = parentsByChild.get(id) || [];
    if (!parents.length) return "";
    const sortedParents = [...parents].sort(byName);
    return String(lowerNameById.get(sortedParents[0]) || "");
  }

  levels.forEach((row, rowIdx) => {
    row.sort((a, b) => {
      if (rowIdx > 0) {
        const aParent = firstParentName(a);
        const bParent = firstParentName(b);
        if (aParent !== bParent) return aParent.localeCompare(bParent);
      }
      return byName(a, b);
    });
  });

  return { levels, parentChild, siblings, spouses, cousins };
}

export default function FamilyTreeView() {
  const { tenant } = useTenant();
  const alumniWordTitle = resolveAlumniWord(tenant, { capitalized: true });
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const currentUserId = useMemo(() => readCurrentUserId(), []);
  const wantsEdit = searchParams.get("edit") === "1";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tree, setTree] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef(null);

  const [draft, setDraft] = useState({
    name: "",
    members: [],
    edges: [],
  });

  const treeBoardRef = useRef(null);
  const nodeRefs = useRef(new Map());
  const [lineModel, setLineModel] = useState({
    width: 1,
    height: 1,
    parent: [],
    sibling: [],
    spouse: [],
    cousin: [],
  });

  async function loadTree() {
    setLoading(true);
    setError("");
    try {
      const res = await requestFamilyTrees({
        method: "GET",
        path: id,
        token: getToken(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Failed to load tree (${res.status})`);

      const members = (Array.isArray(data.members) ? data.members : []).map(normalizeMember);
      const edges = (Array.isArray(data.edges) ? data.edges : []).map(normalizeEdge);
      const payload = {
        id: String(data.id || data._id || id),
        name: data.name || "",
        createdBy: String(data.createdBy || ""),
        members,
        edges,
        permissions:
          data.permissions ||
          { canEdit: false, canDelete: false, isCreator: false, isMember: false, isMine: false },
      };

      setTree(payload);
      setDraft({ name: payload.name, members: payload.members, edges: payload.edges });
      setIsEditing(Boolean(wantsEdit && payload.permissions?.canEdit));
    } catch (err) {
      setError(err?.message || "Unable to load family tree.");
      setTree(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTree();
  }, [id]);

  useEffect(() => () => window.clearTimeout(debounceRef.current), []);

  const activeMembers = isEditing ? draft.members : tree?.members || [];
  const activeEdges = isEditing ? draft.edges : tree?.edges || [];

  const memberMap = useMemo(() => {
    const map = new Map();
    activeMembers.forEach((m) => map.set(m.id, m));
    return map;
  }, [activeMembers]);

  const treeLayout = useMemo(
    () => buildTreeLayout(activeMembers, activeEdges),
    [activeMembers, activeEdges]
  );

  const sideRelationships = useMemo(
    () => [
      ...treeLayout.spouses.map((x) => ({ ...x, bucket: "Spouse / Partner" })),
      ...treeLayout.siblings.map((x) => ({ ...x, bucket: "Siblings" })),
      ...treeLayout.cousins.map((x) => ({ ...x, bucket: "Cousins" })),
    ],
    [treeLayout]
  );

  useEffect(() => {
    if (isEditing) return;

    function computeLines() {
      const board = treeBoardRef.current;
      if (!board) return;
      const boardRect = board.getBoundingClientRect();

      function anchorOf(nodeId, where) {
        const el = nodeRefs.current.get(nodeId);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const xCenter = r.left - boardRect.left + r.width / 2;
        const yTop = r.top - boardRect.top;
        const yBottom = r.bottom - boardRect.top;
        const yCenter = yTop + r.height / 2;

        if (where === "top") return { x: xCenter, y: yTop };
        if (where === "bottom") return { x: xCenter, y: yBottom };
        return { x: xCenter, y: yCenter };
      }

      const parentPaths = [];
      const siblingPaths = [];
      const spousePaths = [];
      const cousinPaths = [];

      for (const edge of treeLayout.parentChild) {
        const from = anchorOf(edge.fromProfileId, "bottom");
        const to = anchorOf(edge.toProfileId, "top");
        if (!from || !to) continue;

        const bendY = from.y + Math.max(18, (to.y - from.y) / 2);
        parentPaths.push(`M ${from.x} ${from.y} V ${bendY} H ${to.x} V ${to.y}`);
      }

      function addPairPaths(target, pairs) {
        for (const edge of pairs) {
          const a = anchorOf(edge.a, "center");
          const b = anchorOf(edge.b, "center");
          if (!a || !b) continue;
          target.push(`M ${a.x} ${a.y} L ${b.x} ${b.y}`);
        }
      }

      addPairPaths(siblingPaths, treeLayout.siblings);
      addPairPaths(spousePaths, treeLayout.spouses);
      addPairPaths(cousinPaths, treeLayout.cousins);

      setLineModel({
        width: Math.max(1, board.clientWidth),
        height: Math.max(1, board.clientHeight),
        parent: parentPaths,
        sibling: siblingPaths,
        spouse: spousePaths,
        cousin: cousinPaths,
      });
    }

    let raf = 0;
    const schedule = () => {
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(computeLines);
    };

    schedule();
    window.addEventListener("resize", schedule);

    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    if (ro && treeBoardRef.current) ro.observe(treeBoardRef.current);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", schedule);
      ro?.disconnect();
    };
  }, [isEditing, treeLayout]);

  function bindNodeRef(nodeId) {
    return (el) => {
      if (el) nodeRefs.current.set(nodeId, el);
      else nodeRefs.current.delete(nodeId);
    };
  }

  function startEditing() {
    if (!tree?.permissions?.canEdit) return;
    setDraft({ name: tree.name, members: tree.members, edges: tree.edges });
    setIsEditing(true);
    setError("");
  }

  function cancelEditing() {
    if (!tree) return;
    setDraft({ name: tree.name, members: tree.members, edges: tree.edges });
    setIsEditing(false);
    setError("");
  }

  function addMember(person) {
    const member = normalizeMember(person);
    if (!member.id) return;
    setDraft((prev) => {
      if (prev.members.some((m) => m.id === member.id)) return prev;
      return { ...prev, members: [...prev.members, member] };
    });
  }

  function removeMember(memberId) {
    const involved = draft.edges.filter(
      (edge) => edge.fromProfileId === memberId || edge.toProfileId === memberId
    ).length;
    if (
      involved > 0 &&
      !window.confirm("Removing this member will also remove related edges. Continue?")
    ) {
      return;
    }
    setDraft((prev) => ({
      ...prev,
      members: prev.members.filter((m) => m.id !== memberId),
      edges: prev.edges.filter(
        (edge) => edge.fromProfileId !== memberId && edge.toProfileId !== memberId
      ),
    }));
  }

  function addEdgeRow() {
    if (draft.members.length < 2) return;
    setDraft((prev) => ({
      ...prev,
      edges: [...prev.edges, makeEdgeRow(prev.members[0].id, prev.members[1].id)],
    }));
  }

  function updateEdge(rowId, key, value) {
    setDraft((prev) => ({
      ...prev,
      edges: prev.edges.map((edge) => (edge.rowId === rowId ? { ...edge, [key]: value } : edge)),
    }));
  }

  function removeEdge(rowId) {
    setDraft((prev) => ({ ...prev, edges: prev.edges.filter((edge) => edge.rowId !== rowId) }));
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
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const rows = Array.isArray(data?.items) ? data.items : [];
      setResults(rows.map(normalizeMember));
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

  async function onSave() {
    setError("");
    const trimmedName = String(draft.name || "").trim();
    const memberProfileIds = [...new Set(draft.members.map((m) => m.id).filter(Boolean))];

    if (!trimmedName) return setError("Family tree name is required.");
    if (memberProfileIds.length < 2) return setError("At least 2 members are required.");

    const edges = draft.edges
      .map((edge) => ({
        fromProfileId: String(edge.fromProfileId || "").trim(),
        toProfileId: String(edge.toProfileId || "").trim(),
        type: String(edge.type || "").trim(),
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

    if (edges.length < 1) return setError("At least 1 valid relationship edge is required.");

    setSaving(true);
    try {
      const res = await requestFamilyTrees({
        method: "PUT",
        path: id,
        token: getToken(),
        body: {
          name: trimmedName,
          memberProfileIds,
          edges,
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Failed to update tree (${res.status})`);
      }
      await loadTree();
      setIsEditing(false);
    } catch (err) {
      setError(err?.message || "Unable to update family tree.");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!tree?.permissions?.canDelete) return;
    if (!window.confirm("Delete this family tree? This cannot be undone.")) return;

    setSaving(true);
    try {
      const res = await requestFamilyTrees({
        method: "DELETE",
        path: id,
        token: getToken(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Delete failed (${res.status})`);
      navigate("/family-trees");
    } catch (err) {
      setError(err?.message || "Unable to delete family tree.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <CedarBackground behavior="fixed" opacity={0.9} zIndex={0} />
      <main className="ft-main nav2-page-shell">
        {loading && <div className="ft-status">Loading family tree…</div>}
        {!loading && error && !tree && <div className="ft-status ft-error">{error}</div>}

        {!loading && tree && (
          <>
            <header className="ft-simple-head">
              <div>
                <h1 className="ft-title">{isEditing ? "Edit Family Tree" : tree.name}</h1>
                <p className="ft-sub">
                  {activeMembers.length} member{activeMembers.length === 1 ? "" : "s"}
                </p>
              </div>
              <div className="ft-head-actions">
                <Link className="ft-head-btn" to="/family-trees">
                  Back
                </Link>
                {!isEditing && tree.permissions?.canEdit && (
                  <button className="ft-head-btn is-primary" type="button" onClick={startEditing}>
                    Edit Tree
                  </button>
                )}
                {isEditing && (
                  <>
                    <button className="ft-head-btn" type="button" onClick={cancelEditing}>
                      Cancel
                    </button>
                    <button className="ft-head-btn is-primary" type="button" onClick={onSave} disabled={saving}>
                      {saving ? "Saving…" : "Save Changes"}
                    </button>
                  </>
                )}
                {!isEditing && tree.permissions?.canDelete && (
                  <button className="ft-head-btn" type="button" onClick={onDelete} disabled={saving}>
                    Delete
                  </button>
                )}
              </div>
            </header>

            {!isEditing && (
              <section className="ft-form-card ft-tree-card-wrap">
                <div className="ft-tree-head">
                  <h2 className="ft-form-title">Family Tree</h2>
                  <div className="ft-tree-legend">
                    <span><i className="ft-leg ft-leg-parent" /> Parent/Child</span>
                    <span><i className="ft-leg ft-leg-spouse" /> Spouse/Partner</span>
                    <span><i className="ft-leg ft-leg-sibling" /> Sibling</span>
                    <span><i className="ft-leg ft-leg-cousin" /> Cousin</span>
                  </div>
                </div>

                <div className="ft-tree-board" ref={treeBoardRef}>
                  <svg
                    className="ft-tree-lines"
                    viewBox={`0 0 ${lineModel.width} ${lineModel.height}`}
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    {lineModel.parent.map((d, idx) => (
                      <path key={`p-${idx}`} d={d} className="ft-line-parent" />
                    ))}
                    {lineModel.spouse.map((d, idx) => (
                      <path key={`sp-${idx}`} d={d} className="ft-line-spouse" />
                    ))}
                    {lineModel.sibling.map((d, idx) => (
                      <path key={`s-${idx}`} d={d} className="ft-line-sibling" />
                    ))}
                    {lineModel.cousin.map((d, idx) => (
                      <path key={`c-${idx}`} d={d} className="ft-line-cousin" />
                    ))}
                  </svg>

                  <div className="ft-tree-rows">
                    {treeLayout.levels.length === 0 && (
                      <div className="ft-members-empty">No members in this tree yet.</div>
                    )}

                    {treeLayout.levels.map((row, rowIdx) => (
                      <div className="ft-tree-row" key={`row-${rowIdx}`}>
                        {row.map((memberId) => {
                          const member = memberMap.get(memberId);
                          if (!member) return null;

                          return (
                            <Link
                              key={memberId}
                              ref={bindNodeRef(memberId)}
                              to={`/profile/${memberId}`}
                              aria-label={`Open ${displayName(member)} profile`}
                              className={`ft-tree-node ${memberId === currentUserId ? "is-you" : ""}`}
                            >
                              <MemberAvatar
                                member={member}
                                className="ft-tree-node-avatar"
                                fallbackClassName="ft-tree-node-avatar-fallback"
                              />
                              <div className="ft-tree-node-main">
                                <div className="ft-tree-node-name">{displayName(member)}</div>
                              </div>
                            </Link>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>

                {sideRelationships.length > 0 && (
                  <div className="ft-tree-rel-summary">
                    {sideRelationships.map((rel, idx) => {
                      const a = memberMap.get(rel.a);
                      const b = memberMap.get(rel.b);
                      if (!a || !b) return null;
                      const label = REL_TYPE_LABEL.get(rel.type) || rel.bucket;

                      return (
                        <div key={`rel-${idx}`} className="ft-tree-rel-chip">
                          <span>{displayName(a)}</span>
                          <strong>{label}</strong>
                          <span>{displayName(b)}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            )}

            {isEditing && (
              <section className="ft-form">
                <section className="ft-form-card">
                  <h2 className="ft-form-title">Tree Name</h2>
                  <input
                    className="ft-input"
                    value={draft.name}
                    onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
                  />
                </section>

                <section className="ft-form-card">
                  <h2 className="ft-form-title">Add Members</h2>
                  <label className="ft-field">
                    <span className="ft-label">{`Search ${alumniWordTitle} Profiles`}</span>
                    <input
                      className="ft-input"
                      value={query}
                      onChange={(e) => onSearchInput(e.target.value)}
                      placeholder="Search names…"
                    />
                  </label>

                  <ul className="ft-search-results">
                    {searching && <li className="ft-result muted">Searching…</li>}
                    {!searching &&
                      results.map((person) => {
                        const selected = draft.members.some((m) => m.id === person.id);
                        return (
                          <li key={person.id} className={`ft-result ${selected ? "is-selected" : ""}`}>
                            <MemberAvatar
                              member={person}
                              className="ft-result-avatar"
                              fallbackClassName="ft-result-avatar-fallback"
                            />
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
                    <div className="ft-members-head">Members ({draft.members.length})</div>
                    <ul className="ft-members-list">
                      {draft.members.map((member) => (
                        <li key={member.id} className="ft-member-chip">
                          <span>{displayName(member)}</span>
                          <button
                            type="button"
                            className="ft-chip-x"
                            onClick={() => removeMember(member.id)}
                            aria-label={`Remove ${displayName(member)}`}
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                </section>

                <section className="ft-form-card">
                  <div className="ft-rel-head">
                    <h2 className="ft-form-title">Relationship Edges</h2>
                    <button className="btn-ghost ft-inline-btn" type="button" onClick={addEdgeRow}>
                      Add Relationship
                    </button>
                  </div>

                  {draft.edges.length === 0 && (
                    <div className="ft-members-empty">No edges yet. Add at least one relationship.</div>
                  )}

                  <div className="ft-edge-list">
                    {draft.edges.map((edge) => (
                      <div key={edge.rowId} className="ft-edge-row">
                        <select
                          className="ft-input"
                          value={edge.fromProfileId}
                          onChange={(e) => updateEdge(edge.rowId, "fromProfileId", e.target.value)}
                        >
                          <option value="">Person A</option>
                          {draft.members.map((m) => (
                            <option key={m.id} value={m.id}>
                              {displayName(m)}
                            </option>
                          ))}
                        </select>

                        <select
                          className="ft-input"
                          value={edge.type}
                          onChange={(e) => updateEdge(edge.rowId, "type", e.target.value)}
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
                          onChange={(e) => updateEdge(edge.rowId, "toProfileId", e.target.value)}
                        >
                          <option value="">Person B</option>
                          {draft.members.map((m) => (
                            <option key={m.id} value={m.id}>
                              {displayName(m)}
                            </option>
                          ))}
                        </select>

                        <button
                          className="btn-ghost ft-inline-btn"
                          type="button"
                          onClick={() => removeEdge(edge.rowId)}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              </section>
            )}

            {error && <div className="ft-status ft-error">{error}</div>}
          </>
        )}
      </main>
    </>
  );
}
