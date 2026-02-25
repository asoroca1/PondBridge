// src/pages/ChatsAndForums.jsx
import React, { useEffect, useMemo, useRef, useState, useLayoutEffect } from "react";
import CedarBackground from "../components/CedarBackground";
import CedarPageHeader from "../components/CedarPageHeader.jsx";
import { API_BASE } from "../lib/api";
import { createSocket } from "../lib/socket";
import "./chats.css";
import { MessageSquare, Users, Megaphone, Plus, Paperclip, Shield, ChevronLeft, Search } from "lucide-react";
import PeoplePicker from "../components/chat/PeoplePicker";
import MessageComposer from "../components/chat/MessageComposer";
import { useSearchParams, useLocation, useNavigate } from "react-router-dom";
import { getToken, authHeaders, displayName, initialsOf, avatarUrl, fmtDateTime, relativeTime } from "../lib/helpers.js";

/* ======================= Helpers ======================= */

/* ---------- unread chats (localStorage) ---------- */
/**
 * MUST match MainHome.jsx
 * MainHome reads cedarChatLastRead_v1 and compares lastMessageAt > lastRead
 */
const CHAT_READ_KEY = "cedarChatLastRead_v1"; // { [conversationId]: isoString }

function safeParse(json, fallback) {
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? v : fallback;
  } catch {
    return fallback;
  }
}
function getChatReadMap() {
  return safeParse(localStorage.getItem(CHAT_READ_KEY) || "{}", {});
}
function toMs(iso) {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}
function maxIso(...isos) {
  let m = 0;
  for (const s of isos) m = Math.max(m, toMs(s));
  return m ? new Date(m).toISOString() : null;
}
/**
 * Update localStorage + notify Home page to refresh the badge immediately.
 * IMPORTANT: monotonic (never moves backward).
 */
function persistLocalRead(conversationId, iso) {
  if (!conversationId || !iso) return;
  try {
    const id = String(conversationId);
    const map = getChatReadMap();

    const prevMs = toMs(map[id]);
    const nextMs = toMs(iso);
    if (!nextMs) return;

    // Only move forward in time (prevents "still unread" due to older timestamps)
    if (nextMs <= prevMs) return;

    map[id] = new Date(nextMs).toISOString();
    localStorage.setItem(CHAT_READ_KEY, JSON.stringify(map));

    // Notify other pages/hooks (MainHome) to refresh immediately
    window.dispatchEvent(
      new CustomEvent("cedar:chat-read", { detail: { conversationId: id, iso: map[id] } })
    );
  } catch {
    // silent
  }
}

/** Person profile route */
const profilePath = (userId) => `/profile/${userId}`;

function conversationSnippet(item) {
  const text =
    item?.lastMessage?.text ||
    item?.lastMessageText ||
    item?.lastMessagePreview ||
    item?.preview ||
    "";
  if (text) return String(text).trim();

  const kind = item?.lastMessage?.kind;
  if (kind === "image") return "Photo";
  if (kind === "file") return "File attachment";
  return "No messages yet";
}

function createClientMessageId() {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function sendConversationViaSocket({
  socket,
  conversationId,
  kind,
  text,
  media,
  clientMessageId,
  timeoutMs = 6000,
}) {
  return new Promise((resolve, reject) => {
    if (!socket?.connected) {
      const err = new Error("socket disconnected");
      err.status = 503;
      reject(err);
      return;
    }

    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      const err = new Error("socket ack timeout");
      err.status = 504;
      reject(err);
    }, timeoutMs);

    socket.emit(
      "message:send",
      { conversationId, kind, text, media, clientMessageId },
      (ack) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);

        if (ack?.ok && ack?.message) {
          resolve(ack);
          return;
        }

        const err = new Error(ack?.error || "Unable to send message");
        err.status = ack?.status || 500;
        reject(err);
      }
    );
  });
}

/** Force scroll container to bottom even across paint/timing races. */
function forceScrollToBottom(ref) {
  const el = ref.current;
  if (!el) return;
  el.scrollTop = el.scrollHeight; // now
  requestAnimationFrame(() => {
    if (!ref.current) return;
    ref.current.scrollTop = ref.current.scrollHeight; // next frame
  });
  setTimeout(() => {
    if (!ref.current) return;
    ref.current.scrollTop = ref.current.scrollHeight; // after microtasks
  }, 0);
}

function getGroupMemberIds(g) {
  return g?.participantIds && Array.isArray(g.participantIds)
    ? g.participantIds
    : g?.memberIds && Array.isArray(g.memberIds)
    ? g.memberIds
    : [];
}

// de-dupe helpers
function hasId(arr, id) {
  const s = String(id);
  return arr.some((x) => String(x?._id) === s);
}

async function fetchUser(id) {
  const res = await fetch(`${API_BASE}/search/user/${id}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error("bad user");
  const data = await res.json();
  return data.user;
}

/* ==== auth/ownership helpers (flexible + admin support) ==== */
function getJwtPayload() {
  try {
    const t = getToken();
    return t ? JSON.parse(atob(t.split(".")[1])) : {};
  } catch {
    return {};
  }
}
function myIdentity() {
  const p = getJwtPayload();
  return { id: p.sub, roles: Array.isArray(p.roles) ? p.roles : [] };
}
function resourceCreatorId(resource) {
  return (
    resource?.creatorId ??
    resource?.createdBy ??
    resource?.ownerId ??
    resource?.creator?.id ??
    resource?.creator?._id ??
    null
  );
}
function isAdmin(roles) {
  return (
    Array.isArray(roles) &&
    (roles.includes("admin") || roles.includes("tenant_admin") || roles.includes("super_admin"))
  );
}
function canDelete({ meId, roles, resource }) {
  const creator = resourceCreatorId(resource);
  const isOwner = creator != null && String(meId) === String(creator);
  return isOwner || isAdmin(roles);
}

/* ======================= Avatars ======================= */
/** Clickable person avatar when `userId` or `linkTo` is provided. Stops row click bubbling. */
function Avatar({ name, url, size = "md", userId, linkTo }) {
  const [broken, setBroken] = useState(false);
  const cls = ["cf-avatar", size === "sm" ? "cf-sm" : "", size === "lg" ? "cf-lg" : ""]
    .filter(Boolean)
    .join(" ");

  const showInitials = !url || broken;
  const initials = initialsOf(name);
  const clickable = !!(userId || linkTo);

  const base = showInitials ? (
    <div className={cls} style={{ cursor: clickable ? "pointer" : undefined }}>
      {initials || "?"}
    </div>
  ) : (
    <img
      className={`${cls} cf-avatar-img`}
      src={url}
      alt={name || "avatar"}
      onError={() => setBroken(true)}
      style={{ cursor: clickable ? "pointer" : undefined }}
    />
  );

  const href = linkTo || (userId ? profilePath(userId) : null);
  if (!href) return base;

  return (
    <a
      href={href}
      className="cf-avatar-link"
      onClick={(e) => e.stopPropagation()}
      aria-label={name ? `Open ${name}'s profile` : "Open profile"}
      style={{ display: "inline-flex" }}
    >
      {base}
    </a>
  );
}

