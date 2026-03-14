// src/components/chat/PeoplePicker.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { API_BASE } from "../../lib/api";
import { getToken, initialsOf, avatarUrl } from "../../lib/helpers.js";
import InitialsMark from "../../../components/InitialsMark.jsx";
import { Search } from "lucide-react";

function normalizeEntityId(value = "") {
  const id = String(value || "").trim();
  if (!id || id === "undefined" || id === "null") return "";
  return id;
}

function isObjectIdLike(value = "") {
  return /^[a-f0-9]{24}$/i.test(normalizeEntityId(value));
}

function toObjectId(value = "") {
  const id = normalizeEntityId(value);
  return isObjectIdLike(id) ? id : "";
}

function toPickerIdentity(user = {}) {
  const userId = toObjectId(user?.userId);
  const profileId = toObjectId(user?.id || user?._id);
  const targetId = userId || profileId;
  if (!targetId) return null;
  return { targetId, userId, profileId };
}

function myUserIdFromToken() {
  const token = String(getToken() || "").trim();
  if (!token.includes(".")) return "";
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return normalizeEntityId(payload?.sub);
  } catch {
    return "";
  }
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
      <InitialsMark value={initialsOf(firstName, lastName) || "?"} />
    </div>
  );
}

export default function PeoplePicker({ onSelect, selected = [], multi = false }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const debounce = useRef(null);
  const myUserId = useMemo(() => myUserIdFromToken(), []);

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
        const identity = toPickerIdentity(user);
        if (!identity) return;
        if (identity.userId && identity.userId === myUserId) return;
        if (seen.has(identity.targetId)) return;
        seen.add(identity.targetId);
        next.push({
          ...user,
          id: identity.targetId,
          _id: identity.targetId,
          userId: identity.userId || identity.targetId,
          profileId: identity.profileId
        });
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
          const identity = toPickerIdentity(u);
          if (!identity) return null;
          const id = identity.targetId;
          const pic = avatarUrl(u);
          const name = `${u.firstName || ""} ${u.lastName || ""}`.trim();
          const job  = u.currentJob || "";
          const isSel = selected.some((s) => normalizeEntityId(s?.id || s?.userId) === id);
          return (
            <li
              key={id}
              className={`pp-item ${isSel?"is-selected":""}`}
              onClick={() =>
                onSelect &&
                onSelect({
                  ...u,
                  id,
                  _id: id,
                  userId: identity.userId || id,
                  profileId: identity.profileId
                })
              }
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
