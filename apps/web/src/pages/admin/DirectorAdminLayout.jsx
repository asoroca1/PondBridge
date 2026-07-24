import { useEffect, useMemo, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { isMemberEventsModuleEnabled } from "@pondbridge/shared";
import {
  CalendarDays,
  CreditCard,
  ExternalLink,
  History,
  Image,
  LayoutDashboard,
  MailPlus,
  Send,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Bell,
  Building2,
  KeyRound,
  LifeBuoy,
  ShieldAlert,
  UserCheck,
  Users,
  UserCog,
  TrendingUp
} from "lucide-react";
import { AdminLayout, SidebarNav } from "../../components/admin/AdminUi.jsx";
import { useTenant } from "../../context/TenantContext.jsx";
import { tenantRoute } from "../../lib/tenantRouting.js";

const ADMIN_NAV = [
  { type: "label", key: "control-label", label: "Control room" },
  { key: "overview", to: "dashboard", label: "Today", icon: LayoutDashboard },
  { key: "guide", to: "onboarding", label: "Ask PondBridge", icon: Sparkles },
  { type: "label", key: "people-label", label: "People" },
  { key: "members", to: "members", label: "Members", icon: Users, end: true },
  { key: "growth", to: "growth", label: "Alumni growth", icon: TrendingUp },
  { key: "approvals", to: "members/approvals", label: "Approvals", icon: UserCheck },
  { key: "invites", to: "invites", label: "Invitations", icon: MailPlus },
  { key: "safety", to: "safety", label: "Safety", icon: ShieldCheck },
  { type: "label", key: "engage-label", label: "Engage" },
  { key: "events", to: "events", label: "Events", icon: CalendarDays },
  { key: "mobile-alerts", to: "settings/notifications", label: "Mobile alerts", icon: Bell },
  { key: "email", to: "email/compose", label: "Compose email", icon: Send },
  { key: "email-history", to: "email/history", label: "Email history", icon: History },
  { type: "label", key: "manage-label", label: "Manage" },
  { key: "billing", to: "billing", label: "Plan & billing", icon: CreditCard }
];

const SETTINGS_NAV = [
  { key: "features", to: "features", label: "Features & services", icon: SlidersHorizontal, className: "director-admin-sidebar-sublink" },
  { key: "network", to: "settings/network", label: "Network identity", icon: Building2, className: "director-admin-sidebar-sublink" },
  { key: "branding", to: "settings/branding", label: "Branding", icon: Image, className: "director-admin-sidebar-sublink" },
  { key: "access", to: "settings/access", label: "Access policy", icon: KeyRound, className: "director-admin-sidebar-sublink" },
  { key: "admins", to: "settings/admins", label: "Admins", icon: UserCog, className: "director-admin-sidebar-sublink" },
  { key: "support", to: "settings/support", label: "Technical support", icon: LifeBuoy, className: "director-admin-sidebar-sublink" },
  { key: "danger", to: "settings/danger", label: "Danger zone", icon: ShieldAlert, className: "director-admin-sidebar-sublink" }
];

export default function DirectorAdminLayout() {
  const { tenant } = useTenant();
  const location = useLocation();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const onSettingsRoute =
    location.pathname.includes("/admin/settings/") || location.pathname.endsWith("/admin/features");
  const demoAccessEnabled = Boolean(tenant?.accessSettings?.demoAccessEnabled);
  const eventsEnabled = isMemberEventsModuleEnabled(tenant?.config?.modules?.events ?? tenant?.modules?.events);

  useEffect(() => {
    if (onSettingsRoute) setSettingsOpen(true);
  }, [onSettingsRoute]);

  const sections = useMemo(() => {
    const base = ADMIN_NAV
      .filter((item) => item.type === "label" || !(demoAccessEnabled && item.key === "billing"))
      .filter((item) => item.type === "label" || item.key !== "events" || eventsEnabled)
      .map((item) => ({
        ...item,
        to: item.key === "guide" && tenant?.slug ? tenantRoute(tenant.slug, "/onboarding") : item.to,
        className: item.type === "label" ? "director-admin-sidebar-label" : "director-admin-sidebar-link"
      }));

    base.push({
      key: "settings",
      label: "Settings & controls",
      icon: Settings,
      children: SETTINGS_NAV,
      isExpanded: settingsOpen,
      onToggle: () => setSettingsOpen((open) => !open),
      toggleClassName: "director-admin-sidebar-link director-admin-sidebar-toggle",
      className: `director-admin-sidebar-group ${onSettingsRoute ? "is-active" : ""}`.trim()
    });

    return base;
  }, [demoAccessEnabled, eventsEnabled, onSettingsRoute, settingsOpen, tenant?.slug]);

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
