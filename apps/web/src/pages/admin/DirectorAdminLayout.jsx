import { useMemo } from "react";
import { Link, Outlet } from "react-router-dom";
import { isMemberEventsModuleEnabled } from "@pondbridge/shared";
import {
  CalendarDays,
  CreditCard,
  ExternalLink,
  LayoutDashboard,
  Send,
  Settings,
  Sparkles,
  Users,
} from "lucide-react";
import { AdminLayout, SidebarNav } from "../../components/admin/AdminUi.jsx";
import { useTenant } from "../../context/TenantContext.jsx";
import { resolveCampAiName } from "../../lib/campLabels.js";
import { tenantRoute } from "../../lib/tenantRouting.js";

const ADMIN_NAV = [
  { type: "label", key: "control-label", label: "Control room" },
  { key: "overview", to: "dashboard", label: "Today", icon: LayoutDashboard },
  { key: "guide", to: "onboarding", label: "Camp AI", icon: Sparkles },
  { type: "label", key: "people-label", label: "People" },
  // Members, approvals, and invitations are stages of one workspace now.
  { key: "people", to: "people", label: "People", icon: Users },
  { type: "label", key: "engage-label", label: "Engage" },
  { key: "events", to: "events", label: "Events & info sessions", icon: CalendarDays },
  // Points at the workspace root so every mail folder keeps the item highlighted.
  { key: "email", to: "email", label: "Email", icon: Send },
  { type: "label", key: "manage-label", label: "Manage" },
  { key: "billing", to: "billing", label: "Plan & billing", icon: CreditCard }
];

export default function DirectorAdminLayout() {
  const { tenant } = useTenant();
  const demoAccessEnabled = Boolean(tenant?.accessSettings?.demoAccessEnabled);
  const eventsEnabled = isMemberEventsModuleEnabled(tenant?.config?.modules?.events ?? tenant?.modules?.events);
  const aiName = resolveCampAiName(tenant);

  const sections = useMemo(() => {
    const base = ADMIN_NAV
      .filter((item) => item.type === "label" || !(demoAccessEnabled && item.key === "billing"))
      .filter((item) => item.type === "label" || item.key !== "events" || eventsEnabled)
      .map((item) => ({
        ...item,
        to: item.key === "guide" && tenant?.slug ? tenantRoute(tenant.slug, "/onboarding") : item.to,
        label: item.key === "guide" ? aiName : item.label,
        className: item.type === "label" ? "director-admin-sidebar-label" : "director-admin-sidebar-link"
      }));

    base.push({
      key: "settings",
      to: "settings",
      label: "Settings & controls",
      icon: Settings,
      className: "director-admin-sidebar-link"
    });

    return base;
  }, [aiName, demoAccessEnabled, eventsEnabled, tenant?.slug]);

  return (
    <section className="pb-cedar-page">
      <AdminLayout
        className="director-admin-scope"
        sidebar={
          <SidebarNav
            title="Camp operations"
            sections={sections}
            className="director-admin-sidebar"
            navClassName="director-admin-sidebar-nav"
            linkClassName="director-admin-sidebar-link"
            activeLinkClassName="is-active"
            footer={
              <div className="director-admin-sidebar-footer">
                <span className={`director-admin-network-state ${tenant?.onboardingStatus === "live" ? "is-live" : "is-setup"}`}>
                  <i aria-hidden="true" />
                  {tenant?.onboardingStatus === "live" ? "Community live" : "Setup in progress"}
                </span>
                {tenant?.slug ? (
                  <Link to={tenantRoute(tenant.slug, "/home")}>
                    View member community <ExternalLink size={14} aria-hidden="true" />
                  </Link>
                ) : null}
              </div>
            }
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
