import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { Bell, LogOut, Search, Repeat2 } from "lucide-react";
import { requestJson } from "../lib/http.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useMobileNotifications } from "../context/MobileNotificationsContext.jsx";
import { useTenant } from "../context/TenantContext.jsx";
import { openExternalUrl } from "../lib/externalLinks.js";
import { readAuthFromStorage } from "../lib/storage.js";
import { avatarUrl, initialsOf } from "../cedar/lib/helpers.js";
import InitialsMark from "./InitialsMark.jsx";
import {
  resolveAlumniWord,
  resolveCampAiName,
  resolveNetworkDisplayName,
  resolveNewsletterLabel,
  resolveMediaStreamLabel,
  resolveTenantLogoUrl
} from "../lib/campLabels.js";
import { isNativeApp } from "../lib/nativeApp.js";
import { tenantRoute } from "../lib/tenantRouting.js";
import cedarLogo from "../assets/cedar-logo.png";
import NotificationBadge from "./NotificationBadge.jsx";
import { preloadFullAuthRuntime } from "../lib/authRuntimePreload.js";
import { preloadRouteForPath } from "../lib/routePreload.js";
import { useMemberNavSections, pathWithCamp } from "../hooks/useMemberNav.js";
import { useEndSession } from "../hooks/useEndSession.js";

const MIN_SEARCH_CHARS = 1;

function preloadAuthDestination(path = "") {
  preloadFullAuthRuntime();
  preloadRouteForPath(path);
}

function getPhotoUrl(user = {}) {
  return avatarUrl(user);
}

