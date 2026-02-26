import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  BookOpen,
  Home,
  Image,
  LogOut,
  Map,
  MessageSquare,
  Shirt,
  Search,
  Settings,
  Shield,
  TreePine,
  User,
  Pencil,
  Scale
} from "lucide-react";
import { requestJson } from "../lib/http.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useTenant } from "../context/TenantContext.jsx";
import { tenantHasFeature } from "../lib/features.js";
import { readAuthFromStorage } from "../lib/storage.js";
import {
  resolveNetworkDisplayName,
  resolveNewsletterLabel,
  resolveTenantContent
} from "../lib/campLabels.js";
import { inferCampSlugFromHost, isPotentialCustomTenantHost } from "../lib/domain.js";
import cedarLogo from "../assets/cedar-logo.png";

const MIN_SEARCH_CHARS = 1;

function getPhotoUrl(user = {}) {
  return (
    user?.uploads?.photoUrl ||
    user?.photoUrl ||
    user?.profilePhotoUrl ||
    user?.profile?.avatarUrl ||
    ""
  );
}

function initialsFrom(fullName = "") {
  return String(fullName || "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => (word[0] || "").toUpperCase())
    .join("") || "?";
}

function fullNameFrom(user = {}) {
  return (
    String(user?.fullName || "").trim() ||
    [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() ||
    String(user?.name || "").trim()
  );
}

function pathWithCamp(slug, path) {
  const nextPath = String(path || "/").startsWith("/") ? path : `/${path}`;
  const hostScopedTenant = Boolean(inferCampSlugFromHost() || isPotentialCustomTenantHost());
  if (hostScopedTenant) {
    return nextPath;
  }
  return `/t/${slug}${nextPath}`;
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

function normalizedRoleSet(user = {}) {
  const rawRoles = Array.isArray(user?.roles)
    ? user.roles
    : user?.roles
      ? [user.roles]
      : user?.role
        ? [user.role]
        : [];
  return new Set(rawRoles.map((role) => String(role || "").trim().toLowerCase()).filter(Boolean));
}

function SmartAvatar({ src = "", initials = "?", alt = "", className = "", fallbackClassName = "" }) {
  const [errored, setErrored] = useState(false);
  const normalizedSrc = String(src || "").trim();
  const showImage = Boolean(normalizedSrc) && !errored;

  useEffect(() => {
    setErrored(false);
  }, [normalizedSrc]);

  if (showImage) {
    return <img src={normalizedSrc} alt={alt} className={className} onError={() => setErrored(true)} />;
  }

  return (
    <div className={`${className} nav2-avatar-fallback ${fallbackClassName}`.trim()} aria-hidden="true">
      {initials || "?"}
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

export default function NavBar() {
  const params = useParams();
  const { slug: contextSlug, tenant } = useTenant();
  const slug = params.slug || contextSlug || "cedar";
  const location = useLocation();
  const navigate = useNavigate();
  const { token, user, isAuthenticated, logout, getAuthToken } = useAuth();

  const [menuOpen, setMenuOpen] = useState(false);
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
  const branding = config.branding || tenant?.theme || {};
  const modules = config.modules || tenant?.modules || {};
  const roleSet = normalizedRoleSet(user);

  const isCampDirector = roleSet.has("tenant_admin") || roleSet.has("super_admin") || roleSet.has("admin");
  const needsOnboarding = tenant?.onboardingStatus !== "live";

  const title = resolveNetworkDisplayName(tenant);
  const newsletterLabel = resolveNewsletterLabel(tenant);
  const content = resolveTenantContent(tenant);
  const merchShopUrl = String(content.merchShopUrl || "").trim() || "https://thecampspot.com/camphome.aspx";
  const logoUrl = branding.logoUrl || (slug === "camp-cedar" || slug === "cedar" ? cedarLogo : "");
  const fallbackLogoInitial = initialsFrom(tenant?.name || "Camp");
  const avatarSrc = getPhotoUrl(user);
  const profileInitials = initialsFrom(fullNameFrom(user) || user?.email || "");
  const canSearch = Boolean(isAuthenticated && modules.search !== false);
  const canFamilyTrees = Boolean(modules.familyTrees !== false && tenantHasFeature(tenant, "familyTrees"));
  const loginPath = pathWithCamp(slug, "/login");
  const createAccountPath = pathWithCamp(slug, "/create-account");

  const currentPath = location.pathname || "";
  const onLoginRoute = /\/login\/?$/.test(currentPath);
  const onCreateAccountRoute = /\/create-account\/?$/.test(currentPath);
  const onAuthRoute =
    onLoginRoute ||
    onCreateAccountRoute ||
    /\/auth\/callback\/?$/.test(currentPath) ||
    /\/request-access\/?$/.test(currentPath);
  const onPublicEntryRoute =
    currentPath === "/" ||
    currentPath === `/t/${slug}` ||
    currentPath === `/t/${slug}/`;
  const onAdminModeRoute =
    currentPath.includes(`/t/${slug}/admin`) || /^\/admin(\/|$)/.test(currentPath);
  const usePublicNav = onAuthRoute || onPublicEntryRoute;

  const showSearch = canSearch && !usePublicNav && !onAdminModeRoute;
  const showAuthActions = !isAuthenticated || usePublicNav;
  const showPrivateTools = isAuthenticated && !usePublicNav;

  const menuSections = useMemo(() => {
    if (!isAuthenticated) return [];

    const accountItems = [
      { id: "home", icon: Home, label: "Home", to: pathWithCamp(slug, "/home") },
      { id: "profile", icon: User, label: "My Profile", to: pathWithCamp(slug, "/my-profile") },
      { id: "edit", icon: Pencil, label: "Edit Profile", to: pathWithCamp(slug, "/edit-profile") }
    ];
    if (canSearch) {
      accountItems.push({
        id: "search",
        icon: Search,
        label: "Advanced Search",
        to: pathWithCamp(slug, "/search")
      });
    }

    const communityItems = [];
    if (modules.photoStream !== false) {
      communityItems.push({
        id: "photos",
        icon: Image,
        label: "Photo Stream",
        to: pathWithCamp(slug, "/photo-stream")
      });
    }
    if (modules.chat !== false) {
      communityItems.push({
        id: "chat",
        icon: MessageSquare,
        label: "Chats and Forums",
        to: pathWithCamp(slug, "/chat-rooms?tab=personal")
      });
    }
    if (modules.map !== false) {
      communityItems.push({ id: "map", icon: Map, label: "Alumni Map", to: pathWithCamp(slug, "/location-map") });
    }
    if (canFamilyTrees) {
      communityItems.push({
        id: "trees",
        icon: TreePine,
        label: "Family Trees",
        to: pathWithCamp(slug, "/family-trees")
      });
    }
    if (modules.newsletter !== false) {
      communityItems.push({
        id: "chest",
        icon: BookOpen,
        label: newsletterLabel,
        to: pathWithCamp(slug, "/cedar-chest")
      });
    }
    if (modules.merchShop !== false) {
      communityItems.push({ id: "merch", icon: Shirt, label: "Merch Shop", href: merchShopUrl });
    }

    const adminItems = [];
    if (isCampDirector) {
      if (needsOnboarding) {
        adminItems.push({
          id: "setup",
          icon: Settings,
          label: "Setup Wizard",
          to: pathWithCamp(slug, "/onboarding")
        });
      }
      adminItems.push({
        id: "admin",
        icon: Shield,
        label: "Director Dashboard",
        to: pathWithCamp(slug, "/admin")
      });
    }

    const sections = [];
    if (accountItems.length) sections.push({ id: "account", title: "Account", items: accountItems });
    if (communityItems.length) sections.push({ id: "community", title: "Community", items: communityItems });
    if (adminItems.length) sections.push({ id: "admin-tools", title: "Director", items: adminItems });
    sections.push({
      id: "policy",
      title: "Policy",
      items: [{ id: "legal", icon: Scale, label: "Terms & Privacy", to: pathWithCamp(slug, "/legal") }]
    });

    return sections;
  }, [
    isAuthenticated,
    slug,
    canSearch,
    modules.chat,
    modules.map,
    modules.photoStream,
    modules.newsletter,
    canFamilyTrees,
    modules.merchShop,
    newsletterLabel,
    merchShopUrl,
    isCampDirector,
    needsOnboarding
  ]);

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
  }, [currentPath]);

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
            avatarUrl: entry?.uploads?.photoUrl || entry?.avatarUrl || entry?.profilePhotoUrl || ""
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
    try {
      await requestJson(`/api/t/${slug}/auth/logout`, {
        method: "POST",
        token
      });
    } catch {
      // No-op: clear local auth regardless.
    } finally {
      closeMenus();
      logout();
      navigate(pathWithCamp(slug, "/login"));
    }
  }

  return (
    <nav className={`navbar2 ${onAuthRoute ? "is-auth-route" : ""}`.trim()}>
      <div className="navbar2-left">
        <Link
          to={pathWithCamp(slug, isAuthenticated ? "/home" : "/")}
          className="navbar2-logoLink"
          aria-label="Go to Home"
        >
          {logoUrl ? (
            <img src={logoUrl} alt={`${tenant?.name || "Camp"} logo`} className="navbar2-logo" />
          ) : (
            <div
              className="nav2-ac-avatar nav2-avatar-fallback nav2-ac-initials"
              aria-hidden="true"
              style={{ width: 60, height: 60 }}
            >
              {fallbackLogoInitial}
            </div>
          )}
        </Link>
        <span className="navbar2-title">{title}</span>
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
                aria-autocomplete="list"
              />
              <button className="navbar2-search-cta" onClick={goToResults} aria-label="Search">
                <Search size={16} />
              </button>

              {acOpen && q.trim().length >= MIN_SEARCH_CHARS ? (
                <ul className="nav2-ac-list" role="listbox">
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
            <button
              className={`navbar2-auth-btn ${onCreateAccountRoute ? "is-current" : ""}`.trim()}
              onClick={() => {
                if (!onCreateAccountRoute) navigate(createAccountPath);
              }}
              aria-current={onCreateAccountRoute ? "page" : undefined}
            >
              Create Account
            </button>
            <button
              className={`navbar2-auth-btn secondary ${onLoginRoute ? "is-current" : ""}`.trim()}
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

            <div className="navbar2-menuWrap">
              <button
                ref={toggleRef}
                className={`navbar2-burger ${menuOpen ? "is-open" : ""}`}
                aria-label="Open menu"
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
                        {section.items.map((item) => (
                          <button
                            key={item.id}
                            onClick={() => {
                              closeMenus();
                              if (item.href) {
                                window.open(item.href, "_blank", "noopener,noreferrer");
                                return;
                              }
                              navigate(item.to);
                            }}
                            role="menuitem"
                          >
                            <item.icon size={16} /> {item.label}
                          </button>
                        ))}
                      </div>
                    ))}
                    <div className="dropdown-section">
                      <p className="dropdown-section-title">Session</p>
                      <button onClick={handleLogout} role="menuitem">
                        <LogOut size={16} /> Log Out
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </nav>
  );
}
