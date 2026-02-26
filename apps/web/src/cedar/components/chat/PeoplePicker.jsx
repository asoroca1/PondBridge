// src/components/chat/PeoplePicker.jsx
import React, { useEffect, useRef, useState } from "react";
import { API_BASE } from "../../lib/api";
import { getToken, initialsOf, avatarUrl } from "../../lib/helpers.js";
import { Search } from "lucide-react";

function normalizeEntityId(value = "") {
  const id = String(value || "").trim();
  if (!id || id === "undefined" || id === "null") return "";
  return id;
}

function toPickerId(user = {}) {
  return normalizeEntityId(user?.id || user?._id);
}

function PickerAvatar({ photo = "", firstName = "", lastName = "", name = "" }) {
  const [errored, setErrored] = useState(false);
  const src = String(photo || "").trim();

  useEffect(() => {
    setErrored(false);
  }, [src]);

  if (src && !errored) {
    return <img src={src} alt={name || "Profile"} className="pp-avatar" onError={() => setErrored(true)} />;
  }

  return (
    <div className="pp-avatar pp-avatar-fallback" aria-hidden="true">
      {initialsOf(firstName, lastName) || "?"}
    </div>
  );
}

export default function PeoplePicker({ onSelect, selected = [], multi = false }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const debounce = useRef(null);

  function displaySelectedCount() {
    return multi && selected.length ? <span className="pp-count">{selected.length} selected</span> : null;
  }

  useEffect(() => {
    return () => clearTimeout(debounce.current);
  }, []);

  async function search(term) {
    if (!term) { setItems([]); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/search/names?q=${encodeURIComponent(term)}&limit=10`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setItems([]);
        return;
      }
      const rawItems = Array.isArray(data?.items) ? data.items : [];
      const next = [];
      const seen = new Set();
      rawItems.forEach((user) => {
        const id = toPickerId(user);
        if (!id || seen.has(id)) return;
        seen.add(id);
        next.push({ ...user, id, _id: id });
      });
      setItems(next);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  function onInput(e) {
    const v = e.target.value;
    setQ(v);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => search(v.trim()), 200);
  }

  return (
    <div className="pp-wrap">
      <div className="pp-search">
        <Search size={16}/>
        <input className="pp-input" placeholder="Search names…" value={q} onChange={onInput}/>
        {displaySelectedCount()}
      </div>
      <ul className="pp-list">
        {loading && <li className="pp-item muted">Searching…</li>}
        {!loading && items.map(u => {
          const id = toPickerId(u);
          if (!id) return null;
          const pic = avatarUrl(u);
          const name = `${u.firstName || ""} ${u.lastName || ""}`.trim();
          const job  = u.currentJob || "";
          const isSel = selected.some((s) => normalizeEntityId(s?.id) === id);
          return (
            <li
              key={id}
              className={`pp-item ${isSel?"is-selected":""}`}
              onClick={() => onSelect && onSelect({ id, _id: id, ...u })}
            >
              <PickerAvatar photo={pic} firstName={u.firstName} lastName={u.lastName} name={name} />
              <div className="pp-text">
                <div className="pp-name">{name}</div>
                {job && <div className="pp-sub">{job}</div>}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