/* Wrap title + (optional) avatar */
function ThreadHeader({ title, subtitle, right, avatarUrl, size = "lg", userId, onMobileBack }) {
  return (
    <div className="cf-thread-header">
      <div className="cf-thread-left">
        {onMobileBack && (
          <button className="cf-mobile-back" onClick={onMobileBack} aria-label="Back to conversations">
            <ChevronLeft size={16} />
          </button>
        )}
        <Avatar name={title} url={avatarUrl} size={size} userId={userId} />
        <div className="cf-thread-titles">
          <div className="cf-thread-title">{title}</div>
          {subtitle && <div className="cf-thread-sub">{subtitle}</div>}
        </div>
      </div>
      <div className="cf-thread-actions">{right}</div>
    </div>
  );
}

/* ======================= Page Wrapper ======================= */
export default function ChatAndForums() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const initialTab = tabParam === "groups" || tabParam === "forums" ? tabParam : "personal";
  const [tab, setTab] = useState(initialTab); // personal | groups | forums
  const [socket] = useState(() => createSocket(getToken() || ""));

  useEffect(() => {
    socket.connect();
    return () => socket.disconnect();
  }, [socket]);

  useEffect(() => {
    const next = searchParams.get("tab");
    const normalized = next === "groups" || next === "forums" ? next : "personal";
    if (normalized !== tab) setTab(normalized);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  function selectTab(nextTab) {
    setTab(nextTab);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("tab", nextTab);
    setSearchParams(nextParams, { replace: true });
  }

  return (
    <div style={{ position: "relative", minHeight: "100vh" }}>
      <CedarBackground behavior="scroll" opacity={0.9} zIndex={-1} />
      <main className="cf-main nav2-page-shell">
        <CedarPageHeader
          icon={<MessageSquare size={18} />}
          title="Chats & Forums"
          subtitle="Direct messages, group chats, and forum posts — all in one place."
        >
          <nav className="cf-tabs" role="tablist" aria-label="Chats & Forums">
            <button
              className={`cf-tab ${tab === "personal" ? "is-active" : ""}`}
              onClick={() => selectTab("personal")}
              role="tab"
              aria-selected={tab === "personal"}
            >
              <MessageSquare size={16} /> Personal
            </button>
            <button
              className={`cf-tab ${tab === "groups" ? "is-active" : ""}`}
              onClick={() => selectTab("groups")}
              role="tab"
              aria-selected={tab === "groups"}
            >
              <Users size={16} /> Group
            </button>
            <button
              className={`cf-tab ${tab === "forums" ? "is-active" : ""}`}
              onClick={() => selectTab("forums")}
              role="tab"
              aria-selected={tab === "forums"}
            >
              <Megaphone size={16} /> Forums
            </button>
          </nav>
        </CedarPageHeader>

        {tab === "personal" && <PersonalTab socket={socket} />}
        {tab === "groups" && <GroupsTab socket={socket} />}
        {tab === "forums" && <ForumsTab socket={socket} />}
      </main>
    </div>
  );
}

/* ======================= Message Bubble ======================= */
function MessageBubble({ me, msg, nameLookup, userLookup }) {
  const mine = me && String(msg.senderId) === String(me);
  const lookup = userLookup?.[String(msg.senderId)] || null;
  const who = !mine ? lookup?.name || nameLookup?.[msg.senderId] || "Unknown" : "You";
  const avatar = lookup?.avatar || "";
  const time = fmtDateTime(msg.createdAt);
  const isText = msg.kind === "text";
  const isImage = msg.kind === "image";
  const isFile = msg.kind === "file";

  return (
    <div className={`cf-row ${mine ? "is-right" : "is-left"}`}>
      <div className="cf-row-line">
        {!mine && (
          <div className="cf-msg-avatar">
            <Avatar name={who} url={avatar} size="sm" userId={String(msg.senderId)} />
          </div>
        )}
        <div className="cf-row-stack">
          {!mine && <div className="cf-badge">{who}</div>}
          <div className={`cf-bubble ${mine ? "is-mine" : ""}`}>
            {isText && <div className="cf-bubble-body">{msg.text}</div>}
            {isImage && (
              <div className="cf-bubble-media">
                <a href={msg.media?.url} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line */}
                  <img src={msg.media?.url} alt={msg.media?.name || "image"} />
                </a>
              </div>
            )}
            {isFile && (
              <div className="cf-bubble-file">
                <Paperclip size={16} />
                <a href={msg.media?.url} target="_blank" rel="noreferrer">
                  {msg.media?.name || "file"}
                </a>
              </div>
            )}
          </div>
          <div className="cf-time">{time}</div>
        </div>
      </div>
    </div>
  );
}