function initialsFrom(fullName = "") {
  return String(fullName || "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => (word[0] || "").toUpperCase())
    .join("") || "?";
}

function firstNameFrom(user = {}) {
  return String(
    user?.firstName ||
      user?.givenName ||
      user?.given_name ||
      user?.profile?.firstName ||
      user?.profile?.givenName ||
      ""
  ).trim();
}

function lastNameFrom(user = {}) {
  return String(
    user?.lastName ||
      user?.familyName ||
      user?.family_name ||
      user?.profile?.lastName ||
      user?.profile?.familyName ||
      ""
  ).trim();
}

function fullNameFrom(user = {}) {
  const firstName = firstNameFrom(user);
  const lastName = lastNameFrom(user);
  return (
    [firstName, lastName].filter(Boolean).join(" ").trim() ||
    String(user?.fullName || "").trim() ||
    String(user?.name || "").trim()
  );
}

function tenantRelativePath(pathname = "") {
  const normalizedPath = String(pathname || "").trim() || "/";
  const tenantMatch = normalizedPath.match(/^\/t\/[^/]+(\/.*)?$/);
  if (tenantMatch) return tenantMatch[1] || "/";
  return normalizedPath;
}

function nativeMemberNavTitle(
  pathname = "",
  {
    newsletterLabel = "Newsletter",
    alumniWordTitle = "Alumni",
    aiName = "Camp AI",
    mediaStreamLabel = "Media Stream"
  } = {}
) {
  if (pathname === "/" || pathname === "/home") return "Home";
  if (pathname === "/ai") return aiName;
  if (pathname === "/my-profile") return "My Profile";
  if (pathname === "/edit-profile") return "Edit Profile";
  if (pathname === "/search" || pathname === "/search-results") return "Search";
  if (/^\/profile\/[^/]+$/.test(pathname)) return "Profile";
  if (pathname === "/photo-stream") return mediaStreamLabel;
  if (/^\/chat(?:-rooms)?(?:\/|$)/.test(pathname)) return "Messages";
  if (/^\/events(?:\/|$)/.test(pathname)) return pathname === "/events" ? "Events & Info Sessions" : "Event or Info Session";
  if (/^\/giving(?:\/|$)/.test(pathname)) return "Giving";
  if (pathname === "/notifications") return "Notifications";
  if (pathname === "/location-map") return `${alumniWordTitle} Map`;
  if (pathname === "/newsletter" || pathname === "/cedar-chest") return newsletterLabel;
  if (/^\/family-trees(?:\/|$)/.test(pathname)) return "Family Trees";
  return "PondBridge";
}

function searchSubtitleFrom(entry = {}) {
  const firstJob = Array.isArray(entry?.currentJobs) ? entry.currentJobs[0] || null : null;
  const role = String(firstJob?.role || entry?.roleAtCamp || entry?.role || "").trim();
  const company = String(firstJob?.company || entry?.company || "").trim();
  const location = String(entry?.cityState || "").trim();
  if (role && company) return `${role} • ${company}`;
  if (role) return role;
  if (company) return company;
  if (location) return location;
  return "View profile";
}

function SmartAvatar({ src = "", initials = "?", alt = "", className = "", fallbackClassName = "" }) {
  const [errored, setErrored] = useState(false);
  const normalizedSrc = String(src || "").trim();
  const showImage = Boolean(normalizedSrc) && !errored;

  useEffect(() => {
    setErrored(false);
  }, [normalizedSrc]);

  if (showImage) {
    return (
      <img
        src={normalizedSrc}
        alt={alt}
        className={className}
        loading="lazy"
        decoding="async"
        onError={() => setErrored(true)}
      />
    );
  }

  return (
    <div className={`${className} nav2-avatar-fallback ${fallbackClassName}`.trim()} aria-hidden="true">
      <InitialsMark value={initials || "?"} />
    </div>
  );
}

function ListAvatar({ person }) {
  return (
    <SmartAvatar
      src={person?.avatarUrl || ""}
      initials={initialsFrom(person?.name || "")}
      alt=""
      className="nav2-ac-avatar"
      fallbackClassName="nav2-ac-initials"
    />
  );
}

export default function NavBar({ hideBurger = false }) {
  const params = useParams();
  const { slug: contextSlug, tenant } = useTenant();
  const slug = params.slug || contextSlug || "cedar";
  const location = useLocation();
  const navigate = useNavigate();
  const { token, user, isAuthenticated, getAuthToken } = useAuth();
  const { unreadCount } = useMobileNotifications();

  const [menuOpen, setMenuOpen] = useState(false);
  const [logoError, setLogoError] = useState(false);
  const [q, setQ] = useState("");
  const [acOpen, setAcOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [active, setActive] = useState(-1);

  const menuRef = useRef(null);
  const toggleRef = useRef(null);
  const acBoxRef = useRef(null);
  const debounceRef = useRef(null);
  const searchRequestIdRef = useRef(0);
  const searchAbortRef = useRef(null);

  const config = tenant?.config || {};
  const configuredLogoUrl = resolveTenantLogoUrl(tenant);
  useEffect(() => setLogoError(false), [slug, configuredLogoUrl]);
  const modules = config.modules || tenant?.modules || {};

  const title = resolveNetworkDisplayName(tenant);
  const alumniWordTitle = resolveAlumniWord(tenant, { capitalized: true });
  const newsletterLabel = resolveNewsletterLabel(tenant);
  const mediaStreamLabel = resolveMediaStreamLabel(tenant);
  const aiName = resolveCampAiName(tenant);
  const nativeApp = isNativeApp();
  const cedarFallback = slug === "camp-cedar" || slug === "cedar" ? cedarLogo : "";
  const resolvedLogoUrl = configuredLogoUrl || cedarFallback;
  const logoUrl = logoError ? cedarFallback : resolvedLogoUrl;
  const fallbackLogoInitial = initialsFrom(title || tenant?.name || "Camp");
  const avatarSrc = getPhotoUrl(user);
  const explicitProfileInitials = initialsOf(
    firstNameFrom(user),
    lastNameFrom(user),
    user?.nickname || user?.profile?.nickname || ""
  );
  const profileInitials = explicitProfileInitials !== "?"
    ? explicitProfileInitials
    : initialsFrom(fullNameFrom(user) || String(user?.email || "").split("@")[0] || "Member");
  const canSearch = Boolean(isAuthenticated && modules.search !== false);
  const demoAccessEnabled = Boolean(tenant?.accessSettings?.demoAccessEnabled);
  const loginPath = pathWithCamp(slug, "/login");
  const createAccountPath = pathWithCamp(slug, "/create-account");
  const homePath = pathWithCamp(slug, isAuthenticated ? "/home" : "/");

  const currentPath = location.pathname || "";
  const onLoginRoute = /\/login\/?$/.test(currentPath);
  const onCreateAccountRoute = /\/create-account\/?$/.test(currentPath);
  const onAuthRoute =
    onLoginRoute ||
    onCreateAccountRoute ||
    /\/auth\/callback\/?$/.test(currentPath);
  const onPublicEntryRoute =
    currentPath === "/" ||
    currentPath === `/t/${slug}` ||
    currentPath === `/t/${slug}/`;
  const onAdminModeRoute =
    currentPath.includes(`/t/${slug}/admin`) || /^\/admin(\/|$)/.test(currentPath);
  const usePublicNav = onAuthRoute || onPublicEntryRoute;
  const currentTenantPath = tenantRelativePath(currentPath);

  const showAuthActions = !isAuthenticated || usePublicNav;
  const showPrivateTools = isAuthenticated && !usePublicNav;
  const useNativeMemberRoute = nativeApp && showPrivateTools && !onAdminModeRoute;
  const showSearch = canSearch && !usePublicNav && !onAdminModeRoute && !useNativeMemberRoute;
  const navTitle = useNativeMemberRoute
    ? nativeMemberNavTitle(currentTenantPath, { newsletterLabel, alumniWordTitle, aiName, mediaStreamLabel })
    : title;

  const menuSections = useMemberNavSections();
  const endSession = useEndSession({ onBeforeNavigate: () => closeMenus() });

  function closeMenus() {
    setMenuOpen(false);
    setAcOpen(false);
    setActive(-1);
  }

  useEffect(() => {
    if (!menuOpen) return undefined;
    function onDocClick(event) {
      const menuEl = menuRef.current;
      const toggleEl = toggleRef.current;
      if (menuEl && !menuEl.contains(event.target) && toggleEl && !toggleEl.contains(event.target)) {
        setMenuOpen(false);
      }
    }
    function onEsc(event) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [menuOpen]);

  useEffect(() => {
    function onDocClick(event) {
      if (acBoxRef.current && !acBoxRef.current.contains(event.target)) {
        setAcOpen(false);
        setActive(-1);
      }
    }
    function onEsc(event) {
      if (event.key === "Escape") {
        setAcOpen(false);
        setActive(-1);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, []);

  useEffect(
    () => () => {
      window.clearTimeout(debounceRef.current);
      if (searchAbortRef.current) {
        searchAbortRef.current.abort();
        searchAbortRef.current = null;
      }
    },
    []
  );

  useEffect(() => {
    setMenuOpen(false);
    setAcOpen(false);
    setActive(-1);
    setQ("");
    setItems([]);
    setLoading(false);
    if (searchAbortRef.current) {
      searchAbortRef.current.abort();
      searchAbortRef.current = null;
    }
    window.clearTimeout(debounceRef.current);
  }, [currentPath, location.search]);

  async function fetchNames(term) {
    const normalized = String(term || "").trim();
    if (!normalized || normalized.length < MIN_SEARCH_CHARS || !canSearch) {
      if (searchAbortRef.current) {
        searchAbortRef.current.abort();
        searchAbortRef.current = null;
      }
      setItems([]);
      setLoading(false);
      return;
    }

    if (searchAbortRef.current) {
      searchAbortRef.current.abort();
    }
    const controller = new AbortController();
    searchAbortRef.current = controller;

    const requestId = searchRequestIdRef.current + 1;
    searchRequestIdRef.current = requestId;
    setLoading(true);
    try {
      const fallbackToken = readAuthFromStorage().token || "";
      const payload = await requestJson(
        `/api/t/${slug}/search/names?q=${encodeURIComponent(normalized)}&limit=8`,
        {
          token: token || fallbackToken,
          getToken: async ({ forceRefresh = false } = {}) => {
            if (typeof getAuthToken === "function") {
              const next = await getAuthToken({ forceRefresh });
              if (next) return next;
            }
            return readAuthFromStorage().token || token || fallbackToken || "";
          },
          signal: controller.signal
        }
      );
      if (searchRequestIdRef.current !== requestId) return;
      const list = Array.isArray(payload?.items)
        ? payload.items
        : Array.isArray(payload?.results)
        ? payload.results
        : [];
      const seen = new Set();
      setItems(
        list
          .map((entry) => ({
            id: String(entry.id || entry._id || entry.profileId || entry.userId || "").trim(),
            name:
              String(entry.name || "").trim() ||
              `${entry.firstName || ""} ${entry.lastName || ""}`.trim() ||
              "Unknown",
            subtitle: searchSubtitleFrom(entry),
            avatarUrl: getPhotoUrl(entry)
          }))
          .filter((entry) => {
            if (!entry.id || entry.id === "undefined" || entry.id === "null" || seen.has(entry.id)) return false;
            seen.add(entry.id);
            return true;
          })
      );
    } catch (error) {
      if (error?.name === "AbortError") return;
      if (searchRequestIdRef.current !== requestId) return;
      setItems([]);
    } finally {
      if (searchRequestIdRef.current !== requestId) return;
      if (searchAbortRef.current === controller) {
        searchAbortRef.current = null;
      }
      setLoading(false);
    }
  }

  function onInput(event) {
    const value = event.target.value;
    const trimmed = value.trim();
    setQ(value);
    setAcOpen(trimmed.length >= MIN_SEARCH_CHARS);
    setActive(-1);
    window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      fetchNames(trimmed);
    }, 200);
  }

  function goToResults() {
    const term = q.trim();
    if (!term || !canSearch) return;
    closeMenus();
    navigate(pathWithCamp(slug, `/search?q=${encodeURIComponent(term)}`));
  }

  function goToProfile(item) {
    if (!item?.id) return;
    closeMenus();
    navigate(pathWithCamp(slug, `/profile/${item.id}`));
  }

  function onKeyDown(event) {
    if (!acOpen || (!loading && items.length === 0)) {
      if (event.key === "Enter") goToResults();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, items.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, -1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (active === -1 || active === items.length) goToResults();
      else goToProfile(items[active]);
    }
  }

  async function handleLogout() {
    return endSession();
  }

  async function handleSwitchCamp() {
    return endSession({ forgetCamp: true });
  }

  return (
    <nav
      className={`navbar2 ${nativeApp ? "is-native-app" : ""} ${onAuthRoute ? "is-auth-route" : ""} ${useNativeMemberRoute ? "is-native-member-route" : ""}`.trim()}
    >
      <div className="navbar2-left">
        <Link
          to={homePath}
          className="navbar2-logoLink"
          aria-label="Go to Home"
          onPointerEnter={() => preloadRouteForPath(homePath)}
          onFocus={() => preloadRouteForPath(homePath)}
          onTouchStart={() => preloadRouteForPath(homePath)}
        >
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={`${tenant?.name || "Camp"} logo`}
              className="navbar2-logo"
              fetchPriority="high"
              decoding="async"
              onError={() => setLogoError(true)}
            />
          ) : (
            <div
              className="nav2-ac-avatar nav2-avatar-fallback nav2-ac-initials navbar2-logo-fallback"
              aria-hidden="true"
            >
              {fallbackLogoInitial}
            </div>
          )}
        </Link>
        {/* The camp name ellipsises at narrower widths; without a title the full name is
            unrecoverable. Matches what the events calendar chips already do. */}
        <span
          className={`navbar2-title ${useNativeMemberRoute ? "is-native-page-title" : ""}`.trim()}
          title={typeof navTitle === "string" ? navTitle : undefined}
        >
          {navTitle}
        </span>
      </div>

      <div className="navbar2-right">
        {showSearch ? (
          <div className="navbar2-search">
            <div className="navbar2-search-inputWrap" ref={acBoxRef}>
              <input
                type="text"
                value={q}
                onChange={onInput}
                onFocus={() => setAcOpen(q.trim().length >= MIN_SEARCH_CHARS)}
                onKeyDown={onKeyDown}
                placeholder="Search names..."
                className="navbar2-search-input"
                aria-label="Search members"
                aria-autocomplete="list"
                aria-expanded={acOpen}
                aria-controls="member-search-suggestions"
              />
              <button className="navbar2-search-cta" onClick={goToResults} aria-label="Search">
                <Search size={16} />
              </button>

              {acOpen && q.trim().length >= MIN_SEARCH_CHARS ? (
                <ul id="member-search-suggestions" className="nav2-ac-list" role="listbox">
                  {loading ? <li className="nav2-ac-item muted">Searching...</li> : null}
                  {!loading
                    ? items.map((item, index) => (
                        <li
                          key={item.id || `${item.name}-${index}`}
                          role="option"
                          aria-selected={active === index}
                          className={`nav2-ac-item ${active === index ? "is-active" : ""}`}
                          onMouseEnter={() => setActive(index)}
                          onMouseLeave={() => setActive(-1)}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => goToProfile(item)}
                        >
                          <ListAvatar person={item} />
                          <div className="nav2-ac-text">
                            <div className="nav2-ac-name">{item.name}</div>
                            <div className="nav2-ac-job">{item.subtitle}</div>
                          </div>
                        </li>
                      ))
                    : null}
                  {!loading && items.length === 0 ? <li className="nav2-ac-item muted">No matching profiles found.</li> : null}
                  {!loading ? (
                    <li
                      role="option"
                      aria-selected={active === items.length}
                      className={`nav2-ac-item nav2-ac-searchall ${active === items.length ? "is-active" : ""}`}
                      onMouseEnter={() => setActive(items.length)}
                      onMouseLeave={() => setActive(-1)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={goToResults}
                    >
                      <Search size={14} />
                      <span>Search for "{q.trim()}"</span>
                    </li>
                  ) : null}
                </ul>
              ) : null}
            </div>
          </div>
        ) : null}

        {showAuthActions ? (
          <div className="navbar2-auth-actions">
            {!demoAccessEnabled ? (
              <button
                className={`navbar2-auth-btn ${onCreateAccountRoute ? "is-current" : ""}`.trim()}
                onPointerEnter={() => preloadAuthDestination(createAccountPath)}
                onFocus={() => preloadAuthDestination(createAccountPath)}
                onTouchStart={() => preloadAuthDestination(createAccountPath)}
                onClick={() => {
                  if (!onCreateAccountRoute) navigate(createAccountPath);
                }}
                aria-current={onCreateAccountRoute ? "page" : undefined}
              >
                Create Account
              </button>
            ) : null}
            <button
              className={`navbar2-auth-btn secondary ${onLoginRoute ? "is-current" : ""}`.trim()}
              onPointerEnter={() => preloadAuthDestination(loginPath)}
              onFocus={() => preloadAuthDestination(loginPath)}
              onTouchStart={() => preloadAuthDestination(loginPath)}
              onClick={() => {
                if (!onLoginRoute) navigate(loginPath);
              }}
              aria-current={onLoginRoute ? "page" : undefined}
            >
              Login
            </button>
          </div>
        ) : null}

        {showPrivateTools ? (
          <>
            {nativeApp ? (
              <button
                type="button"
                className="navbar2-notifications-btn"
                onClick={() => navigate(tenantRoute(slug, "/notifications"))}
                aria-label="Open mobile notifications"
              >
                <Bell size={18} />
                <NotificationBadge count={unreadCount} size="sm" floating className="navbar2-notifications-badge" />
              </button>
            ) : null}
            <button
              type="button"
              className="navbar2-profile-btn"
              onClick={() => navigate(pathWithCamp(slug, "/my-profile"))}
              aria-label="Open my profile"
            >
              <SmartAvatar
                src={avatarSrc}
                initials={profileInitials}
                alt="Profile"
                className="navbar2-profile"
                fallbackClassName="navbar2-profile-initials"
              />
            </button>

            {hideBurger ? null : (
            <div className="navbar2-menuWrap">
              <button
                ref={toggleRef}
                className={`navbar2-burger ${menuOpen ? "is-open" : ""}`}
                aria-label={menuOpen ? "Close menu" : "Open menu"}
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((prev) => !prev)}
              >
                <span className="navbar2-burger-line" />
                <span className="navbar2-burger-line" />
                <span className="navbar2-burger-line" />
              </button>

              {menuOpen ? (
                <div ref={menuRef} className="navbar2-dropdown" role="menu">
                  <div className="navbar2-dropdown-scroll">
                    {menuSections.map((section) => (
                      <div key={section.id} className="dropdown-section">
                        {section.title ? <p className="dropdown-section-title">{section.title}</p> : null}
                        {section.items.map((item) =>
                          // Internal destinations are links, not buttons. As buttons they
                          // had no href, so nothing in this menu could be opened in a new
                          // tab, middle-clicked, copied as a link, or announced as a link
                          // by a screen reader — and no section of the app had a URL a
                          // member could share. External items keep the button, because
                          // openExternalUrl() is what routes them correctly in the native app.
                          item.href ? (
                            <button
                              key={item.id}
                              onClick={() => {
                                closeMenus();
                                openExternalUrl(item.href).catch(() => {});
                              }}
                              role="menuitem"
                            >
                              <item.icon size={16} /> {item.label}
                            </button>
                          ) : (
                            <Link
                              key={item.id}
                              to={item.to}
                              onPointerEnter={() => preloadRouteForPath(item.to)}
                              onFocus={() => preloadRouteForPath(item.to)}
                              onTouchStart={() => preloadRouteForPath(item.to)}
                              onClick={() => closeMenus()}
                              role="menuitem"
                            >
                              <item.icon size={16} /> {item.label}
                            </Link>
                          )
                        )}
                      </div>
                    ))}
                    <div className="dropdown-section">
                      <p className="dropdown-section-title">Session</p>
                      {nativeApp ? (
                        <button onClick={handleSwitchCamp} role="menuitem">
                          <Repeat2 size={16} /> Switch Camp
                        </button>
                      ) : null}
                      <button onClick={handleLogout} role="menuitem">
                        <LogOut size={16} /> Log Out
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
            )}
          </>
        ) : null}
      </div>
    </nav>
  );
}
