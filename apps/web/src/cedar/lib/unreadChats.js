// src/lib/unreadChats.js
import { useCallback, useEffect, useMemo, useState } from "react";
import { API_BASE } from "./api";
import { getToken } from "./helpers";

const READ_KEY = "cedarChatLastRead_v1"; // { [conversationId]: isoString }

function safeParse(json, fallback) {
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? v : fallback;
  } catch {
    return fallback;
  }
}

export function getChatReadMap() {
  return safeParse(localStorage.getItem(READ_KEY) || "{}", {});
}

export function getChatLastRead(conversationId) {
  const map = getChatReadMap();
  return map[String(conversationId)] || null;
}

export function setChatLastRead(conversationId, iso) {
  if (!conversationId || !iso) return;
  const id = String(conversationId);
  const map = getChatReadMap();

  // Only move forward in time
  const prev = map[id] ? new Date(map[id]).getTime() : 0;
  const next = new Date(iso).getTime();
  if (!Number.isFinite(next)) return;
  if (next <= prev) return;

  map[id] = new Date(next).toISOString();
  localStorage.setItem(READ_KEY, JSON.stringify(map));

  // Let other parts of the app update instantly
  window.dispatchEvent(
    new CustomEvent("cedar:chat-read", { detail: { conversationId: id, iso: map[id] } })
  );
}

export function computeUnreadCount(conversations = []) {
  const map = getChatReadMap();
  let count = 0;

  for (const c of conversations) {
    if (!c || !(c.type === "dm" || c.type === "group")) continue;
    const last = c.lastMessageAt ? new Date(c.lastMessageAt).getTime() : 0;
    if (!last) continue;

    const readIso = map[String(c._id)];
    const read = readIso ? new Date(readIso).getTime() : 0;

    if (last > read) count += 1;
  }

  return count;
}

function authHeaders() {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/**
 * Hook: unread conversations count (DM + Group).
 * This counts UNREAD THREADS (not exact unread message count).
 */
export function useUnreadChatsCount({ pollMs = 25000 } = {}) {
  const [count, setCount] = useState(0);
  const token = useMemo(() => getToken() || "", []);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setCount(0);
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/conversations`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      const items = Array.isArray(data.items) ? data.items : [];
      setCount(computeUnreadCount(items));
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    refresh();

    const onRead = () => refresh();
    const onVis = () => {
      if (document.visibilityState === "visible") refresh();
    };

    window.addEventListener("cedar:chat-read", onRead);
    document.addEventListener("visibilitychange", onVis);

    let timer = null;
    if (pollMs > 0) timer = window.setInterval(refresh, pollMs);

    return () => {
      window.removeEventListener("cedar:chat-read", onRead);
      document.removeEventListener("visibilitychange", onVis);
      if (timer) window.clearInterval(timer);
    };
  }, [refresh, pollMs, token]);

  return count;
}