/* ======================= Personal (DM) ======================= */
function PersonalTab({ socket }) {
  const [list, setList] = useState([]); // DM conversations
  const [loadingList, setLoadingList] = useState(true);
  const [active, setActive] = useState(null); // active conversation object
  const [messages, setMessages] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [userCache, setUserCache] = useState({}); // { userId: {name, avatar} }
  const [titles, setTitles] = useState({}); // conversationId -> title
  const [typing, setTyping] = useState(false);
  const [lastReadISO, setLastReadISO] = useState(null);
  const [other, setOther] = useState({ name: "", avatar: "" }); // header display
  const [search, setSearch] = useState("");
  const scrollRef = useRef(null);

  // stick-to-bottom state
  const [stickBottom, setStickBottom] = useState(true);
  const isNearBottom = (el, threshold = 60) =>
    el && el.scrollHeight - el.scrollTop - el.clientHeight < threshold;

  const { id: meId, roles: meRoles } = useMemo(() => myIdentity(), []);

  // Deep-link intent
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    let targetId = searchParams.get("to") || searchParams.get("dm") || "";
    if (!targetId) {
      const m = location.pathname.match(/\/chat\/([^/?#]+)/i);
      if (m && m[1]) targetId = m[1];
    }
    if (!targetId) return;

    (async () => {
      try {
        const res = await fetch(`${API_BASE}/conversations/dm`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ userId: targetId }),
        });
        const convo = await res.json();

        await loadList();
        await onOpen(convo);
      } catch (e) {
        console.error("Failed to start DM from deep-link", e);
      } finally {
        searchParams.delete("to");
        searchParams.delete("dm");
        setSearchParams(searchParams, { replace: true });

        if (/\/chat\/[^/]+/i.test(location.pathname)) {
          navigate("/chat-rooms", { replace: true });
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  function clearUnreadLocally(convoId) {
    setList((prev) =>
      prev.map((c) => {
        if (String(c?._id) !== String(convoId)) return c;
        return {
          ...c,
          unreadCount: 0,
          unread: 0,
          unreadMessages: 0,
          unreadMessagesCount: 0,
          unseenCount: 0,
          newCount: 0,
        };
      })
    );
  }

  async function markRead(convoId, isoMaybe, convoLastMessageAt) {
    if (!convoId) return;

    // IMPORTANT: store a read timestamp that is >= lastMessageAt
    const iso = maxIso(isoMaybe, convoLastMessageAt);
    if (!iso) return;

    // 0) update localStorage so MainHome badge clears
    persistLocalRead(convoId, iso);

    // 1) socket read receipt (if backend uses sockets)
    try {
      socket.emit("read:upto", { room: `conversation:${convoId}`, iso });
    } catch {}

    // 2) optional REST fallback (safe if endpoint doesn't exist)
    try {
      await fetch(`${API_BASE}/conversations/${convoId}/read`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ iso }),
      });
    } catch {}

    // 3) update UI immediately
    clearUnreadLocally(convoId);
  }

  async function computeDMTitles(convos) {
    const map = {};
    const cacheUpdates = {};
    for (const c of convos) {
      const otherId = (c.participantIds || []).map(String).find((id) => id !== String(meId));
      if (!otherId) {
        map[c._id] = "Direct Message";
        continue;
      }
      try {
        const u = await fetchUser(otherId);
        const nm = displayName(u);
        map[c._id] = nm;
        cacheUpdates[otherId] = { name: nm, avatar: avatarUrl(u) };
      } catch {
        map[c._id] = "Direct Message";
      }
    }
    if (Object.keys(cacheUpdates).length) {
      setUserCache((prev) => ({ ...prev, ...cacheUpdates }));
    }
    setTitles(map);
  }

  async function loadList() {
    try {
      setLoadingList(true);
      const res = await fetch(`${API_BASE}/conversations`, { headers: authHeaders() });
      const data = await res.json();
      const dms = (data.items || []).filter((c) => c.type === "dm");
      setList(dms);
      computeDMTitles(dms);
    } finally {
      setLoadingList(false);
    }
  }

  async function loadMessages(convoId, cursor) {
    const el = scrollRef.current;
    const prevBottom = el ? el.scrollHeight - el.scrollTop : 0;

    const url = new URL(`${API_BASE}/conversations/${convoId}/messages`);
    if (cursor) url.searchParams.set("cursor", cursor);

    const res = await fetch(url, { headers: authHeaders() });
    const data = await res.json();
    const items = data.items || [];

    if (cursor) {
      setMessages((m) => {
        const older = items.filter((x) => !hasId(m, x._id));
        return [...older, ...m];
      });
      queueMicrotask(() => {
        const el2 = scrollRef.current;
        if (el2) el2.scrollTop = el2.scrollHeight - prevBottom;
      });
    } else {
      setMessages(items);
      setStickBottom(true);
      queueMicrotask(() => forceScrollToBottom(scrollRef));
    }

    setNextCursor(data.nextCursor);
    primeUserCache(items);

    return items;
  }

  async function primeUserCache(items) {
    const ids = [...new Set((items || []).map((m) => String(m.senderId)))];
    const unknowns = ids.filter((id) => !userCache[id]);
    for (const id of unknowns) {
      try {
        const u = await fetchUser(id);
        setUserCache((prev) => ({ ...prev, [id]: { name: displayName(u), avatar: avatarUrl(u) } }));
      } catch {}
    }
  }

  async function onOpen(convo) {
    if (active?._id) socket.emit("leave", `conversation:${active._id}`);
    setActive(convo);
    setStickBottom(true);

    const otherId = (convo.participantIds || []).map(String).find((id) => id !== String(meId));
    if (otherId) {
      if (userCache[otherId]) {
        setOther(userCache[otherId]);
      } else {
        try {
          const u = await fetchUser(otherId);
          const info = { name: displayName(u), avatar: avatarUrl(u) };
          setUserCache((prev) => ({ ...prev, [otherId]: info }));
          setOther(info);
        } catch {
          setOther({ name: titles[convo._id] || "Direct Message", avatar: "" });
        }
      }
    } else {
      setOther({ name: titles[convo._id] || "Direct Message", avatar: "" });
    }

    socket.emit("join", `conversation:${convo._id}`);

    const items = await loadMessages(convo._id);
    const lastMsgIso = items?.[items.length - 1]?.createdAt || null;

    // IMPORTANT: read timestamp should be >= conversation.lastMessageAt
    const readIso = maxIso(lastMsgIso, convo?.lastMessageAt);
    if (readIso) await markRead(convo._id, readIso, convo?.lastMessageAt);
    else clearUnreadLocally(convo._id);
  }

  async function onSend({ kind, text, media }) {
    if (!active) return;
    const clientMessageId = createClientMessageId();

    const optimistic = {
      _id: `tmp_${Date.now()}`,
      conversationId: active._id,
      senderId: meId,
      kind,
      text,
      media,
      clientMessageId,
      createdAt: new Date().toISOString(),
    };
    setMessages((m) => [...m, optimistic]);
    queueMicrotask(() => forceScrollToBottom(scrollRef));

    try {
      let saved = null;

      if (socket?.connected) {
        try {
          const ack = await sendConversationViaSocket({
            socket,
            conversationId: active._id,
            kind,
            text,
            media,
            clientMessageId,
          });
          saved = ack.message;
        } catch (socketErr) {
          if (socketErr?.status && socketErr.status < 500) throw socketErr;
        }
      }

      if (!saved) {
        const res = await fetch(`${API_BASE}/conversations/${active._id}/messages`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ kind, text, media, clientMessageId }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          const err = new Error(data?.error || "Unable to send message");
          err.status = res.status;
          throw err;
        }
        saved = data;
      }

      setMessages((m) => {
        const replaced = m.map((x) => (x._id === optimistic._id ? saved : x));
        return replaced.filter(
          (x, i, arr) => arr.findIndex((y) => String(y._id) === String(x._id)) === i
        );
      });

      const lastIso = saved?.createdAt || new Date().toISOString();
      await markRead(active._id, lastIso, active?.lastMessageAt);

      queueMicrotask(() => forceScrollToBottom(scrollRef));
    } catch {
      setMessages((m) => m.filter((x) => x._id !== optimistic._id));
    }
  }

  useEffect(() => {
    if (!socket) return;

    const onNew = async (msg) => {
      if (active && String(msg.conversationId) === String(active._id)) {
        setMessages((m) => (hasId(m, msg._id) ? m : [...m, msg]));
        queueMicrotask(() => forceScrollToBottom(scrollRef));

        const lastIso = msg?.createdAt || new Date().toISOString();
        await markRead(active._id, lastIso, active?.lastMessageAt);
      } else {
        setList((prev) =>
          prev.map((c) => {
            if (String(c?._id) !== String(msg.conversationId)) return c;
            const current = Number(c.unreadCount ?? c.unread ?? c.unreadMessages ?? c.unseenCount ?? 0) || 0;
            return {
              ...c,
              unreadCount: current + 1,
              unread: current + 1,
              unreadMessages: current + 1,
              unseenCount: current + 1,
            };
          })
        );
      }
    };

    const onTyping = ({ room, userId, on }) => {
      if (!active) return;
      if (room === `conversation:${active._id}` && String(userId) !== String(meId)) {
        setTyping(!!on);
      }
    };

    const onReadUpto = ({ room, userId, iso }) => {
      if (!active) return;
      if (room === `conversation:${active._id}` && String(userId) !== String(meId)) {
        setLastReadISO(iso);
      }
    };

    const onConvoDeleted = ({ id }) => {
      if (active && String(active._id) === String(id)) setActive(null);
      setList((ls) => ls.filter((c) => String(c._id) !== String(id)));
    };

    socket.on("message:new", onNew);
    socket.on("typing", onTyping);
    socket.on("read:upto", onReadUpto);
    socket.on("conversation:deleted", onConvoDeleted);

    return () => {
      socket.off("message:new", onNew);
      socket.off("typing", onTyping);
      socket.off("read:upto", onReadUpto);
      socket.off("conversation:deleted", onConvoDeleted);
    };
  }, [socket, active, meId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadList();
  }, []);

  useLayoutEffect(() => {
    if (active?._id) forceScrollToBottom(scrollRef);
  }, [active?._id]);

  useEffect(() => {
    if (active?._id && messages.length && stickBottom) forceScrollToBottom(scrollRef);
  }, [messages.length, active?._id, stickBottom]);

  // IMPORTANT: whenever messages change in an open thread, keep read timestamp up-to-date
  useEffect(() => {
    if (!active?._id) return;
    if (!messages.length) {
      clearUnreadLocally(active._id);
      return;
    }
    const last = messages[messages.length - 1];
    const lastIso = last?.createdAt;
    if (lastIso) markRead(active._id, lastIso, active?.lastMessageAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?._id, messages.length]);

  useEffect(() => {
    if (active?._id && stickBottom) forceScrollToBottom(scrollRef);
  }, [typing, lastReadISO, active?._id, stickBottom]);

  async function deleteDM() {
    if (!active) return;
    if (!window.confirm("Delete this DM thread for everyone? This cannot be undone.")) return;
    await fetch(`${API_BASE}/conversations/${active._id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    setActive(null);
    loadList();
  }

  const dms = list;
  const filteredDms = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return dms;
    return dms.filter((c) => {
      const title = String(titles[c._id] || "").toLowerCase();
      const preview = conversationSnippet(c).toLowerCase();
      return title.includes(q) || preview.includes(q);
    });
  }, [dms, search, titles]);

  return (
    <section className={`cf-panel ${active ? "is-thread-open" : ""}`}>
      <aside className="cf-sidebar">
        <div className="cf-sidebar-head">
          <div className="cf-sidebar-title-wrap">
            <div className="cf-sidebar-title">Personal Chats</div>
            <span className="cf-sidebar-count">{dms.length}</span>
          </div>
          <StartDMButton
            onStarted={(convo) => {
              loadList();
              onOpen(convo);
            }}
          />
        </div>
        <label className="cf-sidebar-search" aria-label="Search personal chats">
          <Search size={16} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search conversations..."
          />
        </label>

        {loadingList ? (
          <div className="cf-loading">Loading…</div>
        ) : dms.length === 0 ? (
          <EmptyState
            icon={MessageSquare}
            title="No DMs yet"
            subtitle="Start a conversation with anyone in the network."
            action={<StartDMButton onStarted={(c) => { loadList(); onOpen(c); }} />}
          />
        ) : filteredDms.length === 0 ? (
          <div className="cf-loading">No matches found.</div>
        ) : (
          <ul className="cf-list">
            {filteredDms.map((c) => {
              const otherId = (c.participantIds || []).map(String).find((id) => id !== String(meId));
              const info = otherId ? userCache[otherId] : null;
              const unread = Number(c.unreadCount ?? c.unread ?? c.unreadMessages ?? c.unseenCount ?? 0) || 0;
              const title = titles[c._id] || "Direct Message";

              return (
                <li
                  key={c._id}
                  className={`cf-list-item ${active?._id === c._id ? "is-active" : ""}`}
                >
                  <button className="cf-li-btn" onClick={() => onOpen(c)}>
                    <div className="cf-li-row">
                      <Avatar name={title} url={info?.avatar} size="md" userId={otherId} />
                      <div className="cf-li-text">
                        <div className="cf-li-title-row">
                          <div className="cf-li-title">{title}</div>
                          <div className="cf-li-time">{relativeTime(c.lastMessageAt)}</div>
                        </div>
                        <div className="cf-li-sub">{conversationSnippet(c)}</div>
                      </div>
                      {!!unread && <span className="cf-unread-badge">{unread > 99 ? "99+" : unread}</span>}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      <section className="cf-thread">
        {!active ? (
          <EmptyState icon={MessageSquare} title="Open a chat" subtitle="Pick a conversation from the left—or start a new one." />
        ) : (
          <>
            <ThreadHeader
              title={other.name || titles[active._id] || "Direct Message"}
              subtitle="Direct Message"
              avatarUrl={other.avatar}
              userId={(active?.participantIds || []).map(String).find((id) => id !== String(meId))}
              onMobileBack={() => setActive(null)}
              right={
                <>
                  <span className="cf-thread-chip">Live</span>
                  {canDelete({ meId, roles: meRoles, resource: active }) && (
                    <button className="cf-ghost-btn" onClick={deleteDM} title="Delete conversation">
                      Delete
                    </button>
                  )}
                </>
              }
            />

            <div
              className="cf-thread-body"
              ref={scrollRef}
              style={{ scrollBehavior: "auto" }}
              onScroll={(e) => {
                const el = e.currentTarget;
                if (el.scrollTop < 40 && nextCursor) loadMessages(active._id, nextCursor);
                setStickBottom(isNearBottom(el));
              }}
            >
              {messages.map((m) => (
                <MessageBubble
                  key={m._id}
                  me={meId}
                  msg={m}
                  userLookup={userCache}
                />
              ))}
              {typing && <div className="cf-typing">Typing…</div>}
              {lastReadISO && <div className="cf-read">Seen up to {fmtDateTime(lastReadISO)}</div>}
            </div>

            <MessageComposer
              onSend={onSend}
              onPresign={async (file) => {
                const res = await fetch(`${API_BASE}/conversations/${active._id}/presign`, {
                  method: "POST",
                  headers: authHeaders(),
                  body: JSON.stringify({
                    fileName: file.name,
                    fileType: file.type,
                    fileSize: Number(file.size || 0)
                  }),
                });
                return res.json();
              }}
              onTypingStart={() => active && socket.emit("typing:start", `conversation:${active._id}`)}
              onTypingStop={() => active && socket.emit("typing:stop", `conversation:${active._id}`)}
            />
          </>
        )}
      </section>
    </section>
  );
}

function StartDMButton({ onStarted }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(null);

  async function start() {
    if (!selected) return;
    try {
      setBusy(true);
      const res = await fetch(`${API_BASE}/conversations/dm`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ userId: selected.id }),
      });
      const convo = await res.json();
      onStarted && onStarted(convo);
      setOpen(false);
      setSelected(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="cf-cta" onClick={() => setOpen(true)}>
        <Plus size={16} /> New
      </button>
      {open && (
        <div className="cf-modal" role="dialog" aria-modal="true">
          <div className="cf-modal-card">
            <div className="cf-modal-head">
              <div className="cf-modal-title">Start a DM</div>
              <button className="cf-ghost-btn" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>
            <div className="cf-modal-body">
              <PeoplePicker onSelect={(u) => setSelected(u)} selected={selected ? [selected] : []} multi={false} />
            </div>
            <div className="cf-modal-foot">
              <button className="cf-btn" disabled={!selected || busy} onClick={start}>
                {busy ? "Creating…" : "Create DM"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ======================= Groups ======================= */
function GroupsTab({ socket }) {
  const [list, setList] = useState([]);
  const [active, setActive] = useState(null);
  const [messages, setMessages] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [nameCache, setNameCache] = useState({});
  const [typing, setTyping] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [memberInfo, setMemberInfo] = useState({});
  const [search, setSearch] = useState("");
  const scrollRef = useRef(null);

  const { id: meId, roles: meRoles } = useMemo(() => myIdentity(), []);

  async function loadList() {
    const res = await fetch(`${API_BASE}/conversations`, { headers: authHeaders() });
    const data = await res.json();
    setList((data.items || []).filter((c) => c.type === "group"));
  }
  useEffect(() => {
    loadList();
  }, []);

  async function loadMessages(id, cursor) {
    const el = scrollRef.current;
    const prevBottom = el ? el.scrollHeight - el.scrollTop : 0;

    const url = new URL(`${API_BASE}/conversations/${id}/messages`);
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await fetch(url, { headers: authHeaders() });
    const data = await res.json();
    const items = data.items || [];

    if (cursor) {
      setMessages((m) => {
        const older = items.filter((x) => !hasId(m, x._id));
        return [...older, ...m];
      });
      queueMicrotask(() => {
        const el2 = scrollRef.current;
        if (el2) el2.scrollTop = el2.scrollHeight - prevBottom;
      });
    } else {
      setMessages(items);
      queueMicrotask(() => forceScrollToBottom(scrollRef));
    }

    setNextCursor(data.nextCursor);

    const unknowns = [...new Set(items.map((m) => String(m.senderId)))].filter((uid) => !nameCache[uid]);
    for (const uid of unknowns) {
      try {
        const u = await fetchUser(uid);
        setNameCache((prev) => ({ ...prev, [uid]: displayName(u) }));
      } catch {}
    }

    return items;
  }

  async function openGroup(g) {
    if (active?._id) socket.emit("leave", `conversation:${active._id}`);
    setActive(g);
    socket.emit("join", `conversation:${g._id}`);

    const items = await loadMessages(g._id);
    const lastMsgIso = items?.[items.length - 1]?.createdAt || null;
    const readIso = maxIso(lastMsgIso, g?.lastMessageAt);
    if (readIso) persistLocalRead(g._id, readIso);
  }

  async function onSend({ kind, text, media }) {
    if (!active) return;
    const clientMessageId = createClientMessageId();

    const optimistic = {
      _id: `tmp_${Date.now()}`,
      conversationId: active._id,
      senderId: meId,
      kind,
      text,
      media,
      clientMessageId,
      createdAt: new Date().toISOString(),
    };
    setMessages((m) => [...m, optimistic]);
    queueMicrotask(() => forceScrollToBottom(scrollRef));

    try {
      let saved = null;

      if (socket?.connected) {
        try {
          const ack = await sendConversationViaSocket({
            socket,
            conversationId: active._id,
            kind,
            text,
            media,
            clientMessageId,
          });
          saved = ack.message;
        } catch (socketErr) {
          if (socketErr?.status && socketErr.status < 500) throw socketErr;
        }
      }

      if (!saved) {
        const res = await fetch(`${API_BASE}/conversations/${active._id}/messages`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ kind, text, media, clientMessageId }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          const err = new Error(data?.error || "Unable to send message");
          err.status = res.status;
          throw err;
        }
        saved = data;
      }

      setMessages((m) => {
        const replaced = m.map((x) => (x._id === optimistic._id ? saved : x));
        return replaced.filter(
          (x, i, arr) => arr.findIndex((y) => String(y._id) === String(x._id)) === i
        );
      });

      persistLocalRead(active._id, maxIso(saved?.createdAt, active?.lastMessageAt) || new Date().toISOString());
      queueMicrotask(() => forceScrollToBottom(scrollRef));
    } catch {
      setMessages((m) => m.filter((x) => x._id !== optimistic._id));
    }
  }

  async function addMember(user) {
    if (!active) return;
    await fetch(`${API_BASE}/conversations/${active._id}/members`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ userId: user.id }),
    });
    const fresh = await (await fetch(`${API_BASE}/conversations/${active._id}`, { headers: authHeaders() })).json();
    setActive(fresh);
    setList((ls) => ls.map((c) => (c._id === fresh._id ? fresh : c)));
  }

  async function removeMember(userId) {
    if (!active) return;
    await fetch(`${API_BASE}/conversations/${active._id}/members`, {
      method: "DELETE",
      headers: authHeaders(),
      body: JSON.stringify({ userId }),
    });
    const fresh = await (await fetch(`${API_BASE}/conversations/${active._id}`, { headers: authHeaders() })).json();
    setActive(fresh);
    setList((ls) => ls.map((c) => (c._id === fresh._id ? fresh : c)));
  }

  function openSettings() {
    if (!active) return;
    setRenameValue(active.name || "");
    const ids = getGroupMemberIds(active).map(String);
    ids.forEach(async (id) => {
      if (memberInfo[id]) return;
      try {
        const u = await fetchUser(id);
        setMemberInfo((prev) => ({ ...prev, [id]: { name: displayName(u), avatar: avatarUrl(u) } }));
      } catch {}
    });
    setShowSettings(true);
  }

  async function saveGroupName() {
    if (!active) return;
    const name = renameValue.trim();
    await fetch(`${API_BASE}/conversations/${active._id}`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ name: name || undefined }),
    });
    await loadList();
    const fresh = await (await fetch(`${API_BASE}/conversations/${active._id}`, { headers: authHeaders() })).json();
    setActive(fresh);
    setShowSettings(false);
  }

  useEffect(() => {
    if (!socket) return;

    const onNew = (msg) => {
      if (active && String(msg.conversationId) === String(active._id)) {
        setMessages((m) => (hasId(m, msg._id) ? m : [...m, msg]));
        queueMicrotask(() => forceScrollToBottom(scrollRef));

        // mark read locally for Home badge (monotonic + >= lastMessageAt)
        persistLocalRead(active._id, maxIso(msg?.createdAt, active?.lastMessageAt) || new Date().toISOString());
      }
    };

    const onTyping = ({ room, userId, on }) => {
      if (active && room === `conversation:${active._id}` && String(userId) !== String(meId)) {
        setTyping(!!on);
      }
    };

    const onConvoDeleted = ({ id }) => {
      if (active && String(active._id) === String(id)) setActive(null);
      setList((ls) => ls.filter((c) => String(c._id) !== String(id)));
    };

    socket.on("message:new", onNew);
    socket.on("typing", onTyping);
    socket.on("conversation:deleted", onConvoDeleted);
    return () => {
      socket.off("message:new", onNew);
      socket.off("typing", onTyping);
      socket.off("conversation:deleted", onConvoDeleted);
    };
  }, [socket, active, meId]);

  useLayoutEffect(() => {
    if (active?._id) forceScrollToBottom(scrollRef);
  }, [active?._id]);

  useEffect(() => {
    if (active?._id && messages.length) forceScrollToBottom(scrollRef);
  }, [messages.length, active?._id]);

  async function confirmDeleteGroup() {
    if (!active) return;
    const ok = window.confirm("Delete this group chat and all its messages? This cannot be undone.");
    if (!ok) return;
    await fetch(`${API_BASE}/conversations/${active._id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    setActive(null);
    loadList();
  }

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((g) => String(g.name || "Group Chat").toLowerCase().includes(q));
  }, [list, search]);

  return (
    <section className={`cf-panel ${active ? "is-thread-open" : ""}`}>
      <aside className="cf-sidebar">
        <div className="cf-sidebar-head">
          <div className="cf-sidebar-title-wrap">
            <div className="cf-sidebar-title">Group Chats</div>
            <span className="cf-sidebar-count">{list.length}</span>
          </div>
          <CreateGroupButton
            onCreated={(g) => {
              loadList();
              openGroup(g);
            }}
          />
        </div>
        <label className="cf-sidebar-search" aria-label="Search group chats">
          <Search size={16} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search groups..."
          />
        </label>

        {list.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No groups yet"
            subtitle="Create a private chat for your crew."
            action={<CreateGroupButton onCreated={(g) => { loadList(); openGroup(g); }} />}
          />
        ) : filteredGroups.length === 0 ? (
          <div className="cf-loading">No matches found.</div>
        ) : (
          <ul className="cf-list">
            {filteredGroups.map((g) => (
              <li key={g._id} className={`cf-list-item ${active?._id === g._id ? "is-active" : ""}`}>
                <button className="cf-li-btn" onClick={() => openGroup(g)}>
                  <div className="cf-li-row">
                    <div className="cf-group-avatar">
                      <span>{initialsOf(g.name || "G")}</span>
                    </div>
                    <div className="cf-li-text">
                      <div className="cf-li-title-row">
                        <div className="cf-li-title">{g.name || "Group Chat"}</div>
                        <div className="cf-li-time">{relativeTime(g.lastMessageAt)}</div>
                      </div>
                      <div className="cf-li-sub">
                        {(getGroupMemberIds(g).length || 0)} members · {conversationSnippet(g)}
                      </div>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="cf-thread">
        {!active ? (
          <EmptyState icon={Users} title="Open a group" subtitle="Pick a group on the left—or create one." />
        ) : (
          <>
            <ThreadHeader
              title={active.name || "Group Chat"}
              subtitle={`${getGroupMemberIds(active).length || 0} members`}
              avatarUrl=""
              onMobileBack={() => setActive(null)}
              right={
                <>
                  {canDelete({ meId, roles: meRoles, resource: active }) && (
                    <button className="cf-ghost-btn" onClick={confirmDeleteGroup}>
                      Delete
                    </button>
                  )}
                  <button className="cf-ghost-btn" title="Group settings" onClick={openSettings}>
                    <Shield size={16} />
                  </button>
                </>
              }
            />
            <div
              className="cf-thread-body"
              ref={scrollRef}
              onScroll={(e) => {
                if (e.currentTarget.scrollTop < 40 && nextCursor) loadMessages(active._id, nextCursor);
              }}
            >
              {messages.map((m) => (
                <MessageBubble
                  key={m._id}
                  me={meId}
                  msg={m}
                  userLookup={Object.fromEntries(
                    Object.entries(nameCache).map(([id, name]) => [id, { name, avatar: "" }])
                  )}
                />
              ))}
              {typing && <div className="cf-typing">Someone is typing…</div>}
            </div>

            <MessageComposer
              onSend={onSend}
              onPresign={async (file) => {
                const res = await fetch(`${API_BASE}/conversations/${active._id}/presign`, {
                  method: "POST",
                  headers: authHeaders(),
                  body: JSON.stringify({
                    fileName: file.name,
                    fileType: file.type,
                    fileSize: Number(file.size || 0)
                  }),
                });
                return res.json();
              }}
              onTypingStart={() => active && socket.emit("typing:start", `conversation:${active._id}`)}
              onTypingStop={() => active && socket.emit("typing:stop", `conversation:${active._id}`)}
            />

            {showSettings && (
              <div className="cf-modal" role="dialog" aria-modal="true">
                <div className="cf-modal-card">
                  <div className="cf-modal-head">
                    <div className="cf-modal-title">Group Settings</div>
                    <button className="cf-ghost-btn" onClick={() => setShowSettings(false)}>
                      ✕
                    </button>
                  </div>

                  <div className="cf-modal-body" style={{ gap: 16 }}>
                    <div className="cf-field">
                      <div className="cf-label">Group Name</div>
                      <input
                        className="cf-input"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        placeholder="e.g., 2015 Counselors"
                      />
                      <div>
                        <button className="cf-btn" onClick={saveGroupName}>
                          Save Name
                        </button>
                      </div>
                    </div>

                    <div className="cf-field">
                      <div className="cf-label">Members</div>
                      <ul className="pp-list">
                        {getGroupMemberIds(active).map((uid) => {
                          const id = String(uid);
                          const info = memberInfo[id];
                          const nm = info?.name || "Member";
                          const canKick =
                            canDelete({ meId, roles: meRoles, resource: active }) && String(uid) !== String(meId);
                          return (
                            <li key={id} className="pp-item" style={{ justifyContent: "space-between" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <Avatar name={nm} url={info?.avatar} size="sm" userId={id} />
                                <div className="pp-name">{nm}</div>
                              </div>
                              {canKick && (
                                <button className="cf-ghost-btn" onClick={() => removeMember(id)}>
                                  Remove
                                </button>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>

                    <div className="cf-field">
                      <div className="cf-label">Add People</div>
                      <PeoplePicker multi onSelect={(u) => addMember(u)} />
                      <div className="pp-sub">Selecting a person adds them immediately.</div>
                    </div>
                  </div>

                  <div className="cf-modal-foot">
                    <button className="cf-ghost-btn" onClick={() => setShowSettings(false)}>
                      Close
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </section>
  );
}

function CreateGroupButton({ onCreated }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    if (selected.length < 2) return;
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/conversations/group`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ name: name.trim() || undefined, participantIds: selected.map((s) => s.id) }),
      });
      const data = await res.json();
      onCreated && onCreated(data);
      setOpen(false);
      setSelected([]);
      setName("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="cf-cta" onClick={() => setOpen(true)}>
        <Plus size={16} /> New
      </button>
      {open && (
        <div className="cf-modal" role="dialog" aria-modal="true">
          <div className="cf-modal-card">
            <div className="cf-modal-head">
              <div className="cf-modal-title">New Group</div>
              <button className="cf-ghost-btn" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>
            <div className="cf-modal-body">
              <label className="cf-field" style={{ marginBottom: 10 }}>
                <div className="cf-label">Group name (optional)</div>
                <input
                  className="cf-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Alumni NYC"
                />
              </label>

              <PeoplePicker
                multi
                selected={selected}
                onSelect={(u) => {
                  setSelected((prev) =>
                    prev.some((p) => p.id === u.id) ? prev.filter((p) => p.id !== u.id) : [...prev, u]
                  );
                }}
              />
            </div>
            <div className="cf-modal-foot">
              <button className="cf-btn" disabled={busy || selected.length < 2} onClick={create}>
                {busy ? "Creating…" : "Create Group"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ======================= Forums ======================= */
function ForumsTab({ socket }) {
  const [mine, setMine] = useState(true);
  const [list, setList] = useState([]);
  const [active, setActive] = useState(null);
  const [posts, setPosts] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const scrollRef = useRef(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [authorInfo, setAuthorInfo] = useState({}); // { userId: {name, avatar} }
  const [search, setSearch] = useState("");

  // members modal state/cache
  const [showMembers, setShowMembers] = useState(false);
  const [forumMemberInfo, setForumMemberInfo] = useState({}); // { userId: { name, avatar } }

  const { id: meId, roles: meRoles } = useMemo(() => myIdentity(), []);
  const navigate = useNavigate();

  // helper: A→Z, case-insensitive (used only for All Forums)
  const sortByForumName = (arr = []) =>
    [...arr].sort((a, b) => (a?.name || "").localeCompare(b?.name || "", undefined, { sensitivity: "base" }));

  // Quick access to locally cached "me" (for instant fallback)
  const getCachedMe = () => {
    try {
      const raw = localStorage.getItem("user");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };

  async function loadList() {
    const url = new URL(`${API_BASE}/forums`);
    url.searchParams.set("mine", String(mine));
    const res = await fetch(url, { headers: authHeaders() });
    const data = await res.json();
    setList(mine ? (data.items || []) : sortByForumName(data.items || []));
  }
  useEffect(() => {
    loadList();
  }, [mine]);

  function openForum(f) {
    if (active?._id) socket.emit("leave", `forum:${active._id}`);
    setActive(f);
    socket.emit("join", `forum:${f._id}`);
    loadPosts(f._id);
  }

  async function primeAuthorCache(items) {
    const ids = [
      ...new Set((items || []).map((p) => String(p.authorId ?? p.userId ?? p.createdBy)).filter(Boolean)),
    ];

    // Optimistic fill for me (no network)
    const me = getCachedMe();
    if (me && ids.includes(String(meId)) && !authorInfo[String(meId)]) {
      setAuthorInfo((prev) => ({
        ...prev,
        [String(meId)]: { name: displayName(me), avatar: avatarUrl(me) },
      }));
    }

    const unknowns = ids.filter((id) => !authorInfo[id]);
    for (const id of unknowns) {
      try {
        const u = await fetchUser(id);
        setAuthorInfo((prev) => ({ ...prev, [id]: { name: displayName(u), avatar: avatarUrl(u) } }));
      } catch {}
    }
  }

  async function loadPosts(id, cursor) {
    const el = scrollRef.current;
    const prevBottom = el ? el.scrollHeight - el.scrollTop : 0;

    const url = new URL(`${API_BASE}/forums/${id}/posts`);
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await fetch(url, { headers: authHeaders() });
    const data = await res.json();

    if (cursor) {
      setPosts((p) => {
        const older = (data.items || []).filter((x) => !hasId(p, x._id));
        return [...older, ...p];
      });
      primeAuthorCache(data.items || []);
      queueMicrotask(() => {
        const el2 = scrollRef.current;
        if (el2) el2.scrollTop = el2.scrollHeight - prevBottom;
      });
    } else {
      setPosts(data.items || []);
      primeAuthorCache(data.items || []);
      queueMicrotask(() => forceScrollToBottom(scrollRef));
    }

    setNextCursor(data.nextCursor);
  }

  async function join(id) {
    await fetch(`${API_BASE}/forums/${id}/join`, { method: "POST", headers: authHeaders() });
    const fresh = await (await fetch(`${API_BASE}/forums/${id}`, { headers: authHeaders() })).json();
    setActive(fresh);
    loadList();
    socket.emit("join", `forum:${id}`);
  }
  async function leave(id) {
    await fetch(`${API_BASE}/forums/${id}/leave`, { method: "POST", headers: authHeaders() });
    setActive(null);
    loadList();
    socket.emit("leave", `forum:${id}`);
  }

  async function createForum() {
    if (!newName.trim()) return;
    const res = await fetch(`${API_BASE}/forums`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name: newName.trim() }),
    });
    const f = await res.json();
    setCreating(false);
    setNewName("");
    loadList();
    openForum(f);
  }

  async function onSend({ kind, text, media }) {
    if (!active) return;
    const res = await fetch(`${API_BASE}/forums/${active._id}/posts`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ kind, text, media }),
    });
    const saved = await res.json();

    // Immediately cache author (fixes "Unknown" on first paint)
    primeAuthorCache([saved]);

    setPosts((p) => (hasId(p, saved._id) ? p : [...p, saved]));
    queueMicrotask(() => forceScrollToBottom(scrollRef));
    loadList();
  }

  // open members modal & prime member cache
  function openMembers() {
    if (!active) return;
    const ids = (active.memberIds || []).map(String);
    ids.forEach(async (id) => {
      if (forumMemberInfo[id]) return;
      try {
        const u = await fetchUser(id);
        setForumMemberInfo((prev) => ({ ...prev, [id]: { name: displayName(u), avatar: avatarUrl(u) } }));
      } catch {}
    });
    setShowMembers(true);
  }

  // live forum socket listener
  useEffect(() => {
    if (!socket) return;
    const onForumPost = (post) => {
      if (active && String(post.forumId) === String(active._id)) {
        primeAuthorCache([post]);
        setPosts((p) => (hasId(p, post._id) ? p : [...p, post]));
        queueMicrotask(() => forceScrollToBottom(scrollRef));
      }
    };
    const onForumDeleted = ({ id }) => {
      if (active && String(active._id) === String(id)) setActive(null);
      setList((ls) => ls.filter((f) => String(f._id) !== String(id)));
    };
    socket.on("forum:post:new", onForumPost);
    socket.on("forum:deleted", onForumDeleted);
    return () => {
      socket.off("forum:post:new", onForumPost);
      socket.off("forum:deleted", onForumDeleted);
    };
  }, [socket, active]); // keep tight deps to avoid re-binding constantly

  // Snap to bottom when opening a forum and when count changes
  useLayoutEffect(() => {
    if (active?._id) forceScrollToBottom(scrollRef);
  }, [active?._id]);
  useEffect(() => {
    if (active?._id && posts.length) forceScrollToBottom(scrollRef);
  }, [posts.length, active?._id]);

  async function deleteForum() {
    if (!active) return;
    if (!window.confirm(`Delete the forum "${active.name}" and all its posts? This cannot be undone.`)) return;
    await fetch(`${API_BASE}/forums/${active._id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    setActive(null);
    loadList();
  }

  // membership helpers for header actions
  const isMember = (forum) => (forum?.memberIds || []).some((id) => String(id) === String(meId));
  const filteredForums = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((f) => String(f?.name || "").toLowerCase().includes(q));
  }, [list, search]);

  return (
    <section className={`cf-panel ${active ? "is-thread-open" : ""}`}>
      <aside className="cf-sidebar">
        <div className="cf-sidebar-head">
          <div className="cf-sidebar-title-wrap">
            <div className="cf-sidebar-title">Forums</div>
            <span className="cf-sidebar-count">{list.length}</span>
          </div>
          <button className="cf-cta" onClick={() => setCreating(true)}>
            <Plus size={16} /> Create
          </button>
        </div>

        <div className="cf-toggle">
          <button className={`cf-pill ${mine ? "is-active" : ""}`} onClick={() => setMine(true)}>
            My Forums
          </button>
          <button className={`cf-pill ${!mine ? "is-active" : ""}`} onClick={() => setMine(false)}>
            All Forums
          </button>
        </div>
        <label className="cf-sidebar-search" aria-label="Search forums">
          <Search size={16} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search forums..."
          />
        </label>

        {list.length === 0 ? (
          <EmptyState
            icon={Megaphone}
            title="No forums yet"
            subtitle={mine ? "You haven’t joined any forums." : "Be the first to create one!"}
          />
        ) : filteredForums.length === 0 ? (
          <div className="cf-loading">No matches found.</div>
        ) : (
          <ul className="cf-list">
            {filteredForums.map((f) => (
              <li
                key={f._id}
                className={`cf-list-item ${active?._id === f._id ? "is-active" : ""}`}
              >
                <button className="cf-li-btn" onClick={() => openForum(f)}>
                  <div className="cf-li-row">
                    <div className="cf-forum-badge">
                      <Megaphone size={14} />
                    </div>
                    <div className="cf-li-text">
                      <div className="cf-li-title-row">
                        <div className="cf-li-title">{f.name}</div>
                        <div className="cf-li-time">{relativeTime(f.lastActivityAt)}</div>
                      </div>
                      <div className="cf-li-sub">
                        {f.postsCount || 0} posts · {(f.memberIds || []).length || 0} members
                      </div>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="cf-thread">
        {!active ? (
          <EmptyState icon={Megaphone} title="Open a forum" subtitle="Pick one on the left—or create a new forum." />
        ) : (
          <>
            <ThreadHeader
              title={active.name}
              subtitle={`${(active.memberIds || []).length} members`}
              avatarUrl=""
              size="lg"
              onMobileBack={() => setActive(null)}
              right={
                <>
                  <button className="cf-ghost-btn" onClick={openMembers}>
                    Members ({(active.memberIds || []).length || 0})
                  </button>

                  {isMember(active) ? (
                    <button className="cf-ghost-btn" onClick={() => leave(active._id)}>
                      Leave
                    </button>
                  ) : (
                    <button className="cf-ghost-btn" onClick={() => join(active._id)}>
                      Join
                    </button>
                  )}

                  {canDelete({ meId, roles: meRoles, resource: active }) && (
                    <button className="cf-ghost-btn" onClick={deleteForum}>
                      Delete
                    </button>
                  )}
                </>
              }
            />

            <div
              className="cf-thread-body feed"
              ref={scrollRef}
              onScroll={(e) => {
                if (e.currentTarget.scrollTop < 40 && nextCursor) loadPosts(active._id, nextCursor);
              }}
            >
              {posts.map((p) => {
                const authorId = String(p.authorId ?? p.userId ?? p.createdBy ?? "");
                const me = getCachedMe();
                const meInstant =
                  authorId && String(authorId) === String(meId) && me
                    ? { name: displayName(me), avatar: avatarUrl(me) }
                    : null;

                const info = authorInfo[authorId] || meInstant || { name: "Unknown", avatar: "" };

                return (
                  <div className="cf-post" key={p._id}>
                    <div className="cf-post-head">
                      <div className="cf-post-meta">
                        <Avatar name={info.name} url={info.avatar} size="lg" userId={authorId} />
                        <div>
                          <div className="cf-post-author">{info.name}</div>
                          <div className="cf-post-time">{fmtDateTime(p.createdAt)}</div>
                        </div>
                      </div>
                    </div>

                    {p.kind === "text" && <div className="cf-post-body">{p.text}</div>}

                    {p.kind === "image" && (
                      <div className="cf-post-media">
                        {/* eslint-disable-next-line */}
                        <img src={p.media?.url} alt={p.media?.name || "image"} />
                      </div>
                    )}

                    {p.kind === "file" && (
                      <div className="cf-post-file">
                        <Paperclip size={16} />
                        <a href={p.media?.url} target="_blank" rel="noreferrer">
                          {p.media?.name || "file"}
                        </a>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {isMember(active) ? (
              <MessageComposer
                onSend={onSend}
                onPresign={async (file) => {
                  const res = await fetch(`${API_BASE}/forums/${active._id}/presign`, {
                    method: "POST",
                    headers: authHeaders(),
                    body: JSON.stringify({
                      fileName: file.name,
                      fileType: file.type,
                      fileSize: Number(file.size || 0)
                    }),
                  });
                  return res.json();
                }}
                labelOverride="Post"
              />
            ) : (
              <div className="cf-join-hint">Join this forum to post.</div>
            )}

            {/* Members modal */}
            {showMembers && (
              <div className="cf-modal" role="dialog" aria-modal="true">
                <div className="cf-modal-card">
                  <div className="cf-modal-head">
                    <div className="cf-modal-title">Forum Members</div>
                    <button className="cf-ghost-btn" onClick={() => setShowMembers(false)}>
                      ✕
                    </button>
                  </div>
                  <div className="cf-modal-body">
                    <ul className="pp-list">
                      {(active.memberIds || []).map((uid) => {
                        const id = String(uid);
                        const info = forumMemberInfo[id];
                        const nm = info?.name || "Member";
                        return (
                          <li
                            key={id}
                            className="pp-item"
                            onClick={() => navigate(profilePath(id))}
                            title="View profile"
                            style={{ cursor: "pointer" }}
                          >
                            <Avatar name={nm} url={info?.avatar} size="sm" userId={id} />
                            <div className="pp-name">{nm}</div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                  <div className="cf-modal-foot">
                    <button className="cf-ghost-btn" onClick={() => setShowMembers(false)}>
                      Close
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {creating && (
          <div className="cf-modal" role="dialog" aria-modal="true">
            <div className="cf-modal-card">
              <div className="cf-modal-head">
                <div className="cf-modal-title">Create Forum</div>
                <button className="cf-ghost-btn" onClick={() => setCreating(false)}>
                  ✕
                </button>
              </div>
              <div className="cf-modal-body">
                <label className="cf-field">
                  <div className="cf-label">Forum Name</div>
                  <input
                    className="cf-input"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g., Boston Alumni"
                  />
                </label>
              </div>
              <div className="cf-modal-foot">
                <button className="cf-btn" disabled={!newName.trim()} onClick={createForum}>
                  Create
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </section>
  );
}

/* ======================= Shared UI Bits ======================= */
function EmptyState({ icon, title, subtitle, action }) {
  const Icon = icon || MessageSquare;
  return (
    <div className="cf-empty">
      <Icon size={28} />
      <div className="cf-empty-title">{title}</div>
      {subtitle && <div className="cf-empty-sub">{subtitle}</div>}
      {action}
    </div>
  );
}
