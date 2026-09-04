// src/pages/ChatsAndForums.jsx
import { useEffect, useMemo, useRef, useState, useLayoutEffect } from "react";
import CedarBackground from "../components/CedarBackground";
import CedarPageHeader from "../components/CedarPageHeader.jsx";
import { API_BASE } from "../lib/api";
import { createSocket } from "../lib/socket";
import "./chats.css";
import { MessageSquare, Users, Megaphone, Plus, Shield, ChevronLeft, Search } from "lucide-react";
import PeoplePicker from "../components/chat/PeoplePicker";
import MessageComposer from "../components/chat/MessageComposer";
import AuthenticatedAttachment from "../components/chat/AuthenticatedAttachment.jsx";
import { useTypingIndicator } from "../components/chat/useTypingIndicator.js";
import NotificationBadge from "../../components/NotificationBadge.jsx";
import InitialsMark from "../../components/InitialsMark.jsx";
import { ModalConfirm, ModalDialog, useDialogFocus } from "../../components/admin/AdminUi.jsx";
import { useConfirmDialog } from "../../components/admin/useConfirmDialog.js";
import { Link, useSearchParams, useLocation, useNavigate } from "react-router-dom";
import {
  getToken,
  authHeaders,
  displayName,
  initialsOf,
  avatarUrl,
  fmtDateTime,
  relativeTime,
  isPlaceholderAvatarUrl
} from "../lib/helpers.js";
import { markConversationRead } from "../lib/unreadChats.js";
import { readAuthFromStorage } from "../../lib/storage.js";
import { useTenant } from "../../context/TenantContext.jsx";
import { tenantRoute } from "../../lib/tenantRouting.js";

/* ======================= Helpers ======================= */
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
/** Person profile route */
function normalizeEntityId(value = "") {
  const id = String(value || "").trim();
  if (!id || id === "undefined" || id === "null") return "";
  return id;
}

function isObjectIdLike(value = "") {
  return /^[a-f0-9]{24}$/i.test(normalizeEntityId(value));
}

function normalizeConversationEntity(conversation = null) {
  if (!conversation || typeof conversation !== "object") return null;
  const id = normalizeEntityId(conversation?._id || conversation?.id);
  if (!isObjectIdLike(id)) return null;
  const participantIds = Array.isArray(conversation.participantIds)
    ? conversation.participantIds.map((entry) => normalizeEntityId(entry)).filter(isObjectIdLike)
    : [];
  const participants = Array.isArray(conversation.participants)
    ? conversation.participants
        .map((participant) => ({
          userId: normalizeEntityId(participant?.userId),
          profileId: normalizeEntityId(participant?.profileId),
          name: String(participant?.name || "Member"),
          avatarUrl: String(participant?.avatarUrl || "")
        }))
        .filter((participant) => participant.userId)
    : [];
  return { ...conversation, _id: id, id, participantIds, participants };
}

function normalizeForumEntity(forum = null) {
  if (!forum || typeof forum !== "object") return null;
  const id = normalizeEntityId(forum?._id || forum?.id);
  if (!isObjectIdLike(id)) return null;
  const memberIds = Array.isArray(forum.memberIds)
    ? forum.memberIds.map((entry) => normalizeEntityId(entry)).filter(isObjectIdLike)
    : [];
  return { ...forum, _id: id, id, memberIds };
}

const profilePath = (userId) => `/profile/${normalizeEntityId(userId)}`;

function apiErrorMessage(payload, fallback = "Request failed.") {
  if (!payload) return fallback;
  if (typeof payload === "string") return payload;
  if (typeof payload?.error?.message === "string") return payload.error.message;
  if (typeof payload?.error === "string") return payload.error;
  if (typeof payload?.message === "string") return payload.message;
  return fallback;
}

async function readJsonSafe(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

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

const SEARCH_USER_CACHE_TTL_MS = 20_000;
const SEARCH_USER_CACHE_MAX_ENTRIES = 800;
const searchUserCache = new Map();
const searchUserInFlight = new Map();

function readCachedSearchUser(id = "") {
  const key = normalizeEntityId(id);
  if (!key) return null;
  const cached = searchUserCache.get(key);
  if (!cached) return null;
  if (Date.now() >= Number(cached.expiresAt || 0)) {
    searchUserCache.delete(key);
    return null;
  }
  return cached.user || null;
}

function writeCachedSearchUser(id = "", user = null) {
  const key = normalizeEntityId(id);
  if (!key || !user) return;
  if (searchUserCache.size >= SEARCH_USER_CACHE_MAX_ENTRIES) {
    const firstKey = searchUserCache.keys().next().value;
    if (firstKey) searchUserCache.delete(firstKey);
  }
  searchUserCache.set(key, {
    expiresAt: Date.now() + SEARCH_USER_CACHE_TTL_MS,
    user
  });
}

async function fetchUser(id) {
  const safeId = normalizeEntityId(id);
  if (!isObjectIdLike(safeId)) {
    throw new Error("Invalid user id");
  }

  const cached = readCachedSearchUser(safeId);
  if (cached) return cached;

  const inFlight = searchUserInFlight.get(safeId);
  if (inFlight) return inFlight;

  const pending = (async () => {
    const res = await fetch(`${API_BASE}/search/user/${safeId}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) {
      const payload = await readJsonSafe(res);
      throw new Error(apiErrorMessage(payload, "Unable to load user."));
    }
    const data = await readJsonSafe(res);
    const user = data?.user || null;
    if (user) {
      writeCachedSearchUser(safeId, user);
      const profileId = normalizeEntityId(user?._id || user?.id);
      const userId = normalizeEntityId(user?.userId);
      if (profileId && profileId !== safeId) writeCachedSearchUser(profileId, user);
      if (userId && userId !== safeId && userId !== profileId) writeCachedSearchUser(userId, user);
    }
    return user;
  })().finally(() => {
    searchUserInFlight.delete(safeId);
  });

  searchUserInFlight.set(safeId, pending);
  return pending;
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
  const stored = readAuthFromStorage();
  const storedUser = stored?.user || {};
  const storedId = normalizeEntityId(storedUser?.id || storedUser?._id || storedUser?.userId || "");
  const storedRoles = Array.isArray(storedUser?.roles)
    ? storedUser.roles
    : storedUser?.roles
      ? [storedUser.roles]
      : [];
  const p = getJwtPayload();
  const jwtRoles = Array.isArray(p.roles) ? p.roles : p?.role ? [p.role] : [];
  const jwtId = normalizeEntityId(p?.sub || p?.userId || "");
  return {
    id: storedId || jwtId,
    roles: [...new Set([...storedRoles, ...jwtRoles])]
  };
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
  const { slug } = useTenant();
  const [broken, setBroken] = useState(false);
  const cls = ["cf-avatar", size === "sm" ? "cf-sm" : "", size === "lg" ? "cf-lg" : ""]
    .filter(Boolean)
    .join(" ");
  const safeUrl = isPlaceholderAvatarUrl(url) ? "" : url;

  useEffect(() => {
    setBroken(false);
  }, [safeUrl]);

  const showInitials = !safeUrl || broken;
  const initials = initialsOf(name);
  const safeUserId = normalizeEntityId(userId);
  const clickable = !!(safeUserId || linkTo);

  const base = showInitials ? (
    <div className={cls} style={{ cursor: clickable ? "pointer" : undefined }}>
      <InitialsMark value={initials || "?"} />
    </div>
  ) : (
    <img
      className={`${cls} cf-avatar-img`}
      src={safeUrl}
      alt={name || "avatar"}
      onError={() => setBroken(true)}
      style={{ cursor: clickable ? "pointer" : undefined }}
    />
  );

  const rawHref = linkTo || (safeUserId ? profilePath(safeUserId) : null);
  const href = String(rawHref || "").startsWith("/") ? tenantRoute(slug, rawHref) : rawHref;
  if (!href) return base;

  return (
    <Link
      to={href}
      className="cf-avatar-link"
      onClick={(e) => e.stopPropagation()}
      aria-label={name ? `Open ${name}'s profile` : "Open profile"}
      style={{ display: "inline-flex" }}
    >
      {base}
    </Link>
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
  const [realtimeStatus, setRealtimeStatus] = useState("connecting");

  useEffect(() => {
    const onConnect = () => setRealtimeStatus("connected");
    const onDisconnect = () => setRealtimeStatus("reconnecting");
    const onConnectError = () => setRealtimeStatus("reconnecting");
    const onReconnectAttempt = () => {
      socket.auth = { ...socket.auth, token: getToken() || socket.auth?.token || "" };
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        socket.disconnect();
        return;
      }
      socket.auth = { ...socket.auth, token: getToken() || socket.auth?.token || "" };
      setRealtimeStatus("connecting");
      socket.connect();
    };
    const onAnyMessage = (message) => {
      window.dispatchEvent(
        new CustomEvent("cedar:chat-message", { detail: { conversationId: message?.conversationId || "" } })
      );
    };
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.io.on("reconnect_attempt", onReconnectAttempt);
    socket.on("message:new", onAnyMessage);
    document.addEventListener("visibilitychange", onVisibilityChange);
    socket.connect();
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.io.off("reconnect_attempt", onReconnectAttempt);
      socket.off("message:new", onAnyMessage);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      socket.disconnect();
    };
  }, [socket]);

  useEffect(() => {
    const next = searchParams.get("tab");
    const normalized = next === "groups" || next === "forums" ? next : "personal";
    if (normalized !== tab) setTab(normalized);
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

        {realtimeStatus !== "connected" ? (
          <div className="cf-connection-status" role="status" aria-live="polite">
            Reconnecting live updates. You can keep sending messages.
          </div>
        ) : null}

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
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState("harassment");
  const [reportDetails, setReportDetails] = useState("");
  const [reportBusy, setReportBusy] = useState(false);
  const [reportStatus, setReportStatus] = useState("");

  async function submitReport() {
    setReportBusy(true);
    setReportStatus("");
    try {
      const response = await fetch(`${API_BASE}/safety/reports`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          targetType: "message",
          targetId: msg._id || msg.id,
          reason: reportReason,
          details: reportDetails
        })
      });
      const payload = await readJsonSafe(response);
      if (!response.ok) throw new Error(apiErrorMessage(payload, "Unable to submit this report."));
      setReportStatus(payload?.message || "Report submitted.");
      setReportDetails("");
      setReportOpen(false);
    } catch (requestError) {
      setReportStatus(requestError.message || "Unable to submit this report.");
    } finally {
      setReportBusy(false);
    }
  }

  return (
    <>
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
                  <AuthenticatedAttachment
                    media={msg.media}
                    kind="image"
                    scope="conversation"
                    resourceId={msg.conversationId}
                  />
                </div>
              )}
              {isFile && (
                <div className="cf-bubble-file">
                  <AuthenticatedAttachment
                    media={msg.media}
                    kind="file"
                    scope="conversation"
                    resourceId={msg.conversationId}
                    messageId={msg._id}
                  />
                </div>
              )}
            </div>
            <div className="cf-time">
              {time}
              {!mine && isObjectIdLike(msg?._id || msg?.id) ? (
                <button type="button" className="cf-report-btn" onClick={() => setReportOpen(true)}>
                  Report
                </button>
              ) : null}
            </div>
            {reportStatus ? <div className="cf-report-status" role="status">{reportStatus}</div> : null}
          </div>
        </div>
      </div>
      <ModalDialog
        open={reportOpen}
        title="Report this message"
        description="This report goes to the camp's directors. The sender will not be told who submitted it."
        onClose={reportBusy ? undefined : () => setReportOpen(false)}
        footer={
          <>
            <button type="button" className="link-button secondary" onClick={() => setReportOpen(false)} disabled={reportBusy}>Cancel</button>
            <button type="button" className="link-button is-danger" onClick={submitReport} disabled={reportBusy}>
              {reportBusy ? "Submitting..." : "Submit report"}
            </button>
          </>
        }
      >
        <div className="cf-report-form">
          <label>
            Reason
            <select value={reportReason} onChange={(event) => setReportReason(event.target.value)}>
              <option value="harassment">Harassment or bullying</option>
              <option value="spam">Spam or scams</option>
              <option value="privacy">Privacy concern</option>
              <option value="impersonation">Impersonation</option>
              <option value="inappropriate">Inappropriate content</option>
              <option value="safety">Immediate safety concern</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label>
            Details (optional)
            <textarea rows={4} maxLength={1200} value={reportDetails} onChange={(event) => setReportDetails(event.target.value)} />
          </label>
        </div>
      </ModalDialog>
    </>
  );
}

