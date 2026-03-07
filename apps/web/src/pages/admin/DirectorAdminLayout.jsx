import { useEffect, useMemo, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { AdminLayout, SidebarNav } from "../../components/admin/AdminUi.jsx";
import { useTenant } from "../../context/TenantContext.jsx";

const ADMIN_NAV = [
  { key: "overview", to: "dashboard", label: "Overview" },
  { key: "members", to: "members", label: "Members & Directory", end: true },
  { key: "invites", to: "invites", label: "Invite Members" },
  { key: "features", to: "features", label: "Features & Modules" },
  { key: "email", to: "email/compose", label: "Email" },
  { key: "billing", to: "billing", label: "Billing" }
];

const SETTINGS_NAV = [
  { key: "network", to: "settings/network", label: "Network Identity", className: "director-admin-sidebar-sublink" },
  { key: "branding", to: "settings/branding", label: "Branding", className: "director-admin-sidebar-sublink" },
  { key: "admins", to: "settings/admins", label: "Admins", className: "director-admin-sidebar-sublink" },
  { key: "support", to: "settings/support", label: "Technical Support", className: "director-admin-sidebar-sublink" },
  { key: "danger", to: "settings/danger", label: "Danger Zone", className: "director-admin-sidebar-sublink" }
];

export default function DirectorAdminLayout() {
  const location = useLocation();
  const { tenant } = useTenant();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const onSettingsRoute = location.pathname.includes("/admin/settings/");
  const demoAccessEnabled = Boolean(tenant?.accessSettings?.demoAccessEnabled);

  useEffect(() => {
    if (onSettingsRoute) setSettingsOpen(true);
  }, [onSettingsRoute]);

  const sections = useMemo(() => {
    const base = ADMIN_NAV
      .filter((item) => !(demoAccessEnabled && item.key === "billing"))
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
  }, [demoAccessEnabled, onSettingsRoute, settingsOpen]);

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
