import { useEffect, useMemo, useState } from "react";
import { Link, Outlet, useLocation, useParams } from "react-router-dom";
import { AdminLayout, SidebarNav } from "../../components/admin/AdminUi.jsx";
import { isNativeApp } from "../../lib/nativeApp.js";
import { tenantRoute } from "../../lib/tenantRouting.js";

const ADMIN_NAV = [
  { key: "overview", to: "dashboard", label: "Overview" },
  { key: "members", to: "members", label: "Members & Directory", end: true },
  { key: "invites", to: "invites", label: "Invite Members" },
  { key: "events", to: "events", label: "Events" },
  { key: "features", to: "features", label: "Features & Modules" },
  { key: "email", to: "email/compose", label: "Email" },
  { key: "billing", to: "billing", label: "Billing" }
];

const SETTINGS_NAV = [
  { key: "network", to: "settings/network", label: "Network Identity", className: "director-admin-sidebar-sublink" },
  { key: "branding", to: "settings/branding", label: "Branding", className: "director-admin-sidebar-sublink" },
  { key: "notifications", to: "settings/notifications", label: "Mobile Notifications", className: "director-admin-sidebar-sublink" },
  { key: "admins", to: "settings/admins", label: "Admins", className: "director-admin-sidebar-sublink" },
  { key: "support", to: "settings/support", label: "Technical Support", className: "director-admin-sidebar-sublink" },
  { key: "danger", to: "settings/danger", label: "Danger Zone", className: "director-admin-sidebar-sublink" }
];

const DIRECTOR_ADMIN_DESKTOP_MEDIA = "(max-width: 1020px)";

function shouldBlockDirectorAdminOnCurrentDevice() {
  if (isNativeApp()) return true;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(DIRECTOR_ADMIN_DESKTOP_MEDIA).matches;
}

export default function DirectorAdminLayout() {
  const { slug: routeSlug = "" } = useParams();
  const location = useLocation();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mobileBlocked, setMobileBlocked] = useState(() => shouldBlockDirectorAdminOnCurrentDevice());
  const onSettingsRoute = location.pathname.includes("/admin/settings/");
  const homePath = tenantRoute(routeSlug, "/home");

  useEffect(() => {
    if (onSettingsRoute) setSettingsOpen(true);
  }, [onSettingsRoute]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      setMobileBlocked(isNativeApp());
      return undefined;
    }

    const mediaQuery = window.matchMedia(DIRECTOR_ADMIN_DESKTOP_MEDIA);
    const syncBlockedState = () => setMobileBlocked(shouldBlockDirectorAdminOnCurrentDevice());

    syncBlockedState();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", syncBlockedState);
      return () => mediaQuery.removeEventListener("change", syncBlockedState);
    }

    mediaQuery.addListener(syncBlockedState);
    return () => mediaQuery.removeListener(syncBlockedState);
  }, []);

  const sections = useMemo(() => {
    const base = ADMIN_NAV
      .map((item) => ({ ...item, className: "director-admin-sidebar-link" }));

    base.push({
      key: "settings",
      label: "Settings",
      children: SETTINGS_NAV,
      isExpanded: settingsOpen,
      onToggle: () => setSettingsOpen((open) => !open),
      toggleClassName: "director-admin-sidebar-link director-admin-sidebar-toggle",
      className: `director-admin-sidebar-group ${onSettingsRoute ? "is-active" : ""}`.trim()
    });

    return base;
  }, [onSettingsRoute, settingsOpen]);

  if (mobileBlocked) {
    return (
      <section className="app-status-shell">
        <div className="app-status-card">
          <h1>Director dashboard is desktop only</h1>
          <p>Admin tools are available on the desktop web app so directors can manage the network with the full layout.</p>
          <p>
            <Link to={homePath}>Return to camp home</Link>
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="pb-cedar-page">
      <AdminLayout
        className="director-admin-scope"
        sidebar={
          <SidebarNav
            title="Manage Network"
            sections={sections}
            className="director-admin-sidebar"
            navClassName="director-admin-sidebar-nav"
            linkClassName="director-admin-sidebar-link"
            activeLinkClassName="is-active"
          />
        }
      >
        <div className="director-admin-main">
          <Outlet />
        </div>
      </AdminLayout>
    </section>
  );
}
