import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext.jsx";
import { requestJson } from "../../lib/http.js";
import { clearAuthStorage } from "../../lib/storage.js";
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
    label: "Control room",
    items: [
      { to: "/super/dashboard", label: "Ask PondBridge", icon: "spark" },
      { to: "/super/status", label: "Platform status", icon: "pulse" }
    ]
  },
  {
    label: "Records",
    items: [
      { to: "/super/tenants", label: "Camps", icon: "camp" },
      { to: "/super/billing/tenants", label: "Billing", icon: "billing" }
    ]
  },
  {
    label: "Tools",
    items: [
      { to: "/super/tenants/create", label: "Add a camp", icon: "add" },
      { to: "/super/billing/failed", label: "Failed payments", icon: "alert" },
      { to: "/super/email/transactional", label: "Email delivery", icon: "email" },
      { to: "/super/settings", label: "Platform settings", icon: "settings" }
    ]
  }
];

const FINANCE_NAV = [
  {
    label: "Control room",
    items: [{ to: "/super/dashboard", label: "Ask PondBridge", icon: "spark" }]
  },
  {
    label: "Billing",
    items: [
      { to: "/super/billing/tenants", label: "Billing status", icon: "billing" },
      { to: "/super/billing/failed", label: "Failed payments", icon: "alert" }
    ]
  }
];

function NavIcon({ kind }) {
  if (kind === "spark") {
    return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m10 2 1.4 4.2L16 8l-4.6 1.7L10 14l-1.4-4.3L4 8l4.6-1.8L10 2Z" /></svg>;
  }
  if (kind === "pulse") {
    return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2 10h3l2-5 3 10 2-5h6" /></svg>;
  }
  if (kind === "camp") {
    return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 16 10 3l7 13H3Zm7-9v9" /></svg>;
  }
  if (kind === "billing") {
    return <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="4" width="15" height="12" rx="2" /><path d="M2.5 8h15M6 12h3" /></svg>;
  }
  if (kind === "add") {
    return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v14M3 10h14" /></svg>;
  }
  if (kind === "alert") {
    return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m10 2 8 15H2L10 2Zm0 5v4m0 3v.1" /></svg>;
  }
  if (kind === "email") {
    return <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2" y="4" width="16" height="12" rx="2" /><path d="m3 6 7 5 7-5" /></svg>;
  }
  return <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="3" /><path d="M10 2v2m0 12v2M2 10h2m12 0h2M4.4 4.4l1.4 1.4m8.4 8.4 1.4 1.4m0-11.2-1.4 1.4m-8.4 8.4-1.4 1.4" /></svg>;
}

export default function SuperShellLayout() {
  const { token, user, logout, authProvider, isReady, getAuthToken } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [bootstrapStalled, setBootstrapStalled] = useState(false);
  const searchCacheRef = useRef(new Map());
  const previousPathRef = useRef(location.pathname);

  const role = roleFromUser(user);
  const clerkMode = ["clerk", "hybrid"].includes(String(authProvider || "").toLowerCase());
  const allowed = role === "super_admin" || role === "support_admin" || role === "finance_admin";
  const financeRouteAllowed =
    location.pathname === "/super/dashboard" || /^\/super\/billing(\/|$)/.test(location.pathname || "");

  const navGroups = useMemo(() => {
    if (role === "finance_admin") return FINANCE_NAV;
    return SUPER_NAV;
  }, [role]);

  useEffect(() => {
    if (isReady) {
      setBootstrapStalled(false);
      return undefined;
    }
    const timeoutId = window.setTimeout(() => {
      setBootstrapStalled(true);
    }, 12_000);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isReady]);

  useEffect(() => {
    if (previousPathRef.current === location.pathname) return undefined;
    previousPathRef.current = location.pathname;
    const timeoutId = window.setTimeout(() => {
      document.getElementById("main-content")?.focus({ preventScroll: true });
    }, 60);
    return () => window.clearTimeout(timeoutId);
  }, [location.pathname]);

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
    if (signingOut) return;
    setSigningOut(true);
    const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
    try {
      await Promise.race([
        requestJson("/api/auth/super/logout", {
          method: "POST",
          token,
          getToken: () => getAuthToken({ forceRefresh: true })
        }),
        wait(2200)
      ]);
    } catch {
      // no-op
    }

    try {
      await Promise.race([Promise.resolve(logout()), wait(3200)]);
    } catch {
      // no-op
    } finally {
      try {
        clearAuthStorage();
        window.sessionStorage.removeItem("pondbridgeTabAuthSession");
        window.sessionStorage.removeItem("pondbridgeTabLoginIntent");
      } catch {
        // no-op
      }
      window.location.assign("/super/login?signedOut=1");
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
          <h2>{bootstrapStalled ? "Session Check Timed Out" : "Preparing Super Admin Console"}</h2>
          <p>
            {bootstrapStalled
              ? "Your session could not be confirmed. Continue to login and sign in again."
              : "Loading secure session..."}
          </p>
          {bootstrapStalled ? (
            <div className="super-shell-boot-actions">
              <button type="button" className="btn btn-ghost" onClick={() => window.location.reload()}>
                Retry
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => navigate("/super/login?sessionRetry=1", { replace: true, state: { from: location } })}
              >
                Go to Login
              </button>
            </div>
          ) : null}
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
    return <Navigate to="/super/dashboard" replace />;
  }

  return (
    <SuperAdminLayout
      className="super-shell"
      topbar={
        <header className="super-topbar">
        <a className="skip-link" href="#main-content">Skip to main content</a>
        <div className="super-topbar-brand-wrap">
          <div className="super-topbar-brand">PondBridge</div>
          <span>Control room</span>
        </div>

        <div className="super-topbar-search-wrap">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={role === "finance_admin" ? "Search camp billing" : "Search camps, directors, emails"}
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
          <span className="super-live-indicator"><i aria-hidden="true" /> Live data</span>
          <span className={`super-role-badge role-${role}`}>{role === "finance_admin" ? "Finance" : role === "support_admin" ? "Support" : "Super admin"}</span>
          <button
            type="button"
            className="super-signout-btn"
            onClick={handleLogout}
            disabled={signingOut}
          >
            {signingOut ? "Signing out..." : "Sign out"}
          </button>
        </div>
      </header>
      }
      sidebar={
        <aside className="super-sidebar" aria-label="Super admin navigation">
        <div className="super-sidebar-intro">
          <strong>Mission control</strong>
          <span>Ask, verify, then act.</span>
        </div>
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
                  <span className="super-nav-icon"><NavIcon kind={item.icon} /></span>
                  <span className="super-nav-text">{item.label}</span>
                </NavLink>
              ))}
            </nav>
          </section>
        ))}
        <div className="super-sidebar-boundary">
          <span>Agent mode</span>
          <strong>Read-only by default</strong>
          <small>Changes open a reviewed PondBridge control.</small>
        </div>
      </aside>
      }
    >
      <div className="super-main" role="main">
        <Outlet />
      </div>
    </SuperAdminLayout>
  );
}
