import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext.jsx";
import { requestJson } from "../../lib/http.js";
import { SuperAdminLayout } from "../../components/admin/AdminUi.jsx";

function roleFromUser(user) {
  const roles = new Set(user?.roles || []);
  if (roles.has("super_admin")) return "super_admin";
  if (roles.has("support_admin")) return "support_admin";
  if (roles.has("finance_admin")) return "finance_admin";
  return "unknown";
}

const SUPER_NAV = [
  {
    label: "Camps",
    items: [{ to: "/super/tenants", label: "Camp Directory" }]
  },
  {
    label: "Billing",
    items: [
      { to: "/super/billing/tenants", label: "Tenant Billing" },
      { to: "/super/billing/failed", label: "Failed Payments" }
    ]
  },
  {
    label: "Platform Settings",
    items: [{ to: "/super/settings", label: "Settings" }]
  },
  {
    label: "Metrics",
    items: [
      { to: "/super/dashboard", label: "Platform Pulse" },
      { to: "/super/email/transactional", label: "Transactional Email" }
    ]
  }
];

const FINANCE_NAV = [
  {
    label: "Billing",
    items: [
      { to: "/super/billing/tenants", label: "Tenant Billing" },
      { to: "/super/billing/failed", label: "Failed Payments" }
    ]
  }
];

export default function SuperShellLayout() {
  const { token, user, logout, authProvider, isReady, getAuthToken } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchCacheRef = useRef(new Map());

  const role = roleFromUser(user);
  const clerkMode = ["clerk", "hybrid"].includes(String(authProvider || "").toLowerCase());
  const allowed = role === "super_admin" || role === "support_admin" || role === "finance_admin";
  const financeRouteAllowed = /^\/super\/billing(\/|$)/.test(location.pathname || "");

  const navGroups = useMemo(() => {
    if (role === "finance_admin") return FINANCE_NAV;
    return SUPER_NAV;
  }, [role]);

  useEffect(() => {
    if (!token || !allowed) return undefined;

    const query = search.trim();
    if (!query) {
      setSearchResults([]);
      setSearchLoading(false);
      return undefined;
    }

    const normalizedQuery = query.toLowerCase();
    const cached = searchCacheRef.current.get(normalizedQuery);
    if (cached) {
      setSearchResults(cached);
      setSearchLoading(false);
      return undefined;
    }

    let active = true;
    const controller = new AbortController();
    setSearchLoading(true);

    const id = window.setTimeout(async () => {
      try {
        const payload = await requestJson(`/api/super/search?q=${encodeURIComponent(query)}`, {
          token,
          getToken: () => getAuthToken(),
          signal: controller.signal
        });
        if (!active) return;
        const items = payload.items || [];
        setSearchResults(items);
        searchCacheRef.current.set(normalizedQuery, items);
        if (searchCacheRef.current.size > 30) {
          const oldestKey = searchCacheRef.current.keys().next().value;
          if (oldestKey) searchCacheRef.current.delete(oldestKey);
        }
      } catch (error) {
        if (error?.name === "AbortError") return;
        if (!active) return;
        setSearchResults([]);
      } finally {
        if (!active) return;
        setSearchLoading(false);
      }
    }, 90);

    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(id);
    };
  }, [allowed, getAuthToken, search, token]);

  async function handleLogout() {
    try {
      await requestJson("/api/auth/super/logout", {
        method: "POST",
        token,
        getToken: () => getAuthToken({ forceRefresh: true })
      });
    } catch {
      // no-op
    } finally {
      logout();
      navigate("/super/login", { replace: true });
    }
  }

  function onSearchNavigate(href) {
    if (!href) return;
    setSearch("");
    setSearchResults([]);
    navigate(href);
  }

  if (!isReady) {
    return (
      <section className="super-shell-boot">
        <div className="super-shell-boot-card">
          <h2>Preparing Super Admin Console</h2>
          <p>Loading secure session...</p>
        </div>
      </section>
    );
  }

  if (clerkMode && token && !user) {
    return (
      <section className="super-shell-boot">
        <div className="super-shell-boot-card">
          <h2>Preparing Super Admin Console</h2>
          <p>Finalizing your admin session...</p>
        </div>
      </section>
    );
  }

  if (!token) {
    return <Navigate to="/super/login" replace state={{ from: location }} />;
  }

  if (!allowed) {
    return <Navigate to="/super/login" replace />;
  }

  if (role === "finance_admin" && !financeRouteAllowed) {
    return <Navigate to="/super/billing/tenants" replace />;
  }

  return (
    <SuperAdminLayout
      className="super-shell"
      topbar={
        <header className="super-topbar">
        <div className="super-topbar-brand">PondBridge</div>

        <div className="super-topbar-search-wrap">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search tenants, directors, emails"
            className="super-topbar-search"
          />
          {searchLoading ? <span className="super-search-spinner">Searching...</span> : null}
          {searchResults.length ? (
            <div className="super-search-dropdown">
              {searchResults.map((item) => (
                <button key={item.id} type="button" className="super-search-item" onClick={() => onSearchNavigate(item.href)}>
                  <span className="super-search-type">{item.type}</span>
                  <span className="super-search-text">
                    <strong>{item.label}</strong>
                    <small>{item.meta}</small>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="super-topbar-actions">
          <button type="button" className="super-signout-btn" onClick={handleLogout}>
            Sign out
          </button>
        </div>
      </header>
      }
      sidebar={
        <aside className="super-sidebar" aria-label="Super admin navigation">
        {navGroups.map((group) => (
          <section key={group.label} className="super-nav-group">
            <p className="super-nav-group-label">{group.label}</p>
            <nav className="super-nav-list">
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) => `super-nav-link ${isActive ? "is-active" : ""}`.trim()}
                >
                  <span className="super-nav-text">{item.label}</span>
                </NavLink>
              ))}
            </nav>
          </section>
        ))}
      </aside>
      }
    >
      <div className="super-main" role="main">
        <Outlet />
      </div>
    </SuperAdminLayout>
  );
}
