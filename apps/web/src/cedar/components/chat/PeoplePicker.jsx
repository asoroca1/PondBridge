// src/components/chat/PeoplePicker.jsx
import React, { useEffect, useRef, useState } from "react";
import { API_BASE } from "../../lib/api";
import defaultProfile from "../../assets/default-profile.png";
import { Search } from "lucide-react";

function getToken() { return localStorage.getItem("token"); }

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
      const data = await res.json();
      setItems(Array.isArray(data.items) ? data.items : []);
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
          const id = u.id || u._id;
          const pic = u.photoUrl || u?.uploads?.photoUrl || defaultProfile;
          const name = `${u.firstName || ""} ${u.lastName || ""}`.trim();
          const job  = u.currentJob || "";
          const isSel = selected.some(s => s.id === id);
          return (
            <li key={id} className={`pp-item ${isSel?"is-selected":""}`} onClick={()=> onSelect && onSelect({ id, ...u })}>
              <img src={pic} alt="" className="pp-avatar"/>
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
