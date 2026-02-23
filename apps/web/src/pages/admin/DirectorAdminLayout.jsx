import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useTenant } from "../../context/TenantContext.jsx";

const ADMIN_NAV = [
  { to: "dashboard", label: "Dashboard" },
  { to: "members", label: "Members" },
  { to: "members/import", label: "Import" },
  { to: "email/compose", label: "Email" },
  { to: "email/history", label: "Sent Emails" },
  { to: "analytics", label: "Analytics" },
  { to: "features", label: "Features" },
  { to: "billing", label: "Billing" }
];

const SETTINGS_NAV = [
  { to: "settings/network", label: "Network Identity" },
  { to: "settings/branding", label: "Branding" },
  { to: "settings/access", label: "Access Policy" },
  { to: "settings/admins", label: "Admins" },
  { to: "settings/notifications", label: "Notifications" },
  { to: "settings/danger", label: "Danger Zone" }
];

export default function DirectorAdminLayout() {
  const { tenant } = useTenant();
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

  return (
    <section className="pb-cedar-page">
      <div className="director-admin-shell">
        <aside className="director-admin-sidebar" aria-label="Director admin navigation">
          <p className="director-admin-sidebar-title">Manage Network</p>
          <nav className="director-admin-sidebar-nav">
            {ADMIN_NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "members"}
                className={({ isActive }) =>
                  `director-admin-sidebar-link ${isActive ? "is-active" : ""}`.trim()
                }
              >
                {item.label}
              </NavLink>
            ))}
            {showApprovals ? (
              <NavLink
                to="members/approvals"
                className={({ isActive }) =>
                  `director-admin-sidebar-link ${isActive ? "is-active" : ""}`.trim()
                }
              >
                Approvals
              </NavLink>
            ) : null}
            <div className={`director-admin-sidebar-group ${onSettingsRoute ? "is-active" : ""}`.trim()}>
              <button
                type="button"
                className={`director-admin-sidebar-link director-admin-sidebar-toggle ${
                  onSettingsRoute ? "is-active" : ""
                }`.trim()}
                onClick={() => setSettingsOpen((open) => !open)}
                aria-expanded={settingsOpen}
                aria-controls="director-admin-settings-subnav"
              >
                <span>Settings</span>
                <span
                  aria-hidden="true"
                  className={`director-admin-sidebar-caret ${settingsOpen ? "is-open" : ""}`.trim()}
                >
                  ▾
                </span>
              </button>
              {settingsOpen ? (
                <div id="director-admin-settings-subnav" className="director-admin-sidebar-subnav">
                  {SETTINGS_NAV.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      className={({ isActive }) =>
                        `director-admin-sidebar-sublink ${isActive ? "is-active" : ""}`.trim()
                      }
                    >
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              ) : null}
            </div>
          </nav>
        </aside>

        <div className="director-admin-main">
          <Outlet />
        </div>
      </div>
    </section>
  );
}
