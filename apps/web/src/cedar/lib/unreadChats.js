// src/lib/unreadChats.js
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_POLL_INTERVAL_MS, createPollPlanner } from "../../lib/pollPlanner.js";
import { API_BASE } from "./api";
import { authHeaders, getToken } from "./helpers";

const READ_KEY = "cedarChatLastRead_v2"; // { [conversationId]: isoString }

function safeParse(json, fallback) {
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? v : fallback;
  } catch {
    return fallback;
  }
}

function toMs(value) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function maxIso(...isos) {
  let latest = 0;
  for (const value of isos) {
    latest = Math.max(latest, toMs(value));
  }
  return latest ? new Date(latest).toISOString() : null;
}

function tokenSubject() {
  const token = String(getToken() || "").trim();
  if (!token.includes(".")) return "anonymous";
  try {
    const encoded = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(encoded));
    return String(payload?.sub || payload?.userId || "anonymous").trim() || "anonymous";
  } catch {
    return "anonymous";
  }
}

export function getChatReadStorageKey() {
  const tenant =
    window.location.pathname.match(/^\/t\/([^/]+)/i)?.[1] ||
    localStorage.getItem("pondbridgeTenantSlug") ||
    "tenant";
  return `${READ_KEY}:${decodeURIComponent(tenant)}:${tokenSubject()}`;
}

export function getChatReadMap() {
  return safeParse(localStorage.getItem(getChatReadStorageKey()) || "{}", {});
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
  localStorage.setItem(getChatReadStorageKey(), JSON.stringify(map));

  // Let other parts of the app update instantly
  window.dispatchEvent(
    new CustomEvent("cedar:chat-read", { detail: { conversationId: id, iso: map[id] } })
  );
}

export async function markConversationRead(conversationId, isoMaybe, lastMessageAt = null) {
  const id = String(conversationId || "").trim();
  if (!id) return null;

  const iso = maxIso(isoMaybe, lastMessageAt);
  if (!iso) return null;

  setChatLastRead(id, iso);

  if (!getToken()) return iso;

  try {
    await fetch(`${API_BASE}/conversations/${id}/read`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ iso })
    });
  } catch {
    // Keep the local unread state cleared even if the network request fails.
  }

  return iso;
}

export function computeUnreadCount(conversations = []) {
  const map = getChatReadMap();
  let count = 0;

  for (const c of conversations) {
    if (!c || !(c.type === "dm" || c.type === "group")) continue;
    if (!c.lastMessage || typeof c.lastMessage !== "object") continue;
    const last = c.lastMessageAt ? new Date(c.lastMessageAt).getTime() : 0;
    if (!last) continue;

    const readIso = map[String(c._id)];
    const read = Math.max(toMs(readIso), toMs(c.lastReadAt));

    if (last > read) count += 1;
  }

  return count;
}

/**
 * Hook: unread conversations count (DM + Group).
 * This counts UNREAD THREADS (not exact unread message count).
 */
export function useUnreadChatsCount({ pollMs = 25000 } = {}) {
  const [count, setCount] = useState(0);
  const token = useMemo(() => getToken() || "", []);

  const plannerRef = useRef(null);
  if (!plannerRef.current) {
    plannerRef.current = createPollPlanner({
      intervalMs: pollMs > 0 ? pollMs : DEFAULT_POLL_INTERVAL_MS,
      isVisible: () => typeof document === "undefined" || document.visibilityState === "visible",
      isOnline: () => typeof navigator === "undefined" || navigator.onLine !== false
    });
  }

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setCount(0);
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/conversations`, { headers: authHeaders() });
      if (!res.ok) {
        plannerRef.current.noteRun(false);
        return;
      }
      const data = await res.json();
      const items = Array.isArray(data.items) ? data.items : [];
      setCount(computeUnreadCount(items));
      plannerRef.current.noteRun(true);
    } catch {
      // A failed poll still counts as an attempt, so an unreachable API is
      // asked less often rather than at full rate for as long as it is down.
      plannerRef.current.noteRun(false);
    }
  }, []);

  useEffect(() => {
    const planner = plannerRef.current;
    let timer = null;

    // This used to run every 25 seconds whether or not anyone was looking, so
    // a tab left open in the background kept a phone's radio and the API busy
    // all day for a number nobody could see. Offline was no different: the
    // fetch still went out, still failed, and still went out again on time.
    const tick = () => {
      if (!planner.shouldRun()) return;
      void refresh();
      reschedule();
    };

    function reschedule() {
      if (timer) window.clearTimeout(timer);
      if (pollMs <= 0) return;
      timer = window.setTimeout(tick, planner.delayMs());
    }

    // Waking up only costs a request if the answer could actually have gone
    // stale, so flicking between tabs does not become its own traffic.
    const wake = () => {
      if (!planner.shouldRun()) return;
      if (planner.isStale()) void refresh();
      reschedule();
    };

    const onRead = () => refresh();

    if (planner.shouldRun()) void refresh();
    reschedule();

    window.addEventListener("cedar:chat-read", onRead);
    window.addEventListener("cedar:chat-message", onRead);
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);

    return () => {
      window.removeEventListener("cedar:chat-read", onRead);
      window.removeEventListener("cedar:chat-message", onRead);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      if (timer) window.clearTimeout(timer);
    };
  }, [refresh, pollMs, token]);

  return count;
}
