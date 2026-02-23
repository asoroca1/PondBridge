import { useEffect, useMemo, useState } from "react";
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
    label: "Users",
    items: [{ to: "/super/tenants", label: "Users & Directors" }]
  },
  {
    label: "Billing",
    items: [
      { to: "/super/billing", label: "Billing Overview" },
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
  },
  {
    label: "Audit Log",
    items: [{ to: "/super/settings", label: "Audit Log" }]
  }
];

const FINANCE_NAV = [
  {
    label: "Billing",
    items: [
      { to: "/super/billing", label: "Billing Overview" },
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
  const [notifications, setNotifications] = useState({ criticalCount: 0, items: [] });
  const [topbarError, setTopbarError] = useState("");

  const role = roleFromUser(user);
  const clerkMode = ["clerk", "hybrid"].includes(String(authProvider || "").toLowerCase());
  const allowed = role === "super_admin" || role === "support_admin" || role === "finance_admin";
  const financeRouteAllowed = /^\/super\/billing(\/|$)/.test(location.pathname || "");

  const navGroups = useMemo(() => {
    if (role === "finance_admin") return FINANCE_NAV;
    return SUPER_NAV;
  }, [role]);
  const contextLabel = useMemo(() => {
    const params = new URLSearchParams(location.search || "");
    const campName = String(params.get("camp") || "").trim();
    return campName ? `Viewing: ${campName}` : "Viewing: Global";
  }, [location.search]);

  useEffect(() => {
    if (!token || !allowed) return undefined;

    let active = true;

    async function loadNotifications() {
      try {
        const payload = await requestJson("/api/super/notifications", {
          token,
          getToken: () => getAuthToken({ forceRefresh: true })
        });
        if (!active) return;
        setNotifications(payload);
      } catch (error) {
        if (!active) return;
        setTopbarError(error.message || "Could not load alerts.");
      }
    }

    loadNotifications();
    const id = window.setInterval(loadNotifications, 30000);

    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [allowed, getAuthToken, token]);

  useEffect(() => {
    if (!token || !allowed) return undefined;

    const query = search.trim();
    if (query.length < 2) {
      setSearchResults([]);
      setSearchLoading(false);
      return undefined;
    }

    let active = true;
    setSearchLoading(true);

    const id = window.setTimeout(async () => {
      try {
        const payload = await requestJson(`/api/super/search?q=${encodeURIComponent(query)}`, {
          token,
          getToken: () => getAuthToken({ forceRefresh: true })
        });
        if (!active) return;
        setSearchResults(payload.items || []);
      } catch {
        if (!active) return;
        setSearchResults([]);
      } finally {
        if (!active) return;
        setSearchLoading(false);
      }
    }, 180);

    return () => {
      active = false;
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
    return <Navigate to="/super/billing" replace />;
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
        <span className="super-context-chip">{contextLabel}</span>

        <div className="super-topbar-actions">
          <button
            type="button"
            className="super-notification-btn"
            onClick={() => navigate("/super/billing/failed")}
            title="Critical alerts"
          >
            Alerts
            {notifications.criticalCount > 0 ? <span className="super-notification-count">{notifications.criticalCount}</span> : null}
          </button>
          <span className={`super-role-badge role-${role.replace(/_/g, "-")}`}>
            {role === "super_admin" ? "Super Admin" : role === "support_admin" ? "Support" : "Finance"}
          </span>
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
        {topbarError ? <p className="super-inline-error">{topbarError}</p> : null}
        <Outlet />
      </div>
    </SuperAdminLayout>
  );
}
