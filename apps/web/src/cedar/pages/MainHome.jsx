// src/pages/MainHome.jsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { normalizeHeroImagePosition, normalizeHeroImageSize } from "@pondbridge/shared";
import { useTenant } from "../../context/TenantContext.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import {
  resolveAlumniWord,
  resolveNewsletterLabel,
  resolveTenantContent,
  withCampAlumniTerms
} from "../../lib/campLabels.js";
import CedarBackground from "../components/CedarBackground";
import NotificationBadge from "../../components/NotificationBadge.jsx";
import InitialsMark from "../../components/InitialsMark.jsx";
import { ModalConfirm, ModalDialog } from "../../components/admin/AdminUi.jsx";
import { useConfirmDialog } from "../../components/admin/useConfirmDialog.js";
import cedarBg from "../assets/cedar-bg.jpg";
import { API_BASE, getMe } from "../lib/api";
import { authHeaders, initialsOf, displayName, avatarUrl, getToken } from "../lib/helpers.js";
import { useUnreadChatsCount } from "../lib/unreadChats.js";
import { tenantRoute } from "../../lib/tenantRouting.js";
import {
  Users,
  MapPin,
  MessageSquare,
  ChevronRight,
  BookOpen,
  Image,
  TreePine,
  User,
  Pin as PinIcon,
  X as XIcon,
} from "lucide-react";
import CedarSkeleton from "../components/CedarSkeleton.jsx";
import "./main-home.css";

/* ================= helpers ================= */

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

const PROFILE_PROMPT_SEEN_KEY_PREFIX = "cedarProfilePromptSeen:v1";

function nonEmpty(value) {
  return String(value || "").trim();
}

function hasListValue(list = [], keys = []) {
  if (!Array.isArray(list)) return false;
  return list.some((entry) => {
    if (typeof entry === "string") return Boolean(nonEmpty(entry));
    if (!entry || typeof entry !== "object") return false;
    if (!keys.length) return Object.values(entry).some((value) => Boolean(nonEmpty(value)));
    return keys.some((key) => Boolean(nonEmpty(entry?.[key])));
  });
}

function completionPercentForProfile(profile = {}, authUser = null) {
  const hasEmail =
    hasListValue(profile?.emails || []) ||
    Boolean(nonEmpty(profile?.email)) ||
    Boolean(nonEmpty(authUser?.email)) ||
    Boolean(nonEmpty(authUser?.primaryEmailAddress?.emailAddress));
  const hasPhone =
    hasListValue(profile?.phones || []) ||
    Boolean(nonEmpty(profile?.phone));
  const hasLocation =
    Boolean(nonEmpty(profile?.cityState)) ||
    Boolean(nonEmpty(profile?.city) && (nonEmpty(profile?.state) || nonEmpty(profile?.country)));

  const checks = [
    Boolean(nonEmpty(profile?.firstName)),
    Boolean(nonEmpty(profile?.lastName)),
    hasEmail,
    hasPhone,
    hasLocation,
    Boolean(nonEmpty(profile?.roleAtCamp)),
    Boolean(nonEmpty(profile?.highSchool)),
    hasListValue(profile?.colleges || [], ["college", "major", "gradYear", "year"]),
    hasListValue(profile?.currentJobs || [], ["role", "company", "years"])
  ];

  const filled = checks.filter(Boolean).length;
  return Math.round((filled / checks.length) * 100);
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
function topCurrentJob(u = {}) {
  const j = (u.currentJobs || [])[0];
  return j ? [j.role, j.company].filter(Boolean).join(" • ") : "";
}

function normalizedRoleSet(value = {}) {
  const rawRoles = Array.isArray(value?.roles)
    ? value.roles
    : value?.roles
      ? [value.roles]
      : value?.role
        ? [value.role]
        : [];

  return new Set(
    rawRoles
      .map((role) => String(role || "").trim().toLowerCase())
      .filter(Boolean)
  );
}

function hasDirectorPrivileges(...sources) {
  const allowed = new Set(["tenant_admin", "super_admin", "admin"]);
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    const roles = normalizedRoleSet(source);
    for (const role of roles) {
      if (allowed.has(role)) return true;
    }
  }
  return false;
}

