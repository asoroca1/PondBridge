// src/pages/MainHome.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTenant } from "../../context/TenantContext.jsx";
import { resolveNewsletterLabel, resolveTenantContent } from "../../lib/campLabels.js";
import Navbar2 from "../components/Navbar2";
import CedarBackground from "../components/CedarBackground";
import cedarField from "../assets/cedar-field.jpeg";
import { API_BASE, getMe } from "../lib/api";
import {
  Users,
  MapPin,
  MessageSquare,
  ChevronRight,
  BookOpen,
  Pin as PinIcon,
  X as XIcon,
} from "lucide-react";
import "./main-home.css";

/* ================= helpers ================= */
function authHeaders(json = true) {
  const t = localStorage.getItem("token");
  const h = {};
  if (json) h["Content-Type"] = "application/json";
  if (t) h["Authorization"] = `Bearer ${t}`;
  return h;
}

function normalizeActorName(name) {
  const s = String(name || "").trim();
  // Matches: First "Nick" Last
  const m = s.match(/^(.+?)\s+"([^"]+)"\s+(.+)$/);
  if (!m) return s;

  const first = m[1].trim();
  const nick = m[2].trim();
  const last = m[3].trim();

  if (!nick) return `${first} ${last}`.trim();

  const f = first.toLowerCase();
  const l = last.toLowerCase();
  const n = nick.toLowerCase();

  // If the quoted nickname duplicates first or last, drop it
  if (n === f || n === l) return `${first} ${last}`.trim();

  return `${first} "${nick}" ${last}`.trim();
}

/* ---------- unread chats (localStorage) ---------- */
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

function computeUnreadThreads(conversations = []) {
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

function useUnreadChatsCount({ pollMs = 25000 } = {}) {
  const [count, setCount] = useState(0);

  async function refresh() {
    const token = localStorage.getItem("token");
    if (!token) {
      setCount(0);
      return;
    }
    try {
      const r = await fetch(`${API_BASE}/conversations`, { headers: authHeaders(false) });
      if (!r.ok) return;
      const data = await r.json();
      const items = Array.isArray(data.items) ? data.items : [];
      setCount(computeUnreadThreads(items));
    } catch {
      // silent
    }
  }

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return count;
}

/* measure an element's content height reactively */
function useElementHeight(ref) {
  const [h, setH] = useState(null);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r?.height) setH(Math.round(r.height));
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return h;
}

/* ============= name/avatars ============= */
function initialsOf(first = "", last = "", nick = "") {
  const s = [first, nick, last].filter(Boolean).join(" ").trim();
  return s
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || "")
    .join("");
}
function safeNickname(u = {}) {
  const nick = String(u?.nickname || "").trim();
  if (!nick) return "";
  const f = String(u?.firstName || "").trim().toLowerCase();
  const l = String(u?.lastName || "").trim().toLowerCase();
  const n = nick.toLowerCase();

  // If nickname is just a duplicate of first/last, treat it as "not set"
  if (n === f || n === l) return "";
  return nick;
}

function displayName(u = {}) {
  const nick = safeNickname(u);
  return nick
    ? `${u.firstName || ""} "${nick}" ${u.lastName || ""}`.trim()
    : `${u?.firstName || ""} ${u?.lastName || ""}`.trim();
}

function avatarUrl(u = {}) {
  return u?.uploads?.photoUrl || u?.photoUrl || u?.profilePhotoUrl || "";
}
function topCurrentJob(u = {}) {
  const j = (u.currentJobs || [])[0];
  return j ? [j.role, j.company].filter(Boolean).join(" • ") : "";
}

/* admin allow-list (UI-only; server still enforces) */
const ADMIN_EMAILS = ["aden@sorocafamily.com"];

