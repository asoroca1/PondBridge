import { useEffect, useMemo, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useTenant } from "../../context/TenantContext.jsx";
import { AdminLayout, ContextBanner, SidebarNav } from "../../components/admin/AdminUi.jsx";

const ADMIN_NAV = [
  { key: "overview", to: "dashboard", label: "Overview" },
  { key: "members", to: "members", label: "Members", end: true },
  { key: "directory", to: "directory", label: "Camper Directory" },
  { key: "trees", to: "family-trees", label: "Family Trees" },
  { key: "events", to: "events", label: "Events" },
  { key: "communications", to: "communications", label: "Communications" },
  { key: "billing", to: "billing", label: "Billing" }
];

const SETTINGS_NAV = [
  { key: "network", to: "settings/network", label: "Network Identity", className: "director-admin-sidebar-sublink" },
  { key: "branding", to: "settings/branding", label: "Branding", className: "director-admin-sidebar-sublink" },
  { key: "access", to: "settings/access", label: "Access Policy", className: "director-admin-sidebar-sublink" },
  { key: "admins", to: "settings/admins", label: "Admins", className: "director-admin-sidebar-sublink" },
  { key: "notifications", to: "settings/notifications", label: "Notifications", className: "director-admin-sidebar-sublink" },
  { key: "danger", to: "settings/danger", label: "Danger Zone", className: "director-admin-sidebar-sublink" }
];

export default function DirectorAdminLayout() {
  const { tenant, slug } = useTenant();
  const location = useLocation();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const signupMode =
    tenant?.config?.accessRules?.signupMode ||
    tenant?.accessSettings?.signupMode ||
    tenant?.settings?.signupMode ||
    "open";
  const showApprovals = signupMode === "approval_queue";
  const onSettingsRoute = location.pathname.includes("/admin/settings/");

  useEffect(() => {
    if (onSettingsRoute) setSettingsOpen(true);
  }, [onSettingsRoute]);

  const sections = useMemo(() => {
    const base = ADMIN_NAV.map((item) => ({ ...item, className: "director-admin-sidebar-link" }));

    if (showApprovals) {
      const membersIndex = base.findIndex((item) => item.key === "members");
      if (membersIndex >= 0) {
        base.splice(membersIndex + 1, 0, {
          key: "approvals",
          to: "members/approvals",
          label: "Pending Approvals",
          className: "director-admin-sidebar-link"
        });
      }
    }

    base.splice(6, 0, {
      key: "settings",
      label: "Settings",
      children: SETTINGS_NAV,
      isExpanded: settingsOpen,
      onToggle: () => setSettingsOpen((open) => !open),
      toggleClassName: "director-admin-sidebar-link director-admin-sidebar-toggle",
      className: `director-admin-sidebar-group ${onSettingsRoute ? "is-active" : ""}`.trim()
    });

    return base;
  }, [onSettingsRoute, settingsOpen, showApprovals]);

  const tenantName = tenant?.name || "Your Network";
  const resolvedSlug = String(slug || tenant?.slug || "cedar");

  return (
    <section className="pb-cedar-page">
      <AdminLayout
        className="director-admin-scope"
        banner={
          <ContextBanner
            title={`Admin Mode - ${tenantName}`}
            subtitle="Manage members, communications, settings, and billing for your network."
            exitTo={`/t/${resolvedSlug}/home`}
            exitLabel="Exit Admin"
          />
        }
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