/* ======================= Personal (DM) ======================= */
function PersonalTab({ socket }) {
  const { slug } = useTenant();
  const { confirm, confirmDialogProps } = useConfirmDialog();
  const [list, setList] = useState([]); // DM conversations
  const [loadingList, setLoadingList] = useState(true);
  const [active, setActive] = useState(null); // active conversation object
  const [messages, setMessages] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [userCache, setUserCache] = useState({}); // { userId: {name, avatar} }
  const [titles, setTitles] = useState({}); // conversationId -> title
  const [typing, updateTyping] = useTypingIndicator();
  const [lastReadISO, setLastReadISO] = useState(null);
  const [other, setOther] = useState({ name: "", avatar: "" }); // header display
  const [search, setSearch] = useState("");
  const [actionError, setActionError] = useState("");
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
    let targetId = normalizeEntityId(searchParams.get("to") || searchParams.get("dm") || "");
    if (!targetId) {
      const m = location.pathname.match(/\/chat\/([^/?#]+)/i);
      if (m && m[1]) targetId = normalizeEntityId(m[1]);
    }
    if (!targetId) return;
    if (!isObjectIdLike(targetId)) {
      searchParams.delete("to");
      searchParams.delete("dm");
      setSearchParams(searchParams, { replace: true });
      if (/\/chat\/[^/]+/i.test(location.pathname)) {
        navigate(tenantRoute(slug, "/chat-rooms"), { replace: true });
      }
      return;
    }

    (async () => {
      try {
        setActionError("");
        const res = await fetch(`${API_BASE}/conversations/dm`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ userId: targetId }),
        });
        const convo = await readJsonSafe(res);
        if (!res.ok) {
          throw new Error(apiErrorMessage(convo, "Failed to start DM."));
        }
        const convoId = normalizeEntityId(convo?._id || convo?.id);
        if (!isObjectIdLike(convoId)) {
          throw new Error("Failed to start DM.");
        }

        await loadList();
        await onOpen(convo);
      } catch (e) {
        setActionError(String(e?.message || "Failed to start DM."));
      } finally {
        searchParams.delete("to");
        searchParams.delete("dm");
        setSearchParams(searchParams, { replace: true });

        if (/\/chat\/[^/]+/i.test(location.pathname)) {
          navigate(tenantRoute(slug, "/chat-rooms"), { replace: true });
        }
      }
    })();
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
    const iso = await markConversationRead(convoId, isoMaybe, convoLastMessageAt);
    if (!iso) return;

    // 1) socket read receipt (if backend uses sockets)
    try {
      socket.emit("read:upto", { room: `conversation:${convoId}`, iso });
    } catch {}

    // 2) update UI immediately
    clearUnreadLocally(convoId);
  }

  async function computeDMTitles(convos) {
    const map = {};
    const cacheUpdates = {};
    const resolved = await Promise.allSettled(
      (Array.isArray(convos) ? convos : []).map(async (conversation) => {
        const convoId = normalizeEntityId(conversation?._id || conversation?.id);
        const otherId = (conversation?.participantIds || [])
          .map(String)
          .find((id) => id !== String(meId));
        if (!convoId || !otherId) {
          return { convoId, otherId: "", name: "Direct Message", avatar: "" };
        }
        const participant = (conversation?.participants || []).find(
          (item) => normalizeEntityId(item?.userId) === normalizeEntityId(otherId)
        );
        if (participant) {
          return {
            convoId,
            otherId,
            name: participant.name || "Direct Message",
            avatar: participant.avatarUrl || ""
          };
        }
        const user = await fetchUser(otherId);
        return {
          convoId,
          otherId,
          name: displayName(user) || "Direct Message",
          avatar: avatarUrl(user)
        };
      })
    );
    for (const item of resolved) {
      if (item.status !== "fulfilled") continue;
      const value = item.value || {};
      if (!value.convoId) continue;
      map[value.convoId] = value.name || "Direct Message";
      if (value.otherId) {
        cacheUpdates[value.otherId] = {
          name: value.name || "Direct Message",
          avatar: value.avatar || ""
        };
      }
    }
    for (const conversation of convos || []) {
      const convoId = normalizeEntityId(conversation?._id || conversation?.id);
      if (!convoId || map[convoId]) continue;
      map[convoId] = "Direct Message";
    }
    if (Object.keys(cacheUpdates).length) {
      setUserCache((prev) => ({ ...prev, ...cacheUpdates }));
    }
    setTitles(map);
  }

  async function loadList() {
    try {
      setLoadingList(true);
      setActionError("");
      const res = await fetch(`${API_BASE}/conversations`, { headers: authHeaders() });
      const data = await readJsonSafe(res);
      if (!res.ok) {
        throw new Error(apiErrorMessage(data, "Unable to load conversations."));
      }
      const dms = (data?.items || [])
        .map((conversation) => normalizeConversationEntity(conversation))
        .filter((conversation) => conversation?.type === "dm");
      setList(dms);
      computeDMTitles(dms);
    } catch (error) {
      setList([]);
      setActionError(String(error?.message || "Unable to load conversations."));
    } finally {
      setLoadingList(false);
    }
  }

  async function loadMessages(convoId, cursor) {
    const safeConvoId = normalizeEntityId(convoId);
    if (!isObjectIdLike(safeConvoId)) {
      throw new Error("Invalid conversation id");
    }
    const el = scrollRef.current;
    const prevBottom = el ? el.scrollHeight - el.scrollTop : 0;

    const url = new URL(`${API_BASE}/conversations/${safeConvoId}/messages`);
    if (cursor) url.searchParams.set("cursor", cursor);

    const res = await fetch(url, { headers: authHeaders() });
    const data = await readJsonSafe(res);
    if (!res.ok) {
      throw new Error(apiErrorMessage(data, "Unable to load messages."));
    }
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
    const ids = [
      ...new Set((items || []).map((m) => normalizeEntityId(m?.senderId)).filter(isObjectIdLike))
    ];
    const unknowns = ids.filter((id) => !userCache[id]);
    if (!unknowns.length) return;
    const resolved = await Promise.allSettled(
      unknowns.map(async (id) => [id, await fetchUser(id)])
    );
    const updates = {};
    for (const item of resolved) {
      if (item.status !== "fulfilled") continue;
      const [id, user] = item.value || [];
      if (!id || !user) continue;
      updates[id] = { name: displayName(user), avatar: avatarUrl(user) };
    }
    if (Object.keys(updates).length) {
      setUserCache((prev) => ({ ...prev, ...updates }));
    }
  }

  async function onOpen(convo) {
    const convoId = normalizeEntityId(convo?._id || convo?.id);
    if (!isObjectIdLike(convoId)) {
      setActionError("Unable to open this conversation.");
      return;
    }
    setActionError("");
    if (active?._id) socket.emit("leave", `conversation:${active._id}`);
    const normalizedConvo = { ...convo, _id: convoId, id: convoId };
    setActive(normalizedConvo);
    setStickBottom(true);

    const otherId = (normalizedConvo.participantIds || [])
      .map((id) => normalizeEntityId(id))
      .find((id) => id && id !== String(meId));
    if (otherId) {
      const participant = (normalizedConvo?.participants || []).find(
        (item) => normalizeEntityId(item?.userId) === normalizeEntityId(otherId)
      );
      if (participant) {
        const info = {
          name: participant.name || "Direct Message",
          avatar: participant.avatarUrl || ""
        };
        setUserCache((prev) => ({ ...prev, [otherId]: info }));
        setOther(info);
      } else if (userCache[otherId]) {
        setOther(userCache[otherId]);
      } else {
        try {
          const u = await fetchUser(otherId);
          const info = { name: displayName(u), avatar: avatarUrl(u) };
          setUserCache((prev) => ({ ...prev, [otherId]: info }));
          setOther(info);
        } catch {
          setOther({ name: titles[convoId] || "Direct Message", avatar: "" });
        }
      }
    } else {
      setOther({ name: titles[convoId] || "Direct Message", avatar: "" });
    }

    socket.emit("join", `conversation:${convoId}`);

    const items = await loadMessages(convoId);
    const lastMsgIso = items?.[items.length - 1]?.createdAt || null;

    // IMPORTANT: read timestamp should be >= conversation.lastMessageAt
    const readIso = maxIso(lastMsgIso, normalizedConvo?.lastMessageAt);
    if (readIso) await markRead(convoId, readIso, normalizedConvo?.lastMessageAt);
    else clearUnreadLocally(convoId);
  }

  async function onSend({ kind, text, media, clientRequestId }) {
    const activeId = normalizeEntityId(active?._id || active?.id);
    if (!isObjectIdLike(activeId)) return;
    const clientMessageId = clientRequestId || createClientMessageId();

    const optimistic = {
      _id: `tmp_${Date.now()}`,
      conversationId: activeId,
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

      if (socket?.connected && kind === "text") {
        try {
          const ack = await sendConversationViaSocket({
            socket,
            conversationId: activeId,
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
        const res = await fetch(`${API_BASE}/conversations/${activeId}/messages`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ kind, text, media, clientMessageId }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          const err = new Error(apiErrorMessage(data, "Unable to send message"));
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
      await markRead(activeId, lastIso, active?.lastMessageAt);

      queueMicrotask(() => forceScrollToBottom(scrollRef));
    } catch (sendError) {
      setActionError(String(sendError?.message || "Unable to send message."));
      setMessages((m) => m.filter((x) => x._id !== optimistic._id));
      throw sendError;
    }
  }

  useEffect(() => {
    if (!socket) return;

    const onNew = async (msg) => {
      const isActiveConversation = active && String(msg.conversationId) === String(active._id);
      setList((previous) =>
        previous
          .map((conversation) => {
            if (String(conversation?._id) !== String(msg.conversationId)) return conversation;
            const current = Number(
              conversation.unreadCount ?? conversation.unread ?? conversation.unreadMessages ?? conversation.unseenCount ?? 0
            ) || 0;
            const unread = isActiveConversation ? 0 : current + 1;
            return {
              ...conversation,
              lastMessage: msg,
              lastMessageAt: msg?.createdAt || new Date().toISOString(),
              unreadCount: unread,
              unread,
              unreadMessages: unread,
              unseenCount: unread
            };
          })
          .sort((left, right) => toMs(right?.lastMessageAt) - toMs(left?.lastMessageAt))
      );
      if (isActiveConversation) {
        setMessages((m) => (hasId(m, msg._id) ? m : [...m, msg]));
        queueMicrotask(() => forceScrollToBottom(scrollRef));

        const lastIso = msg?.createdAt || new Date().toISOString();
        await markRead(active._id, lastIso, active?.lastMessageAt);
      }
    };

    const onTyping = ({ room, userId, on }) => {
      if (!active) return;
      if (room === `conversation:${active._id}` && String(userId) !== String(meId)) {
        updateTyping(!!on);
      }
    };

    const onReadUpto = ({ room, userId, iso }) => {
      if (!active) return;
      if (room === `conversation:${active._id}` && String(userId) !== String(meId)) {
        setLastReadISO(iso);
      }
    };

    const onConvoDeleted = ({ id }) => {
      const deletedId = normalizeEntityId(id);
      if (active && normalizeEntityId(active?._id || active?.id) === deletedId) setActive(null);
      setList((ls) => ls.filter((c) => normalizeEntityId(c?._id || c?.id) !== deletedId));
    };
    const onMessageDeleted = ({ id, conversationId }) => {
      if (normalizeEntityId(active?._id) === normalizeEntityId(conversationId)) {
        setMessages((items) => items.filter((message) => normalizeEntityId(message?._id || message?.id) !== normalizeEntityId(id)));
      }
      void loadList();
    };

    const onConnect = () => {
      void loadList();
      if (!active?._id) return;
      socket.emit("join", `conversation:${active._id}`);
      void loadMessages(active._id).catch((error) => {
        setActionError(String(error?.message || "Unable to resync this conversation."));
      });
    };

    socket.on("message:new", onNew);
    socket.on("typing", onTyping);
    socket.on("read:upto", onReadUpto);
    socket.on("conversation:deleted", onConvoDeleted);
    socket.on("message:deleted", onMessageDeleted);
    socket.on("connect", onConnect);

    return () => {
      socket.off("message:new", onNew);
      socket.off("typing", onTyping);
      socket.off("read:upto", onReadUpto);
      socket.off("conversation:deleted", onConvoDeleted);
      socket.off("message:deleted", onMessageDeleted);
      socket.off("connect", onConnect);
    };
  }, [socket, active, meId, updateTyping]);

  useEffect(() => {
    loadList();
  }, []);

  useEffect(() => {
    return () => {
      if (active?._id) socket.emit("leave", `conversation:${active._id}`);
    };
  }, [socket, active?._id]);

  useEffect(() => {
    const conversationId = normalizeEntityId(searchParams.get("conversation"));
    if (!isObjectIdLike(conversationId) || !list.length) return;
    const conversation = list.find((item) => normalizeEntityId(item?._id || item?.id) === conversationId);
    if (!conversation) return;
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("conversation");
    setSearchParams(nextParams, { replace: true });
    void onOpen(conversation);
  }, [list, searchParams]);

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
  }, [active?._id, messages.length]);

  useEffect(() => {
    if (active?._id && stickBottom) forceScrollToBottom(scrollRef);
  }, [typing, lastReadISO, active?._id, stickBottom]);

  async function deleteDM() {
    const activeId = normalizeEntityId(active?._id || active?.id);
    if (!isObjectIdLike(activeId)) return;
    const accepted = await confirm({
      title: "Delete this direct message?",
      description: "The conversation and all of its messages will be removed for everyone. This cannot be undone.",
      confirmLabel: "Delete conversation",
    });
    if (!accepted) return;
    const res = await fetch(`${API_BASE}/conversations/${activeId}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    if (!res.ok) {
      const payload = await readJsonSafe(res);
      setActionError(apiErrorMessage(payload, "Unable to delete conversation."));
      return;
    }
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
    <>
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
        {actionError ? <div className="cf-loading" role="alert">{actionError}</div> : null}

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
                  <button className="cf-li-btn" onClick={() => onOpen(c).catch((e) => setActionError(String(e?.message || "Failed to open conversation.")))}>
                    <div className="cf-li-row">
                      <Avatar name={title} url={info?.avatar} size="md" userId={otherId} />
                      <div className="cf-li-text">
                        <div className="cf-li-title-row">
                          <div className="cf-li-title">{title}</div>
                          <div className="cf-li-time">{relativeTime(c.lastMessageAt)}</div>
                        </div>
                        <div className="cf-li-sub">{conversationSnippet(c)}</div>
                      </div>
                      <NotificationBadge
                        count={unread}
                        size="sm"
                        tone="brand"
                        className="cf-unread-badge"
                        ariaLabel={`${unread} unread messages`}
                      />
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
              role="log"
              aria-live="polite"
              aria-relevant="additions"
              aria-label={other.name ? `Messages with ${other.name}` : "Direct messages"}
              style={{ scrollBehavior: "auto" }}
              onScroll={(e) => {
                const el = e.currentTarget;
                if (el.scrollTop < 40 && nextCursor) {
                  loadMessages(active._id, nextCursor).catch((error) => {
                    setActionError(String(error?.message || "Unable to load messages."));
                  });
                }
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
              {typing && <div className="cf-typing" role="status">Typing…</div>}
              {lastReadISO && <div className="cf-read" role="status">Seen up to {fmtDateTime(lastReadISO)}</div>}
            </div>

            <MessageComposer
              key={active._id}
              draftKey={`${meId}:${active._id}`}
              onSend={onSend}
              onPresign={async (file, attachment) => {
                const res = await fetch(`${API_BASE}/conversations/${active._id}/presign`, {
                  method: "POST",
                  headers: authHeaders(),
                  body: JSON.stringify({
                    fileName: file.name,
                    fileType: attachment?.mime || file.type,
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
      <ModalConfirm {...confirmDialogProps} />
    </>
  );
}

function StartDMButton({ onStarted }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState("");
  const dialogRef = useDialogFocus(open, busy ? undefined : () => setOpen(false));

  async function start() {
    if (!selected) return;
    try {
      setBusy(true);
      setError("");
      const targetId = normalizeEntityId(selected.id);
      if (!isObjectIdLike(targetId)) {
        setError("Pick a valid profile to start a DM.");
        return;
      }
      const res = await fetch(`${API_BASE}/conversations/dm`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ userId: targetId }),
      });
      const convo = await readJsonSafe(res);
      if (!res.ok) {
        throw new Error(apiErrorMessage(convo, "Unable to create DM."));
      }
      const convoId = normalizeEntityId(convo?._id || convo?.id);
      if (!isObjectIdLike(convoId)) {
        throw new Error("Unable to create DM.");
      }
      onStarted && onStarted({ ...convo, _id: convoId, id: convoId });
      setOpen(false);
      setSelected(null);
      setError("");
    } catch (err) {
      setError(String(err?.message || "Unable to create DM."));
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
        <div className="cf-modal" role="dialog" aria-modal="true" aria-labelledby="cf-start-dm-title">
          <div ref={dialogRef} className="cf-modal-card" tabIndex={-1}>
            <div className="cf-modal-head">
              <div id="cf-start-dm-title" className="cf-modal-title">Start a DM</div>
              <button className="cf-ghost-btn" onClick={() => setOpen(false)} aria-label="Close start direct message dialog">
                ✕
              </button>
            </div>
            <div className="cf-modal-body">
              <PeoplePicker onSelect={(u) => setSelected(u)} selected={selected ? [selected] : []} multi={false} />
              {error ? <div className="cf-loading">{error}</div> : null}
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
  const { confirm, confirmDialogProps } = useConfirmDialog();
  const [list, setList] = useState([]);
  const [active, setActive] = useState(null);
  const [messages, setMessages] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [nameCache, setNameCache] = useState({});
  const [typing, updateTyping] = useTypingIndicator();
  const [showSettings, setShowSettings] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [memberInfo, setMemberInfo] = useState({});
  const [search, setSearch] = useState("");
  const [actionError, setActionError] = useState("");
  const scrollRef = useRef(null);
  const [deepLinkParams, setDeepLinkParams] = useSearchParams();
  const settingsDialogRef = useDialogFocus(showSettings, () => setShowSettings(false));

  const { id: meId, roles: meRoles } = useMemo(() => myIdentity(), []);

  async function loadList() {
    try {
      setActionError("");
      const res = await fetch(`${API_BASE}/conversations`, { headers: authHeaders() });
      const data = await readJsonSafe(res);
      if (!res.ok) {
        throw new Error(apiErrorMessage(data, "Unable to load groups."));
      }
      const groups = (data?.items || [])
        .map((conversation) => normalizeConversationEntity(conversation))
        .filter((conversation) => conversation?.type === "group");
      const participantNames = {};
      for (const group of groups) {
        for (const participant of group.participants || []) {
          participantNames[participant.userId] = participant.name || "Member";
        }
      }
      setNameCache((previous) => ({ ...previous, ...participantNames }));
      setList(groups);
    } catch (error) {
      setList([]);
      setActionError(String(error?.message || "Unable to load groups."));
    }
  }

  function clearUnreadLocally(convoId) {
    setList((prev) =>
      prev.map((conversation) => {
        if (String(conversation?._id) !== String(convoId)) return conversation;
        return {
          ...conversation,
          unreadCount: 0,
          unread: 0,
          unreadMessages: 0,
          unreadMessagesCount: 0,
          unseenCount: 0,
          newCount: 0
        };
      })
    );
  }

  async function markRead(convoId, isoMaybe, convoLastMessageAt) {
    if (!convoId) return;
    const iso = await markConversationRead(convoId, isoMaybe, convoLastMessageAt);
    if (!iso) return;

    try {
      socket.emit("read:upto", { room: `conversation:${convoId}`, iso });
    } catch {}

    clearUnreadLocally(convoId);
  }

  useEffect(() => {
    loadList();
  }, []);

  useEffect(() => {
    return () => {
      if (active?._id) socket.emit("leave", `conversation:${active._id}`);
    };
  }, [socket, active?._id]);

  useEffect(() => {
    const conversationId = normalizeEntityId(deepLinkParams.get("conversation"));
    if (!isObjectIdLike(conversationId) || !list.length) return;
    const conversation = list.find((item) => normalizeEntityId(item?._id || item?.id) === conversationId);
    if (!conversation) return;
    const nextParams = new URLSearchParams(deepLinkParams);
    nextParams.delete("conversation");
    setDeepLinkParams(nextParams, { replace: true });
    void openGroup(conversation);
  }, [list, deepLinkParams]);

  async function loadMessages(id, cursor) {
    const convoId = normalizeEntityId(id);
    if (!isObjectIdLike(convoId)) {
      throw new Error("Invalid conversation id");
    }
    const el = scrollRef.current;
    const prevBottom = el ? el.scrollHeight - el.scrollTop : 0;

    const url = new URL(`${API_BASE}/conversations/${convoId}/messages`);
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await fetch(url, { headers: authHeaders() });
    const data = await readJsonSafe(res);
    if (!res.ok) {
      throw new Error(apiErrorMessage(data, "Unable to load messages."));
    }
    const items = data?.items || [];

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

    setNextCursor(data?.nextCursor || null);

    const unknowns = [
      ...new Set(items.map((m) => normalizeEntityId(m?.senderId)).filter(isObjectIdLike))
    ].filter((uid) => !nameCache[uid]);
    if (unknowns.length > 0) {
      const resolved = await Promise.allSettled(
        unknowns.map(async (uid) => [uid, await fetchUser(uid)])
      );
      const updates = {};
      for (const item of resolved) {
        if (item.status !== "fulfilled") continue;
        const [uid, user] = item.value || [];
        if (!uid || !user) continue;
        updates[uid] = displayName(user);
      }
      if (Object.keys(updates).length) {
        setNameCache((prev) => ({ ...prev, ...updates }));
      }
    }

    return items;
  }

  async function openGroup(g) {
    const normalizedGroup = normalizeConversationEntity(g);
    if (!normalizedGroup) {
      setActionError("Unable to open this group.");
      return;
    }
    const convoId = normalizedGroup._id;
    setActionError("");
    if (active?._id) socket.emit("leave", `conversation:${active._id}`);
    setActive(normalizedGroup);
    socket.emit("join", `conversation:${convoId}`);

    try {
      const items = await loadMessages(convoId);
      const lastMsgIso = items?.[items.length - 1]?.createdAt || null;
      const readIso = maxIso(lastMsgIso, normalizedGroup?.lastMessageAt);
      if (readIso) await markRead(convoId, readIso, normalizedGroup?.lastMessageAt);
      else clearUnreadLocally(convoId);
    } catch (error) {
      setActionError(String(error?.message || "Unable to load group messages."));
    }
  }

  async function onSend({ kind, text, media, clientRequestId }) {
    const activeId = normalizeEntityId(active?._id || active?.id);
    if (!isObjectIdLike(activeId)) return;
    const clientMessageId = clientRequestId || createClientMessageId();

    const optimistic = {
      _id: `tmp_${Date.now()}`,
      conversationId: activeId,
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

      if (socket?.connected && kind === "text") {
        try {
          const ack = await sendConversationViaSocket({
            socket,
            conversationId: activeId,
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
        const res = await fetch(`${API_BASE}/conversations/${activeId}/messages`, {
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

      await markRead(activeId, saved?.createdAt || new Date().toISOString(), active?.lastMessageAt);
      queueMicrotask(() => forceScrollToBottom(scrollRef));
    } catch (sendError) {
      setActionError(String(sendError?.message || "Unable to send message."));
      setMessages((m) => m.filter((x) => x._id !== optimistic._id));
      throw sendError;
    }
  }

  async function addMember(user) {
    if (!active) return;
    const activeId = normalizeEntityId(active?._id || active?.id);
    if (!isObjectIdLike(activeId)) {
      setActionError("Invalid group id.");
      return;
    }
    const targetId = normalizeEntityId(user?.id);
    if (!isObjectIdLike(targetId)) {
      setActionError("Pick a valid member.");
      return;
    }
    const res = await fetch(`${API_BASE}/conversations/${activeId}/members`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ userId: targetId }),
    });
    const payload = await readJsonSafe(res);
    if (!res.ok) {
      setActionError(apiErrorMessage(payload, "Unable to add member."));
      return;
    }
    const freshRes = await fetch(`${API_BASE}/conversations/${activeId}`, { headers: authHeaders() });
    const fresh = await readJsonSafe(freshRes);
    if (!freshRes.ok) {
      setActionError(apiErrorMessage(fresh, "Unable to refresh group."));
      return;
    }
    const freshId = normalizeEntityId(fresh?._id || fresh?.id);
    if (!isObjectIdLike(freshId)) {
      setActionError("Unable to refresh group.");
      return;
    }
    const normalizedFresh = { ...fresh, _id: freshId, id: freshId };
    setActionError("");
    setActive(normalizedFresh);
    setList((ls) =>
      ls.map((c) => (normalizeEntityId(c?._id || c?.id) === freshId ? normalizedFresh : c))
    );
  }

  async function removeMember(userId) {
    if (!active) return;
    const activeId = normalizeEntityId(active?._id || active?.id);
    if (!isObjectIdLike(activeId)) {
      setActionError("Invalid group id.");
      return;
    }
    const targetId = normalizeEntityId(userId);
    if (!isObjectIdLike(targetId)) {
      setActionError("Invalid member id.");
      return;
    }
    const res = await fetch(`${API_BASE}/conversations/${activeId}/members`, {
      method: "DELETE",
      headers: authHeaders(),
      body: JSON.stringify({ userId: targetId }),
    });
    const payload = await readJsonSafe(res);
    if (!res.ok) {
      setActionError(apiErrorMessage(payload, "Unable to remove member."));
      return;
    }
    if (String(targetId) === String(meId)) {
      socket.emit("leave", `conversation:${activeId}`);
      setActive(null);
      setShowSettings(false);
      setActionError("");
      await loadList();
      return;
    }
    const freshRes = await fetch(`${API_BASE}/conversations/${activeId}`, { headers: authHeaders() });
    const fresh = await readJsonSafe(freshRes);
    if (!freshRes.ok) {
      setActionError(apiErrorMessage(fresh, "Unable to refresh group."));
      return;
    }
    const freshId = normalizeEntityId(fresh?._id || fresh?.id);
    if (!isObjectIdLike(freshId)) {
      setActionError("Unable to refresh group.");
      return;
    }
    const normalizedFresh = { ...fresh, _id: freshId, id: freshId };
    setActionError("");
    setActive(normalizedFresh);
    setList((ls) =>
      ls.map((c) => (normalizeEntityId(c?._id || c?.id) === freshId ? normalizedFresh : c))
    );
  }

  function openSettings() {
    if (!active) return;
    setRenameValue(active.name || "");
    const participantInfo = Object.fromEntries(
      (active.participants || []).map((participant) => [
        String(participant.userId),
        { name: participant.name || "Member", avatar: participant.avatarUrl || "" }
      ])
    );
    if (Object.keys(participantInfo).length) {
      setMemberInfo((previous) => ({ ...previous, ...participantInfo }));
    }
    const ids = getGroupMemberIds(active).map(String);
    ids.forEach(async (id) => {
      if (participantInfo[id] || memberInfo[id]) return;
      try {
        const u = await fetchUser(id);
        setMemberInfo((prev) => ({ ...prev, [id]: { name: displayName(u), avatar: avatarUrl(u) } }));
      } catch {}
    });
    setShowSettings(true);
  }

  async function saveGroupName() {
    if (!active) return;
    const activeId = normalizeEntityId(active?._id || active?.id);
    if (!isObjectIdLike(activeId)) {
      setActionError("Invalid group id.");
      return;
    }
    const name = renameValue.trim();
    const res = await fetch(`${API_BASE}/conversations/${activeId}`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ name: name || undefined }),
    });
    const payload = await readJsonSafe(res);
    if (!res.ok) {
      setActionError(apiErrorMessage(payload, "Unable to update group name."));
      return;
    }
    await loadList();
    const freshRes = await fetch(`${API_BASE}/conversations/${activeId}`, { headers: authHeaders() });
    const fresh = await readJsonSafe(freshRes);
    if (!freshRes.ok) {
      setActionError(apiErrorMessage(fresh, "Unable to refresh group."));
      return;
    }
    const freshId = normalizeEntityId(fresh?._id || fresh?.id);
    if (!isObjectIdLike(freshId)) {
      setActionError("Unable to refresh group.");
      return;
    }
    setActive({ ...fresh, _id: freshId, id: freshId });
    setActionError("");
    setShowSettings(false);
  }

  async function leaveGroup() {
    if (!active) return;
    const accepted = await confirm({
      title: "Leave this group chat?",
      description: "You will stop receiving messages from this group. A member can add you again later.",
      confirmLabel: "Leave group"
    });
    if (!accepted) return;
    await removeMember(meId);
  }

  useEffect(() => {
    if (!socket) return;

    const onNew = (msg) => {
      const isActiveConversation = active && String(msg.conversationId) === String(active._id);
      setList((previous) =>
        previous
          .map((conversation) => {
            if (String(conversation?._id) !== String(msg?.conversationId)) return conversation;
            const current = Number(conversation?.unreadCount || conversation?.unread || 0);
            const unread = isActiveConversation ? 0 : current + 1;
            return {
              ...conversation,
              lastMessage: msg,
              lastMessageAt: msg?.createdAt || new Date().toISOString(),
              unreadCount: unread,
              unread
            };
          })
          .sort((left, right) => toMs(right?.lastMessageAt) - toMs(left?.lastMessageAt))
      );
      if (isActiveConversation) {
        setMessages((m) => (hasId(m, msg._id) ? m : [...m, msg]));
        queueMicrotask(() => forceScrollToBottom(scrollRef));

        void markRead(active._id, msg?.createdAt || new Date().toISOString(), active?.lastMessageAt);
      }
    };

    const onTyping = ({ room, userId, on }) => {
      if (active && room === `conversation:${active._id}` && String(userId) !== String(meId)) {
        updateTyping(!!on);
      }
    };

    const onConvoDeleted = ({ id }) => {
      const deletedId = normalizeEntityId(id);
      if (active && normalizeEntityId(active?._id || active?.id) === deletedId) setActive(null);
      setList((ls) => ls.filter((c) => normalizeEntityId(c?._id || c?.id) !== deletedId));
    };
    const onMessageDeleted = ({ id, conversationId }) => {
      if (normalizeEntityId(active?._id) === normalizeEntityId(conversationId)) {
        setMessages((items) => items.filter((message) => normalizeEntityId(message?._id || message?.id) !== normalizeEntityId(id)));
      }
      void loadList();
    };

    const onConnect = () => {
      void loadList();
      if (!active?._id) return;
      socket.emit("join", `conversation:${active._id}`);
      void loadMessages(active._id).catch((error) => {
        setActionError(String(error?.message || "Unable to resync this group chat."));
      });
    };

    socket.on("message:new", onNew);
    socket.on("typing", onTyping);
    socket.on("conversation:deleted", onConvoDeleted);
    socket.on("message:deleted", onMessageDeleted);
    socket.on("connect", onConnect);
    return () => {
      socket.off("message:new", onNew);
      socket.off("typing", onTyping);
      socket.off("conversation:deleted", onConvoDeleted);
      socket.off("message:deleted", onMessageDeleted);
      socket.off("connect", onConnect);
    };
  }, [socket, active, meId, updateTyping]);

  useLayoutEffect(() => {
    if (active?._id) forceScrollToBottom(scrollRef);
  }, [active?._id]);

  useEffect(() => {
    if (active?._id && messages.length) forceScrollToBottom(scrollRef);
  }, [messages.length, active?._id]);

  async function confirmDeleteGroup() {
    if (!active) return;
    const activeId = normalizeEntityId(active?._id || active?.id);
    if (!isObjectIdLike(activeId)) {
      setActionError("Invalid group id.");
      return;
    }
    const accepted = await confirm({
      title: "Delete this group chat?",
      description: "The group and all of its messages will be removed for every member. This cannot be undone.",
      confirmLabel: "Delete group chat",
    });
    if (!accepted) return;
    const res = await fetch(`${API_BASE}/conversations/${activeId}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    if (!res.ok) {
      const payload = await readJsonSafe(res);
      setActionError(apiErrorMessage(payload, "Unable to delete group."));
      return;
    }
    setActive(null);
    setActionError("");
    loadList();
  }

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((g) => String(g.name || "Group Chat").toLowerCase().includes(q));
  }, [list, search]);
  const canManageGroup = Boolean(
    active &&
      (
        (active.members || []).some(
          (member) => String(member?.userId || "") === String(meId) && member?.role === "owner"
        ) || isAdmin(meRoles)
      )
  );

  return (
    <>
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
              openGroup(g).catch((e) => setActionError(String(e?.message || "Failed to open group.")));
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
        {actionError ? <div className="cf-loading" role="alert">{actionError}</div> : null}

        {list.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No groups yet"
            subtitle="Create a private chat for your crew."
            action={<CreateGroupButton onCreated={(g) => { loadList(); openGroup(g).catch((e) => setActionError(String(e?.message || "Failed to open group."))); }} />}
          />
        ) : filteredGroups.length === 0 ? (
          <div className="cf-loading">No matches found.</div>
        ) : (
          <ul className="cf-list">
            {filteredGroups.map((g) => {
              const unread = Number(g.unreadCount ?? g.unread ?? g.unreadMessages ?? g.unseenCount ?? 0) || 0;
              return <li key={g._id} className={`cf-list-item ${active?._id === g._id ? "is-active" : ""}`}>
                <button className="cf-li-btn" onClick={() => openGroup(g).catch((e) => setActionError(String(e?.message || "Failed to open group.")))}>
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
                    <NotificationBadge
                      count={unread}
                      size="sm"
                      tone="brand"
                      className="cf-unread-badge"
                      ariaLabel={`${unread} unread messages`}
                    />
                  </div>
                </button>
              </li>
            })}
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
                    <button type="button" className="cf-ghost-btn" onClick={confirmDeleteGroup}>
                      Delete
                    </button>
                  )}
                  <button type="button" className="cf-ghost-btn" title="Group details" onClick={openSettings}>
                    <Shield size={16} />
                  </button>
                </>
              }
            />
            <div
              className="cf-thread-body"
              ref={scrollRef}
              role="log"
              aria-live="polite"
              aria-relevant="additions"
              aria-label={`Messages in ${active.name || "group chat"}`}
              onScroll={(e) => {
                if (e.currentTarget.scrollTop < 40 && nextCursor) {
                  loadMessages(active._id, nextCursor).catch((error) => {
                    setActionError(String(error?.message || "Unable to load messages."));
                  });
                }
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
              {typing && <div className="cf-typing" role="status">Someone is typing…</div>}
            </div>

            <MessageComposer
              key={active._id}
              draftKey={`${meId}:${active._id}`}
              onSend={onSend}
              onPresign={async (file, attachment) => {
                const res = await fetch(`${API_BASE}/conversations/${active._id}/presign`, {
                  method: "POST",
                  headers: authHeaders(),
                  body: JSON.stringify({
                    fileName: file.name,
                    fileType: attachment?.mime || file.type,
                    fileSize: Number(file.size || 0)
                  }),
                });
                return res.json();
              }}
              onTypingStart={() => active && socket.emit("typing:start", `conversation:${active._id}`)}
              onTypingStop={() => active && socket.emit("typing:stop", `conversation:${active._id}`)}
            />

            {showSettings && (
              <div className="cf-modal" role="dialog" aria-modal="true" aria-labelledby="cf-group-settings-title">
                <div ref={settingsDialogRef} className="cf-modal-card" tabIndex={-1}>
                  <div className="cf-modal-head">
                    <div id="cf-group-settings-title" className="cf-modal-title">
                      {canManageGroup ? "Group Settings" : "Group Details"}
                    </div>
                    <button type="button" className="cf-ghost-btn" onClick={() => setShowSettings(false)} aria-label="Close group details">
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
                        maxLength={100}
                        disabled={!canManageGroup}
                      />
                      {canManageGroup ? <div>
                        <button type="button" className="cf-btn" onClick={() => saveGroupName().catch((e) => setActionError(String(e?.message || "Failed to save group name.")))}>
                          Save Name
                        </button>
                      </div> : null}
                    </div>

                    <div className="cf-field">
                      <div className="cf-label">Members</div>
                      <ul className="pp-list">
                        {getGroupMemberIds(active).map((uid) => {
                          const id = String(uid);
                          const info = memberInfo[id];
                          const nm = info?.name || "Member";
                          const canKick =
                            canManageGroup && String(uid) !== String(meId);
                          return (
                            <li key={id} className="pp-item" style={{ justifyContent: "space-between" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <Avatar name={nm} url={info?.avatar} size="sm" userId={id} />
                                <div className="pp-name">{nm}</div>
                              </div>
                              {canKick && (
                                <button type="button" className="cf-ghost-btn" onClick={() => removeMember(id).catch((e) => setActionError(String(e?.message || "Failed to remove member.")))}>
                                  Remove
                                </button>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>

                    {canManageGroup ? <div className="cf-field">
                      <div className="cf-label">Add People</div>
                      <PeoplePicker multi onSelect={(u) => addMember(u).catch((e) => setActionError(String(e?.message || "Failed to add member.")))} />
                      <div className="pp-sub">Selecting a person adds them immediately.</div>
                    </div> : null}
                  </div>

                  <div className="cf-modal-foot">
                    <button type="button" className="cf-ghost-btn is-danger" onClick={leaveGroup}>
                      Leave group
                    </button>
                    <button type="button" className="cf-ghost-btn" onClick={() => setShowSettings(false)}>
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
      <ModalConfirm {...confirmDialogProps} />
    </>
  );
}

function CreateGroupButton({ onCreated }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useDialogFocus(open, busy ? undefined : () => setOpen(false));

  async function create() {
    if (selected.length < 2) return;
    setBusy(true);
    try {
      setError("");
      const participantIds = [
        ...new Set(
          selected
            .map((person) => normalizeEntityId(person?.id))
            .filter((id) => isObjectIdLike(id))
        )
      ];
      if (participantIds.length < 2) {
        setError("Select at least 2 valid members.");
        return;
      }
      const res = await fetch(`${API_BASE}/conversations/group`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ name: name.trim() || undefined, participantIds }),
      });
      const data = await readJsonSafe(res);
      if (!res.ok) {
        throw new Error(apiErrorMessage(data, "Unable to create group."));
      }
      const convoId = normalizeEntityId(data?._id || data?.id);
      if (!isObjectIdLike(convoId)) {
        throw new Error("Unable to create group.");
      }
      onCreated && onCreated(data);
      setOpen(false);
      setSelected([]);
      setName("");
      setError("");
    } catch (err) {
      setError(String(err?.message || "Unable to create group."));
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
        <div className="cf-modal" role="dialog" aria-modal="true" aria-labelledby="cf-create-group-title">
          <div ref={dialogRef} className="cf-modal-card" tabIndex={-1}>
            <div className="cf-modal-head">
              <div id="cf-create-group-title" className="cf-modal-title">New Group</div>
              <button className="cf-ghost-btn" onClick={() => setOpen(false)} aria-label="Close new group dialog">
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
                  placeholder="e.g., Camp NYC"
                  maxLength={100}
                />
              </label>

              <PeoplePicker
                multi
                selected={selected}
                onSelect={(u) => {
                  const targetId = normalizeEntityId(u?.id || u?._id);
                  if (!targetId) return;
                  setSelected((prev) =>
                    prev.some((p) => normalizeEntityId(p?.id || p?._id) === targetId)
                      ? prev.filter((p) => normalizeEntityId(p?.id || p?._id) !== targetId)
                      : [...prev, { ...u, id: targetId, _id: targetId }]
                  );
                }}
              />
              {error ? <div className="cf-loading">{error}</div> : null}
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
  const { slug } = useTenant();
  const { confirm, confirmDialogProps } = useConfirmDialog();
  const [forumParams, setForumParams] = useSearchParams();
  const [mine, setMine] = useState(() => !isObjectIdLike(forumParams.get("forum")));
  const [list, setList] = useState([]);
  const [active, setActive] = useState(null);
  const [posts, setPosts] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const scrollRef = useRef(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [authorInfo, setAuthorInfo] = useState({}); // { userId: {name, avatar} }
  const [search, setSearch] = useState("");
  const [actionError, setActionError] = useState("");

  // members modal state/cache
  const [showMembers, setShowMembers] = useState(false);
  const [forumMemberInfo, setForumMemberInfo] = useState({}); // { userId: { name, avatar } }
  const membersDialogRef = useDialogFocus(showMembers, () => setShowMembers(false));
  const createDialogRef = useDialogFocus(creating, () => setCreating(false));

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
    try {
      setActionError("");
      const url = new URL(`${API_BASE}/forums`);
      url.searchParams.set("mine", String(mine));
      const res = await fetch(url, { headers: authHeaders() });
      const data = await readJsonSafe(res);
      if (!res.ok) {
        throw new Error(apiErrorMessage(data, "Unable to load forums."));
      }
      const normalizedItems = (data?.items || [])
        .map((forum) => normalizeForumEntity(forum))
        .filter(Boolean);
      setList(mine ? normalizedItems : sortByForumName(normalizedItems));
    } catch (error) {
      setList([]);
      setActionError(String(error?.message || "Unable to load forums."));
    }
  }
  useEffect(() => {
    loadList();
  }, [mine]);

  useEffect(() => {
    return () => {
      if (active?._id) socket.emit("leave", `forum:${active._id}`);
    };
  }, [socket, active?._id]);

  useEffect(() => {
    const forumId = normalizeEntityId(forumParams.get("forum"));
    if (!isObjectIdLike(forumId) || !list.length) return;
    const forum = list.find((item) => normalizeEntityId(item?._id || item?.id) === forumId);
    if (!forum) return;
    const nextParams = new URLSearchParams(forumParams);
    nextParams.delete("forum");
    setForumParams(nextParams, { replace: true });
    void openForum(forum);
  }, [list, forumParams]);

  async function openForum(f) {
    const forumId = normalizeEntityId(f?._id || f?.id);
    if (!isObjectIdLike(forumId)) {
      setActionError("Unable to open this forum.");
      return;
    }
    setActionError("");
    if (active?._id) socket.emit("leave", `forum:${active._id}`);
    const normalizedForum = { ...f, _id: forumId, id: forumId };
    setActive(normalizedForum);
    socket.emit("join", `forum:${forumId}`);
    try {
      await loadPosts(forumId);
    } catch (error) {
      setPosts([]);
      setActionError(String(error?.message || "Unable to load forum posts."));
    }
  }

  async function primeAuthorCache(items) {
    const ids = [
      ...new Set(
        (items || [])
          .map((p) => normalizeEntityId(p.authorId ?? p.userId ?? p.createdBy))
          .filter(Boolean)
      ),
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
    if (unknowns.length === 0) return;
    const resolved = await Promise.allSettled(
      unknowns.map(async (id) => [id, await fetchUser(id)])
    );
    const updates = {};
    for (const item of resolved) {
      if (item.status !== "fulfilled") continue;
      const [id, user] = item.value || [];
      if (!id || !user) continue;
      updates[id] = { name: displayName(user), avatar: avatarUrl(user) };
    }
    if (Object.keys(updates).length) {
      setAuthorInfo((prev) => ({ ...prev, ...updates }));
    }
  }

  async function loadPosts(id, cursor) {
    const forumId = normalizeEntityId(id);
    if (!isObjectIdLike(forumId)) {
      throw new Error("Invalid forum id");
    }
    const el = scrollRef.current;
    const prevBottom = el ? el.scrollHeight - el.scrollTop : 0;

    const url = new URL(`${API_BASE}/forums/${forumId}/posts`);
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await fetch(url, { headers: authHeaders() });
    const data = await readJsonSafe(res);
    if (!res.ok) {
      throw new Error(apiErrorMessage(data, "Unable to load posts."));
    }

    const nextItems = (data?.items || []).filter((item) => normalizeEntityId(item?._id || item?.id));

    if (cursor) {
      setPosts((p) => {
        const older = nextItems.filter((x) => !hasId(p, x._id));
        return [...older, ...p];
      });
      primeAuthorCache(nextItems);
      queueMicrotask(() => {
        const el2 = scrollRef.current;
        if (el2) el2.scrollTop = el2.scrollHeight - prevBottom;
      });
    } else {
      setPosts(nextItems);
      primeAuthorCache(nextItems);
      queueMicrotask(() => forceScrollToBottom(scrollRef));
    }

    setNextCursor(data?.nextCursor || null);
  }

  async function join(id) {
    const forumId = normalizeEntityId(id);
    if (!isObjectIdLike(forumId)) {
      setActionError("Invalid forum id.");
      return;
    }
    const joinRes = await fetch(`${API_BASE}/forums/${forumId}/join`, {
      method: "POST",
      headers: authHeaders()
    });
    const joinPayload = await readJsonSafe(joinRes);
    if (!joinRes.ok) {
      setActionError(apiErrorMessage(joinPayload, "Unable to join forum."));
      return;
    }
    const freshRes = await fetch(`${API_BASE}/forums/${forumId}`, { headers: authHeaders() });
    const fresh = await readJsonSafe(freshRes);
    if (!freshRes.ok) {
      setActionError(apiErrorMessage(fresh, "Unable to refresh forum."));
      return;
    }
    setActionError("");
    const normalizedFresh = normalizeForumEntity(fresh);
    if (!normalizedFresh) {
      setActionError("Unable to refresh forum.");
      return;
    }
    setActive(normalizedFresh);
    loadList();
    socket.emit("join", `forum:${forumId}`);
  }
  async function leave(id) {
    const forumId = normalizeEntityId(id);
    if (!isObjectIdLike(forumId)) {
      setActionError("Invalid forum id.");
      return;
    }
    const leaveRes = await fetch(`${API_BASE}/forums/${forumId}/leave`, {
      method: "POST",
      headers: authHeaders()
    });
    const leavePayload = await readJsonSafe(leaveRes);
    if (!leaveRes.ok) {
      setActionError(apiErrorMessage(leavePayload, "Unable to leave forum."));
      return;
    }
    setActionError("");
    setActive(null);
    loadList();
    socket.emit("leave", `forum:${forumId}`);
  }

  async function createForum() {
    if (!newName.trim()) return;
    const res = await fetch(`${API_BASE}/forums`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name: newName.trim() }),
    });
    const f = await readJsonSafe(res);
    if (!res.ok) {
      setActionError(apiErrorMessage(f, "Unable to create forum."));
      return;
    }
    const forumId = normalizeEntityId(f?._id || f?.id);
    if (!isObjectIdLike(forumId)) {
      setActionError("Unable to create forum.");
      return;
    }
    const normalizedForum = normalizeForumEntity({ ...f, _id: forumId, id: forumId });
    if (!normalizedForum) {
      setActionError("Unable to create forum.");
      return;
    }
    setActionError("");
    setCreating(false);
    setNewName("");
    loadList();
    openForum(normalizedForum).catch((e) => setActionError(String(e?.message || "Failed to open forum.")));
  }

  async function onSend({ kind, text, media, clientRequestId }) {
    if (!active) return;
    const activeId = normalizeEntityId(active?._id || active?.id);
    if (!isObjectIdLike(activeId)) {
      const error = new Error("Invalid forum id.");
      setActionError(error.message);
      throw error;
    }
    const res = await fetch(`${API_BASE}/forums/${activeId}/posts`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ kind, text, media, clientPostId: clientRequestId }),
    });
    const saved = await readJsonSafe(res);
    if (!res.ok) {
      const error = new Error(apiErrorMessage(saved, "Unable to post message."));
      setActionError(error.message);
      throw error;
    }
    setActionError("");

    // Immediately cache author (fixes "Unknown" on first paint)
    if (!normalizeEntityId(saved?._id || saved?.id)) {
      const error = new Error("Unable to post message.");
      setActionError(error.message);
      throw error;
    }
    primeAuthorCache([saved]);

    setPosts((p) => (hasId(p, saved._id) ? p : [...p, saved]));
    queueMicrotask(() => forceScrollToBottom(scrollRef));
    loadList();
  }

  // open members modal & prime member cache
  function openMembers() {
    if (!active) return;
    const ids = (active.memberIds || []).map((id) => normalizeEntityId(id)).filter(Boolean);
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
      const postForumId = normalizeEntityId(post?.forumId);
      setList((previous) =>
        previous.map((forum) =>
          normalizeEntityId(forum?._id || forum?.id) === postForumId
            ? {
                ...forum,
                postsCount: Number(forum?.postsCount || 0) + 1,
                lastActivityAt: post?.createdAt || new Date().toISOString()
              }
            : forum
        )
      );
      if (
        active &&
        postForumId === normalizeEntityId(active?._id) &&
        normalizeEntityId(post?._id || post?.id)
      ) {
        primeAuthorCache([post]);
        setPosts((p) => (hasId(p, post._id) ? p : [...p, post]));
        queueMicrotask(() => forceScrollToBottom(scrollRef));
      }
    };
    const onForumDeleted = ({ id }) => {
      const deletedId = normalizeEntityId(id);
      if (active && normalizeEntityId(active?._id) === deletedId) setActive(null);
      setList((ls) => ls.filter((f) => normalizeEntityId(f?._id || f?.id) !== deletedId));
    };
    const onForumPostDeleted = ({ id, forumId }) => {
      if (normalizeEntityId(active?._id) === normalizeEntityId(forumId)) {
        setPosts((items) => items.filter((post) => normalizeEntityId(post?._id || post?.id) !== normalizeEntityId(id)));
      }
      void loadList();
    };
    const onConnect = () => {
      void loadList();
      if (!active?._id) return;
      socket.emit("join", `forum:${active._id}`);
      void loadPosts(active._id).catch((error) => {
        setActionError(String(error?.message || "Unable to resync this forum."));
      });
    };
    socket.on("forum:post:new", onForumPost);
    socket.on("forum:deleted", onForumDeleted);
    socket.on("forum:post:deleted", onForumPostDeleted);
    socket.on("connect", onConnect);
    return () => {
      socket.off("forum:post:new", onForumPost);
      socket.off("forum:deleted", onForumDeleted);
      socket.off("forum:post:deleted", onForumPostDeleted);
      socket.off("connect", onConnect);
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
    const activeId = normalizeEntityId(active?._id || active?.id);
    if (!isObjectIdLike(activeId)) {
      setActionError("Invalid forum id.");
      return;
    }
    const accepted = await confirm({
      title: `Delete “${active.name}”?`,
      description: "The forum and all of its posts will be permanently removed.",
      confirmLabel: "Delete forum",
    });
    if (!accepted) return;
    const res = await fetch(`${API_BASE}/forums/${activeId}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    if (!res.ok) {
      const payload = await readJsonSafe(res);
      setActionError(apiErrorMessage(payload, "Unable to delete forum."));
      return;
    }
    setActionError("");
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
    <>
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
        {actionError ? <div className="cf-loading" role="alert">{actionError}</div> : null}

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
                <button className="cf-li-btn" onClick={() => openForum(f).catch((e) => setActionError(String(e?.message || "Failed to open forum.")))}>
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
                    <button className="cf-ghost-btn" onClick={() => leave(active._id).catch((e) => setActionError(String(e?.message || "Failed to leave forum.")))}>
                      Leave
                    </button>
                  ) : (
                    <button className="cf-ghost-btn" onClick={() => join(active._id).catch((e) => setActionError(String(e?.message || "Failed to join forum.")))}>
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
              role="log"
              aria-live="polite"
              aria-relevant="additions"
              aria-label={`Posts in ${active.name || "forum"}`}
              onScroll={(e) => {
                if (e.currentTarget.scrollTop < 40 && nextCursor) {
                  loadPosts(active._id, nextCursor).catch((error) => {
                    setActionError(String(error?.message || "Unable to load posts."));
                  });
                }
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
                        <AuthenticatedAttachment
                          media={p.media}
                          kind="image"
                          scope="forum"
                          resourceId={p.forumId || active._id}
                        />
                      </div>
                    )}

                    {p.kind === "file" && (
                      <div className="cf-post-file">
                        <AuthenticatedAttachment
                          media={p.media}
                          kind="file"
                          scope="forum"
                          resourceId={p.forumId || active._id}
                          messageId={p._id}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {isMember(active) ? (
              <MessageComposer
                key={active._id}
                draftKey={`${meId}:${active._id}`}
                maxLength={8000}
                onSend={onSend}
                onPresign={async (file, attachment) => {
                  const res = await fetch(`${API_BASE}/forums/${active._id}/presign`, {
                    method: "POST",
                    headers: authHeaders(),
                    body: JSON.stringify({
                      fileName: file.name,
                      fileType: attachment?.mime || file.type,
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
              <div className="cf-modal" role="dialog" aria-modal="true" aria-labelledby="cf-forum-members-title">
                <div ref={membersDialogRef} className="cf-modal-card" tabIndex={-1}>
                  <div className="cf-modal-head">
                    <div id="cf-forum-members-title" className="cf-modal-title">Forum Members</div>
                    <button className="cf-ghost-btn" onClick={() => setShowMembers(false)} aria-label="Close forum members">
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
                            onClick={() => {
                              const safeId = normalizeEntityId(id);
                              if (!safeId) return;
                              navigate(tenantRoute(slug, profilePath(safeId)));
                            }}
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
          <div className="cf-modal" role="dialog" aria-modal="true" aria-labelledby="cf-create-forum-title">
            <div ref={createDialogRef} className="cf-modal-card" tabIndex={-1}>
              <div className="cf-modal-head">
                <div id="cf-create-forum-title" className="cf-modal-title">Create Forum</div>
                <button className="cf-ghost-btn" onClick={() => setCreating(false)} aria-label="Close create forum dialog">
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
                    placeholder="e.g., Boston Camp"
                    maxLength={100}
                  />
                </label>
              </div>
              <div className="cf-modal-foot">
                <button className="cf-btn" disabled={!newName.trim()} onClick={createForum}>
                  Create
                </button>
              </div>
              {actionError ? <div className="cf-loading" style={{ padding: "0 20px 16px" }}>{actionError}</div> : null}
            </div>
          </div>
        )}
      </section>
      </section>
      <ModalConfirm {...confirmDialogProps} />
    </>
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
