import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Search, TreePine } from "lucide-react";
import CedarBackground from "../components/CedarBackground";
import CedarPageHeader from "../components/CedarPageHeader.jsx";
import { requestFamilyTrees } from "../lib/familyTreesApi";
import { getToken } from "../lib/helpers.js";
import "./family-trees.css";

function getCurrentUserId() {
  try {
    const user = JSON.parse(localStorage.getItem("user") || "null");
    return String(user?._id || user?.id || "").trim();
  } catch {
    return "";
  }
}

function toTree(raw = {}) {
  return {
    id: String(raw.id || raw._id || "").trim(),
    name: String(raw.name || "").trim(),
    memberCount: Number(raw.memberCount || 0),
    createdBy: String(raw.createdBy || "").trim(),
    canEdit: Boolean(raw.canEdit),
    isMine: Boolean(raw.isMine),
    createdAt: raw.createdAt || null,
  };
}

function alphaByName(a, b) {
  return (a.name || "").localeCompare(b.name || "", undefined, {
    sensitivity: "base",
    numeric: true,
  });
}

function FamilyTreeCard({ tree, isYour = false, onOpen }) {
  function handleOpen() {
    onOpen?.(tree.id, false);
  }

  function onCardKeyDown(e) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleOpen();
    }
  }

  return (
    <article
      className={`ft-card ${isYour ? "is-your" : ""}`}
      role="link"
      tabIndex={0}
      onClick={handleOpen}
      onKeyDown={onCardKeyDown}
      aria-label={`Open ${tree.name || "family tree"}`}
    >
      <div className="ft-card-head">
        <h2 className="ft-card-title">{isYour ? "Your Family Tree" : tree.name}</h2>
        {isYour && tree.name && <div className="ft-card-sub">{tree.name}</div>}
      </div>
      <div className="ft-card-meta">
        {tree.memberCount} member{tree.memberCount === 1 ? "" : "s"}
      </div>
      <div className="ft-card-actions">
        <button
          type="button"
          className="ft-card-btn ft-card-btn-primary"
          onClick={(e) => {
            e.stopPropagation();
            onOpen?.(tree.id, false);
          }}
        >
          View
        </button>
        {tree.canEdit && (
          <button
            type="button"
            className="ft-card-btn ft-card-btn-ghost"
            onClick={(e) => {
              e.stopPropagation();
              onOpen?.(tree.id, true);
            }}
          >
            Edit
          </button>
        )}
      </div>
    </article>
  );
}

export default function FamilyTrees() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [state, setState] = useState({
    loading: true,
    items: [],
    error: "",
  });

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 220);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let ignore = false;
    const q = debouncedSearch;
    const token = getToken();

    (async () => {
      try {
        setState((prev) => ({ ...prev, loading: true, error: "" }));
        const qs = new URLSearchParams();
        if (q) qs.set("q", q);
        const res = await requestFamilyTrees({
          method: "GET",
          token,
          query: qs,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (ignore) return;
        const rows = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
        setState({ loading: false, items: rows.map(toTree), error: "" });
      } catch (err) {
        if (ignore) return;
        setState({ loading: false, items: [], error: "Unable to load family trees." });
      }
    })();

    return () => {
      ignore = true;
    };
  }, [debouncedSearch]);

  const currentUserId = getCurrentUserId();
  const openTree = (treeId, edit = false) => {
    if (!treeId) return;
    navigate(edit ? `/family-trees/${treeId}?edit=1` : `/family-trees/${treeId}`);
  };

  const view = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = (state.items || []).filter((tree) =>
      q ? String(tree.name || "").toLowerCase().includes(q) : true
    );

    const yourTree =
      filtered.find((tree) => currentUserId && tree.createdBy === currentUserId) ||
      filtered.find((tree) => tree.isMine) ||
      null;

    const others = filtered
      .filter((tree) => tree.id && tree.id !== yourTree?.id)
      .sort(alphaByName);

    return { yourTree, others, total: filtered.length };
  }, [currentUserId, search, state.items]);

  return (
    <>
      <CedarBackground behavior="fixed" opacity={0.9} zIndex={0} />
      <main className="ft-main nav2-page-shell">
        <CedarPageHeader
          icon={<TreePine size={18} />}
          title="Family Trees"
          subtitle="Explore family tree containers across alumni profiles."
        >
          <Link className="btn-cedar" to="/family-trees/new">
            Create New Family Tree
          </Link>
        </CedarPageHeader>

        <section className="ft-toolbar">
          <label htmlFor="family-tree-search" className="ft-search-label">
            Search Family Trees
          </label>
          <div className="navbar2-search-inputWrap ft-search-nav">
            <input
              id="family-tree-search"
              className="navbar2-search-input"
              type="text"
              placeholder="Search by family tree name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button type="button" className="navbar2-search-cta" aria-label="Search Family Trees">
              <Search size={16} />
            </button>
          </div>
        </section>

        {state.loading && <div className="ft-status">Loading family trees…</div>}
        {!state.loading && state.error && <div className="ft-status ft-error">{state.error}</div>}

        {!state.loading && !state.error && view.total === 0 && (
          <div className="ft-empty">
            {search.trim() ? (
              <>
                <div className="ft-empty-title">No matching family trees</div>
                <div className="ft-empty-sub">Try a different name in search.</div>
              </>
            ) : (
              <>
                <div className="ft-empty-title">Create your family tree</div>
                <div className="ft-empty-sub">
                  No family trees are available yet. Start one and add members.
                </div>
                <Link className="btn-cedar" to="/family-trees/new">
                  Create New Family Tree
                </Link>
              </>
            )}
          </div>
        )}

        {!state.loading && !state.error && view.total > 0 && (
          <section className="ft-grid">
            {view.yourTree && <FamilyTreeCard tree={view.yourTree} isYour onOpen={openTree} />}
            {view.others.map((tree) => (
              <FamilyTreeCard key={tree.id} tree={tree} onOpen={openTree} />
            ))}
          </section>
        )}
      </main>
    </>
  );
}