/* ============= Related Profiles ============= */
function RelatedProfilesCard({ targetUserId }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let abort = false;
    (async () => {
      try {
        if (!targetUserId) {
          if (!abort) {
            setItems([]);
            setLoading(false);
          }
          return;
        }
        setLoading(true);
        const qs = new URLSearchParams({ forUserId: String(targetUserId), limit: "5" });
        const r = await fetch(`${API_BASE}/suggestions?${qs.toString()}`, { headers: authHeaders() });
        if (!r.ok) throw new Error("suggestions fetch failed");
        const data = await r.json();
        if (!abort) setItems((data.items || []).slice(0, 5));
      } catch (e) {
        console.error(e);
      } finally {
        if (!abort) setLoading(false);
      }
    })();
    return () => {
      abort = true;
    };
  }, [targetUserId]);

  return (
    <aside className="p1-card">
      <div className="card-head">
        <h3>Related Profiles</h3>
      </div>
      {loading && <div className="p1-empty">Loading…</div>}
      {!loading && items.length === 0 && <div className="p1-empty">No related profiles yet.</div>}
      {!!items.length && (
        <ul className="p1-suggest-list">
          {items.map((u) => {
            const id = u._id || u.id;
            const name = displayName(u);
            const job = topCurrentJob(u);
            const url = avatarUrl(u);
            const initials = initialsOf(u.firstName, u.lastName, u.nickname);
            return (
              <li key={id} className="p1-suggest-item">
                <Link
                  to={`/profile/${id}`}
                  className="p1-suggest-avatar"
                  aria-label={`Open ${name}'s profile`}
                >
                  {url ? (
                    <img className="p1-suggest-img" src={url} alt={name} />
                  ) : (
                    <div className="p1-suggest-fallback">{initials || "?"}</div>
                  )}
                </Link>
                <div className="p1-suggest-main">
                  <Link to={`/profile/${id}`} className="p1-suggest-name">
                    {name}
                  </Link>
                  <div className="p1-suggest-sub">{job}</div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}

/* ============= Photo Stream (latest two) ============= */
function PhotosPreviewCard() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/photos?sort=new&limit=2`, {
          headers: authHeaders(false),
        });
        if (!r.ok) return;
        const data = await r.json();
        setItems(data.items || []);
      } catch {}
    })();
  }, []);

  return (
    <div className="p1-card">
      <div className="card-head">
        <h3>Photo Stream</h3>
        <Link to="/photo-stream" className="link-subtle">
          Open photos <ChevronRight size={16} />
        </Link>
      </div>
      {!items.length ? (
        <div className="p1-empty">Be the first to post a photo.</div>
      ) : (
        <div className="photos-mini">
          {items.map((p) => (
            <Link
              key={p._id || p.id}
              to="/photo-stream"
              className="photos-mini-item"
              title={p.caption || "Camp photo"}
            >
              <img src={p.thumbUrl || p.imageUrl} alt={p.caption || "Camp photo"} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Announce form ---------- */
function AnnouncementForm({ onPosted }) {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    const text = msg.trim();
    if (!text) return;
    try {
      setBusy(true);
      const r = await fetch(`${API_BASE}/activity`, {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ message: text }),
      });
      if (r.ok) {
        const created = await r.json();
        setMsg("");
        onPosted?.(created);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="announce-form" onSubmit={submit}>
      <input
        className="announce-input"
        type="text"
        placeholder="Share a quick announcement…"
        maxLength={500}
        value={msg}
        onChange={(e) => setMsg(e.target.value)}
      />
      <button className="announce-btn" disabled={!msg.trim() || busy}>
        Post
      </button>
    </form>
  );
}

/* ============ feed list ============ */
function ActivityList({ items = [], me, isAdmin, onChanged }) {
  if (!items.length) {
    return (
      <EmptyHint
        title="No announcements yet"
        desc="When alumni post photos, join threads, or newsletters are added, they’ll show up here."
      />
    );
  }

  const myId = me?._id || me?.id;

  async function doDelete(id) {
    if (!id) return;
    if (!window.confirm("Delete this post?")) return;
    try {
      const r = await fetch(`${API_BASE}/activity/${id}`, {
        method: "DELETE",
        headers: authHeaders(false),
      });
      if (r.ok) onChanged?.({ kind: "delete", id });
    } catch {}
  }

  async function togglePin(it) {
    try {
      const r = await fetch(`${API_BASE}/activity/${it.id}/pin`, {
        method: "PATCH",
        headers: authHeaders(true),
        body: JSON.stringify({ pinned: !it.pinned }),
      });
      if (r.ok) {
        const updated = await r.json(); // { id, pinned }
        onChanged?.({ kind: "pin", id: updated.id, pinned: updated.pinned });
      }
    } catch {}
  }

  return (
    <ul className="activity-list">
      {items.map((it) => {
        const isMine = String(it.actor?.id) === String(myId);
        const canDelete = isMine || !!isAdmin;

        return (
          <li key={it.id || `${it.type}-${it.ts}`} className="activity-item">
            <div className="activity-main">
              {it.type === "announcement.post" ? (
                <>
                  <div className="activity-headline">
                    <span className="activity-actor">{it.actor?.name || "Someone"}</span>
                  </div>
                  <div className="activity-bubble">{it.message || ""}</div>
                </>
              ) : (
                <>
                  <span className="activity-actor">
                    {(it.type === "user.join"
                      ? normalizeActorName(it.actor?.name)
                      : it.actor?.name) || "Someone"}
                  </span>{" "}
                  {renderVerb(it.type)}{" "}
                  <Link to={it.target?.href || "#"} className="activity-target">
                    {it.target?.label || it.target?.title || it.target?.name || "the app"}
                  </Link>
                </>
              )}
            </div>        

            <div className="activity-meta">
              <div className="activity-time">
                {it.pinned ? <PinIcon size={14} className="pin-ind" aria-hidden="true" /> : null}
                {timeAgo(it.ts)}
              </div>
              {(canDelete || isAdmin) && (
                <div className="activity-actions">
                  {isAdmin && (
                    <button
                      className="icon-btn"
                      onClick={() => togglePin(it)}
                      title={it.pinned ? "Unpin" : "Pin"}
                      aria-label={it.pinned ? "Unpin" : "Pin"}
                    >
                      <PinIcon size={16} />
                    </button>
                  )}
                  {canDelete && (
                    <button
                      className="icon-btn"
                      onClick={() => doDelete(it.id)}
                      title="Delete"
                      aria-label="Delete"
                    >
                      <XIcon size={16} />
                    </button>
                  )}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function renderVerb(type) {
  switch (type) {
    case "photo.upload":
      return "posted a photo in";
    case "thread.new":
      return "started the thread";
    case "cedarchest.publish":
      return "published";
    case "user.join":
      return "joined the network";
    default:
      return "did something in";
  }
}

function timeAgo(ts) {
  if (!ts) return "";
  const d = Math.max(0, Date.now() - new Date(ts).getTime());
  const min = Math.floor(d / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function normalizeActivityItem(item = {}) {
  return {
    ...item,
    id: item?.id || item?._id || item?.activityId || null,
    ts: item?.ts || item?.createdAt || item?.updatedAt || new Date().toISOString(),
    pinned: Boolean(item?.pinned),
  };
}

function normalizeActivityList(payload) {
  const items = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.items)
    ? payload.items
    : [];
  return items.map(normalizeActivityItem);
}

/* ============ empty hint ============ */
function EmptyHint({ icon, title, desc, cta }) {
  return (
    <div className="empty-hint">
      {icon ? <div className="empty-icon">{icon}</div> : null}
      <div className="empty-title">{title}</div>
      {desc ? <div className="empty-desc">{desc}</div> : null}
      {cta ? (
        <Link to={cta.to} className="btn-cedar-sm">
          {cta.label}
        </Link>
      ) : null}
    </div>
  );
}

/* ================== page ================== */
export default function MainHome() {
  const navigate = useNavigate();
  const { tenant } = useTenant();
  const [me, setMe] = useState(null);
  const [activity, setActivity] = useState([]);
  const [stats, setStats] = useState(null);
  const [locationsSummary, setLocationsSummary] = useState(null); // unique locations
  const firstName = useMemo(() => me?.firstName || "Welcome", [me]);
  const content = resolveTenantContent(tenant);
  const modules = tenant?.config?.modules || tenant?.modules || {};
  const newsletterLabel = resolveNewsletterLabel(tenant);
  const heroImage = tenant?.config?.branding?.heroImageUrl || cedarField;

  // NEW: unread DM+Group badge count
  const unreadChats = useUnreadChatsCount();

  // measure the right column height so we can match the feed card to it
  const sideColRef = useRef(null);
  const sideColHeight = useElementHeight(sideColRef);
  const feedScrollRef = useRef(null);
  const [mobileFeedMaxHeight, setMobileFeedMaxHeight] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const token = localStorage.getItem("token");
        if (!token) return navigate("/login");
        const data = await getMe(token);
        setMe(data?.user || data?.profile || data || null);
      } catch {
        navigate("/login");
      }
    })();
  }, [navigate]);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/activity?limit=50`, { headers: authHeaders(false) });
        if (r.ok) setActivity(normalizeActivityList(await r.json()));
      } catch {}
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/stats/home`, { headers: authHeaders(false) });
        if (r.ok) setStats(await r.json());
      } catch {}
    })();
  }, []);

  // dedicated unique locations summary
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/stats/locations`, { headers: authHeaders(false) });
        if (r.ok) setLocationsSummary(await r.json());
      } catch {}
    })();
  }, []);

  function onAnnouncementPosted(created) {
    setActivity((prev) => [normalizeActivityItem(created), ...normalizeActivityList(prev)]);
  }

  function onActivityChanged(evt) {
    if (evt.kind === "delete") {
      setActivity((prev) => normalizeActivityList(prev).filter((x) => String(x.id) !== String(evt.id)));
      return;
    }
    if (evt.kind === "pin") {
      setActivity((prev) =>
        normalizeActivityList(prev).map((x) =>
          String(x.id) === String(evt.id)
            ? { ...x, pinned: !!evt.pinned, pinnedAt: evt.pinned ? new Date().toISOString() : null }
            : evt.pinned
            ? { ...x, pinned: false, pinnedAt: null } // exclusive: unpin all others in UI
            : x
        )
      );
    }
  }

  const isAdmin = useMemo(() => {
    const email = me?.email || me?.user?.email || me?.profile?.email;
    return email ? ADMIN_EMAILS.includes(email.toLowerCase()) : false;
  }, [me]);

  const locCount = resolveLocations(stats, locationsSummary);

  // newest-first (API already returns pinned first, then newest)
  const activitySorted = useMemo(() => {
    return normalizeActivityList(activity).sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      const pa = a.pinnedAt ? new Date(a.pinnedAt).getTime() : 0;
      const pb = b.pinnedAt ? new Date(b.pinnedAt).getTime() : 0;
      if (pa !== pb) return pb - pa;
      return new Date(b.ts).getTime() - new Date(a.ts).getTime();
    });
  }, [activity]);
  const hasFeedOverflow = activitySorted.length > 5;

  useEffect(() => {
    function shouldCapFeed() {
      if (typeof window === "undefined") return false;
      return window.matchMedia("(max-width: 900px)").matches;
    }

    function recalcFeedHeight() {
      const scroller = feedScrollRef.current;
      if (!scroller || !shouldCapFeed()) {
        setMobileFeedMaxHeight(null);
        return;
      }

      const rows = Array.from(scroller.querySelectorAll(".activity-item"));
      if (!rows.length) {
        setMobileFeedMaxHeight(null);
        return;
      }

      const visibleCount = Math.min(5, rows.length);
      let nextHeight = 0;
      for (let i = 0; i < visibleCount; i += 1) {
        nextHeight += rows[i].offsetHeight;
      }

      const list = scroller.querySelector(".activity-list");
      if (list) {
        const borderTop = parseFloat(window.getComputedStyle(list).borderTopWidth || "0");
        nextHeight += borderTop;
      }

      setMobileFeedMaxHeight(Math.ceil(nextHeight));
    }

    const rafId = window.requestAnimationFrame(recalcFeedHeight);
    window.addEventListener("resize", recalcFeedHeight);
    window.addEventListener("orientationchange", recalcFeedHeight);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", recalcFeedHeight);
      window.removeEventListener("orientationchange", recalcFeedHeight);
    };
  }, [activitySorted]);

  return (
    <div className="home-wrap">
      <CedarBackground behavior="fixed" opacity={1} zIndex={0} />
      <Navbar2 />
      <div className="nav-spacer" />
      <div
        className="home-masthead"
        style={{ backgroundImage: `url(${heroImage})` }}
        role="img"
        aria-label={`${tenant?.name || "Camp"} field`}
      />

      {/* ====== HERO ====== */}
      <section className="welcome-hero">
        <div className="welcome-banner">
          {/* left: avatar + copy */}
          <div className="welcome-left">
            <div className="welcome-avatar">
              {avatarUrl(me) ? (
                <img src={avatarUrl(me)} alt={displayName(me)} />
              ) : (
                <span>{initialsOf(me?.firstName, me?.lastName, me?.nickname) || "?"}</span>
              )}
            </div>

            <div className="welcome-copy">
              <h1 className="welcome-title">
                Welcome back{me?.firstName ? `, ${firstName}` : ""}!
                <span className="title-accent" aria-hidden="true"></span>
              </h1>
              <p className="welcome-sub">
                {content.welcomeBody ||
                  "Reconnect with bunkmates, explore alumni updates, and discover the network."}
              </p>
            </div>
          </div>

          {/* right: Community Pulse */}
          <aside className="welcome-right">
            <div className="pulse-card">
              <div className="pulse-head">Community Pulse</div>
              <div className="pulse-rows">
                <div className="pulse-row">
                  <div className="pulse-num">{formatK(stats?.totalAlumni)}</div>
                  <div className="pulse-label">Alumni</div>
                </div>
                <div className="pulse-row">
                  <div className="pulse-num">{formatK(locCount)}</div>
                  <div className="pulse-label">Locations</div>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </section>

      {/* ====== QUICK ACTIONS ====== */}
      <section className="quick-actions">
        <Link to="/search" className="qa-btn">
          <Users /> Advanced Search
        </Link>
        {modules.map !== false ? (
          <Link to="/location-map" className="qa-btn">
            <MapPin /> Alumni Map
          </Link>
        ) : null}

        {modules.chat !== false ? (
          <Link
            to="/chat-rooms?tab=personal"
            className="qa-btn"
            style={{ position: "relative" }}
          >
            <MessageSquare /> Chats & Forums
            {unreadChats > 0 && (
              <span
                aria-label={`${unreadChats} unread chats`}
                style={{
                  position: "absolute",
                  top: -8,
                  right: -8,
                  minWidth: 18,
                  height: 18,
                  padding: "0 6px",
                  borderRadius: 999,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 12,
                  fontWeight: 700,
                  lineHeight: "18px",
                  background: "#e11d48",
                  color: "#fff",
                  border: "2px solid rgba(255,255,255,0.95)",
                  boxShadow: "0 2px 10px rgba(0,0,0,0.25)",
                }}
              >
                {unreadChats > 99 ? "99+" : unreadChats}
              </span>
            )}
          </Link>
        ) : null}

        {modules.newsletter !== false ? (
          <Link to="/cedar-chest" className="qa-btn">
            <BookOpen /> {newsletterLabel}
          </Link>
        ) : null}
      </section>

      {/* ====== CONTENT ====== */}
      <main className="content-grid">
        <section className="main-col">
        <div
          className="p1-card feed-card"
          style={sideColHeight ? { "--feed-card-h": `${sideColHeight}px` } : undefined}
        >

            <div className="card-head">
              <h3>Feed</h3>
            </div>
            <AnnouncementForm onPosted={onAnnouncementPosted} />
            {/* Scrollable feed area */}
            <div
              className={`feed-scroll ${mobileFeedMaxHeight ? "feed-scroll-mobile" : ""} ${mobileFeedMaxHeight && hasFeedOverflow ? "feed-scroll-has-overflow" : ""}`}
              ref={feedScrollRef}
              style={mobileFeedMaxHeight ? { "--mobile-feed-h": `${mobileFeedMaxHeight}px` } : undefined}
            >
              <ActivityList
                items={activitySorted}
                me={me}
                isAdmin={isAdmin}
                onChanged={onActivityChanged}
              />
            </div>
          </div>
        </section>

        <aside className="side-col" ref={sideColRef}>
          <PhotosPreviewCard />
          <RelatedProfilesCard targetUserId={me?._id || me?.id} />
        </aside>
      </main>
    </div>
  );
}