/* ============= Related Profiles ============= */
function RelatedProfilesCard({ targetUserId }) {
  const { slug } = useTenant();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [avatarErrorIds, setAvatarErrorIds] = useState(() => new Set());

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
        if (!abort) {
          setItems((data.items || []).slice(0, 5));
          setAvatarErrorIds(new Set());
        }
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
      {loading && <CedarSkeleton.Lines lines={3} />}
      {!loading && items.length === 0 && <div className="p1-empty">No related profiles yet.</div>}
      {!!items.length && (
        <ul className="p1-suggest-list">
          {items.map((u) => {
            const id = String(u._id || u.id || u.profileId || u.userId || "").trim();
            if (!id || id === "undefined" || id === "null") return null;
            const name = displayName(u);
            const job = topCurrentJob(u);
            const url = avatarUrl(u);
            const initials = initialsOf(u.firstName, u.lastName, u.nickname);
            const showImage = Boolean(url) && !avatarErrorIds.has(id);
            return (
              <li key={id} className="p1-suggest-item">
                <Link
                  to={tenantRoute(slug, `/profile/${id}`)}
                  className="p1-suggest-avatar"
                  aria-label={`Open ${name}'s profile`}
                >
                  {showImage ? (
                    <img
                      className="p1-suggest-img"
                      src={url}
                      alt={name}
                      loading="lazy"
                      decoding="async"
                      onError={() =>
                        setAvatarErrorIds((prev) => {
                          if (prev.has(id)) return prev;
                          const next = new Set(prev);
                          next.add(id);
                          return next;
                        })
                      }
                    />
                  ) : (
                    <div className="p1-suggest-fallback"><InitialsMark value={initials || "?"} /></div>
                  )}
                </Link>
                <div className="p1-suggest-main">
                  <Link to={tenantRoute(slug, `/profile/${id}`)} className="p1-suggest-name">
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
  const { slug } = useTenant();
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
        <Link to={tenantRoute(slug, "/photo-stream")} className="link-subtle">
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
              to={tenantRoute(slug, "/photo-stream")}
              className="photos-mini-item"
              title={p.caption || "Camp photo"}
            >
              <img
                src={p.thumbUrl || p.imageUrl}
                alt={p.caption || "Camp photo"}
                loading="lazy"
                decoding="async"
              />
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
function ActivityList({ items = [], currentUserId = "", isAdmin, onChanged }) {
  const { slug } = useTenant();
  const { confirm, confirmDialogProps } = useConfirmDialog();
  if (!items.length) {
    return (
      <EmptyHint
        title="No announcements yet"
        desc="When members post photos, join threads, or newsletters are added, they’ll show up here."
      />
    );
  }

  const myId = String(currentUserId || "").trim();

  async function doDelete(id) {
    if (!id) return;
    const accepted = await confirm({
      title: "Delete this post?",
      description: "The announcement will be removed from the camp feed. This cannot be undone.",
      confirmLabel: "Delete post",
    });
    if (!accepted) return;
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
    <>
      <ul className="activity-list">
      {items.map((it) => {
        const actorId = String(it.actor?.id || it.actorUserId || "").trim();
        const isMine = !!myId && actorId === myId;
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
                  <Link
                    to={String(it.target?.href || "").startsWith("/")
                      ? tenantRoute(slug, it.target.href)
                      : it.target?.href || "#"}
                    className="activity-target"
                  >
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
      <ModalConfirm {...confirmDialogProps} />
    </>
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
  const { slug } = useTenant();
  return (
    <div className="empty-hint">
      {icon ? <div className="empty-icon">{icon}</div> : null}
      <div className="empty-title">{title}</div>
      {desc ? <div className="empty-desc">{desc}</div> : null}
      {cta ? (
        <Link to={tenantRoute(slug, cta.to)} className="btn-cedar-sm">
          {cta.label}
        </Link>
      ) : null}
    </div>
  );
}

/* ================== page ================== */
export default function MainHome() {
  const navigate = useNavigate();
  const { tenant, slug } = useTenant();
  const { user: authUser } = useAuth();
  const [me, setMe] = useState(null);
  const [activity, setActivity] = useState([]);
  const [stats, setStats] = useState(null);
  const [locationsSummary, setLocationsSummary] = useState(null); // unique locations
  const firstName = useMemo(() => me?.firstName || "Welcome", [me]);
  const content = resolveTenantContent(tenant);
  const alumniWord = resolveAlumniWord(tenant);
  const alumniWordTitle = resolveAlumniWord(tenant, { capitalized: true });
  const modules = tenant?.config?.modules || tenant?.modules || {};
  const newsletterLabel = resolveNewsletterLabel(tenant);
  const heroBranding = tenant?.config?.branding || tenant?.theme || {};
  const heroImage = heroBranding.heroImageUrl || cedarBg;
  const heroImagePosition = normalizeHeroImagePosition(
    heroBranding.heroImagePositionMember || heroBranding.heroImagePosition || ""
  );
  const heroImageSize = normalizeHeroImageSize(
    heroBranding.heroImageSizeMember || heroBranding.heroImageSize || ""
  );

  // NEW: unread DM+Group badge count
  const unreadChats = useUnreadChatsCount();

  // measure the right column height so we can match the feed card to it
  const sideColRef = useRef(null);
  const sideColHeight = useElementHeight(sideColRef);
  const feedScrollRef = useRef(null);
  const [mobileFeedMaxHeight, setMobileFeedMaxHeight] = useState(null);
  const [showProfilePrompt, setShowProfilePrompt] = useState(false);
  const [profileCompletion, setProfileCompletion] = useState(100);

  useEffect(() => {
    (async () => {
      try {
        const token = getToken();
        if (!token) return navigate(tenantRoute(slug, "/login"));
        const data = await getMe(token);
        setMe(data?.user || data?.profile || data || null);
      } catch {
        navigate(tenantRoute(slug, "/login"));
      }
    })();
  }, [navigate, slug]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/home/bootstrap?activityLimit=50`, { headers: authHeaders(false) });
        if (!r.ok) return;
        const data = await r.json();
        if (cancelled) return;
        setActivity(normalizeActivityList(data?.activity || []));
        setStats(data?.stats || null);
        setLocationsSummary(data?.locations || null);
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
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

  const currentUserId = useMemo(
    () => String(authUser?.id || me?.userId || me?.id || me?._id || "").trim(),
    [authUser?.id, me?.userId, me?.id, me?._id]
  );
  const profilePromptSeenKey = useMemo(() => {
    const tenantSlug = String(tenant?.slug || "").trim().toLowerCase();
    if (!tenantSlug || !currentUserId) return "";
    return `${PROFILE_PROMPT_SEEN_KEY_PREFIX}:${tenantSlug}:${currentUserId}`;
  }, [currentUserId, tenant?.slug]);
  const isAdmin = useMemo(
    () =>
      hasDirectorPrivileges(
        authUser,
        me,
        me?.user,
        me?.profile,
        { roles: me?.accountRoles }
      ),
    [authUser, me]
  );

  const dismissProfilePrompt = useCallback(() => {
    setShowProfilePrompt(false);
    if (!profilePromptSeenKey) return;
    try {
      localStorage.setItem(profilePromptSeenKey, "1");
    } catch {
      // ignore private mode/storage quota issues
    }
  }, [profilePromptSeenKey]);

  const openEditProfileFromPrompt = useCallback(() => {
    dismissProfilePrompt();
    navigate(tenantRoute(slug, "/edit-profile"));
  }, [dismissProfilePrompt, navigate, slug]);

  useEffect(() => {
    if (!me || !currentUserId) return;
    const completion = completionPercentForProfile(me, authUser);
    setProfileCompletion(completion);
    if (completion >= 100 || !profilePromptSeenKey) return;
    try {
      if (localStorage.getItem(profilePromptSeenKey) === "1") return;
    } catch {
      // ignore private mode/storage quota issues
    }
    setShowProfilePrompt(true);
  }, [authUser, currentUserId, me, profilePromptSeenKey]);

  const locCount = resolveLocations(stats, locationsSummary);
  const quickActions = useMemo(() => {
    const preferred = [
      { key: "search", to: "/search", label: "Advanced Search", icon: Users, enabled: true },
      {
        key: "map",
        to: "/location-map",
        label: `${alumniWordTitle} Map`,
        icon: MapPin,
        enabled: modules.map !== false
      },
      {
        key: "chat",
        to: "/chat-rooms?tab=personal",
        label: "Chats & Forums",
        icon: MessageSquare,
        enabled: modules.chat !== false
      },
      {
        key: "newsletter",
        to: "/cedar-chest",
        label: newsletterLabel,
        icon: BookOpen,
        enabled: modules.newsletter !== false
      }
    ];
    const fallback = [
      {
        key: "photo-stream",
        to: "/photo-stream",
        label: "Photo Stream",
        icon: Image,
        enabled: modules.photoStream !== false
      },
      {
        key: "family-trees",
        to: "/family-trees",
        label: "Family Trees",
        icon: TreePine,
        enabled: modules.familyTrees !== false
      },
      { key: "my-profile", to: "/my-profile", label: "My Profile", icon: User, enabled: true }
    ];

    const selected = preferred.filter((action) => action.enabled);
    for (const action of fallback) {
      if (selected.length >= 4) break;
      if (action.enabled) selected.push(action);
    }
    return selected;
  }, [
    modules.chat,
    modules.familyTrees,
    modules.map,
    modules.newsletter,
    modules.photoStream,
    alumniWordTitle,
    newsletterLabel
  ]);

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
      <div className="nav-spacer" />
      <div
        className="home-masthead"
        style={{
          backgroundImage: `url(${heroImage})`,
          "--masthead-image-position": heroImagePosition,
          "--masthead-image-size": heroImageSize
        }}
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
                <img src={avatarUrl(me)} alt={displayName(me)} decoding="async" />
              ) : (
                <InitialsMark value={initialsOf(me?.firstName, me?.lastName, me?.nickname) || "?"} />
              )}
            </div>

            <div className="welcome-copy">
              <h1 className="welcome-title">
                Welcome back{me?.firstName ? `, ${firstName}` : ""}!
                <span className="title-accent" aria-hidden="true"></span>
              </h1>
              <p className="welcome-sub">
                {withCampAlumniTerms(
                  tenant,
                  content.welcomeBody ||
                    "Reconnect with bunkmates, explore alumni updates, and discover the network."
                )}
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
                  <div className="pulse-label">{alumniWordTitle}</div>
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
        {quickActions.map((action) => {
          const Icon = action.icon;
          const isChat = action.key === "chat";
          return (
            <Link
              key={action.key}
              to={tenantRoute(slug, action.to)}
              className={`qa-btn ${isChat ? "has-badge" : ""}`.trim()}
            >
              <Icon /> {action.label}
              {isChat ? (
                <NotificationBadge
                  count={unreadChats}
                  size="md"
                  tone="accent"
                  floating
                  ariaLabel={`${unreadChats} unread chats`}
                />
              ) : null}
            </Link>
          );
        })}
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
                currentUserId={currentUserId}
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

      <ModalDialog
        open={showProfilePrompt}
        title="Complete Your Profile"
        description={`Add your profile details so camp ${alumniWord} can find you and connect. You are ${profileCompletion}% complete.`}
        onClose={dismissProfilePrompt}
        backdropClassName="profile-prompt-overlay"
        className="profile-prompt-card"
        footer={
          <>
            <button type="button" className="profile-prompt-secondary" onClick={dismissProfilePrompt}>
              Maybe Later
            </button>
            <button type="button" className="profile-prompt-primary" onClick={openEditProfileFromPrompt}>
              Open Edit Profile
            </button>
          </>
        }
      />
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