/* utils */
function formatK(n) {
  if (n === null || n === undefined) return "—";
  if (n < 1000) return String(n);
  const v = (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1);
  return `${v}k`;
}

/* Unique locations resolver */
function resolveLocations(stats, summary) {
  const direct =
    stats?.totalLocations ??
    stats?.distinctLocations ??
    stats?.uniqueLocations ??
    summary?.totalLocations ??
    summary?.distinctLocations ??
    summary?.uniqueLocations;

  if (typeof direct === "number") return direct;
  if (direct != null && !Number.isNaN(Number(direct))) return Number(direct);

  const dict =
    stats?.alumniByLocation ||
    stats?.locationsByAlumni ||
    summary?.alumniByLocation ||
    summary?.byLocation;
  if (dict && typeof dict === "object" && !Array.isArray(dict)) {
    return Object.keys(dict).length;
  }

  const arr =
    stats?.locationsList ||
    stats?.uniqueLocationList ||
    summary?.locationsList ||
    summary?.uniqueLocationList ||
    summary?.allLocations ||
    summary?.locations;

  if (Array.isArray(arr) && arr.length) {
    if (typeof arr[0] === "object") {
      const names = arr
        .map((x) => x?.name ?? x?.label ?? x?.cityState ?? x?.city ?? x?.id)
        .filter(Boolean);
      if (names.length) return new Set(names).size;
    } else if (typeof arr[0] === "string") {
      return new Set(arr).size;
    }
  }

  return 0;
}
