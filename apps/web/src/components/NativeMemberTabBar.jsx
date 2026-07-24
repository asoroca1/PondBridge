import { useMemo } from "react";
import { CalendarDays, Home, Image, MessageSquare, Search, Bell, Shield, TreePine, User } from "lucide-react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { isMemberEventsModuleEnabled } from "@pondbridge/shared";
import { useAuth } from "../context/AuthContext.jsx";
import { useTenant } from "../context/TenantContext.jsx";
import { useMobileNotifications } from "../context/MobileNotificationsContext.jsx";
import { tenantHasFeature } from "../lib/features.js";
import { tenantRoute } from "../lib/tenantRouting.js";

function tenantRelativePath(pathname = "") {
  const normalizedPath = String(pathname || "").trim() || "/";
  const tenantMatch = normalizedPath.match(/^\/t\/[^/]+(\/.*)?$/);
  if (tenantMatch) return tenantMatch[1] || "/";
  return normalizedPath;
}

function matchesTab(pathname = "", matchers = []) {
  return matchers.some((matcher) => {
    if (typeof matcher === "function") return Boolean(matcher(pathname));
    if (matcher instanceof RegExp) return matcher.test(pathname);
    return pathname === matcher;
  });
}

export default function NativeMemberTabBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams();
  const { user } = useAuth();
  const { slug: contextSlug, tenant } = useTenant();
  const { unreadCount } = useMobileNotifications();
  const slug = String(params.slug || contextSlug || "").trim().toLowerCase();
  const currentPath = tenantRelativePath(location.pathname || "");
  const configModules = tenant?.config?.modules || tenant?.modules || {};
  const modules = useMemo(
    () => ({
      ...configModules,
      events: isMemberEventsModuleEnabled(configModules.events)
    }),
    [configModules]
  );
  const canSearch = modules.search !== false;
  const canChat = modules.chat !== false;
  const canEvents = modules.events !== false;
  const canPhotos = modules.photoStream !== false;
  const canFamilyTrees = modules.familyTrees !== false && tenantHasFeature(tenant, "familyTrees");
  const roles = new Set(
    (Array.isArray(user?.roles) ? user.roles : user?.roles ? [user.roles] : [])
      .map((role) => String(role || "").trim().toLowerCase())
      .filter(Boolean)
  );
  const isCampDirector = roles.has("tenant_admin") || roles.has("admin");

  const tabs = useMemo(() => {
    const nextTabs = [
      {
        id: "home",
        label: "Home",
        icon: Home,
        to: tenantRoute(slug, "/home"),
        matchers: ["/home"]
      }
    ];

    if (canSearch) {
      nextTabs.push({
        id: "search",
        label: "Search",
        icon: Search,
        to: tenantRoute(slug, "/search"),
        matchers: ["/search", "/search-results", /^\/profile\/[^/]+$/]
      });
    }

    if (canChat) {
      nextTabs.push({
        id: "chat",
        label: "Messages",
        icon: MessageSquare,
        to: tenantRoute(slug, "/chat-rooms?tab=personal"),
        matchers: [/^\/chat-rooms(?:\/|$)/, /^\/chat\/[^/]+$/]
      });
    }

    if (canEvents) {
      nextTabs.push({
        id: "events",
        label: "Events",
        icon: CalendarDays,
        to: tenantRoute(slug, "/events"),
        matchers: [/^\/events(?:\/|$)/]
      });
    }

    if (nextTabs.length < 4 && canPhotos) {
      nextTabs.push({
        id: "photos",
        label: "Photos",
        icon: Image,
        to: tenantRoute(slug, "/photo-stream"),
        matchers: ["/photo-stream"]
      });
    }

    if (nextTabs.length < 4 && canFamilyTrees) {
      nextTabs.push({
        id: "trees",
        label: "Trees",
        icon: TreePine,
        to: tenantRoute(slug, "/family-trees"),
        matchers: [/^\/family-trees(?:\/|$)/]
      });
    }

    if (nextTabs.length < 4) {
      nextTabs.push({
        id: "notifications",
        label: "Alerts",
        icon: Bell,
        to: tenantRoute(slug, "/notifications"),
        matchers: ["/notifications"],
        badgeCount: unreadCount
      });
    }

    if (isCampDirector) {
      nextTabs.push({
        id: "manage",
        label: "Manage",
        icon: Shield,
        to: tenantRoute(slug, "/admin/dashboard"),
        matchers: [/^\/admin(?:\/|$)/, /^\/onboarding(?:\/|$)/]
      });
    } else {
      nextTabs.push({
        id: "profile",
        label: "Profile",
        icon: User,
        to: tenantRoute(slug, "/my-profile"),
        matchers: ["/my-profile", "/edit-profile"]
      });
    }

    return nextTabs;
  }, [canChat, canEvents, canFamilyTrees, canPhotos, canSearch, isCampDirector, slug, unreadCount]);

  return (
    <nav className="native-member-tabbar" aria-label="App navigation">
      <div className="native-member-tabbar-inner" style={{ "--native-tab-count": tabs.length }}>
        {tabs.map((tab) => {
          const active = matchesTab(currentPath, tab.matchers);
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              className={`native-member-tabbar-item ${active ? "is-active" : ""}`.trim()}
              aria-current={active ? "page" : undefined}
              onClick={() => navigate(tab.to)}
            >
              <span className="native-member-tabbar-icon-wrap">
                <Icon size={18} strokeWidth={active ? 2.2 : 2} />
                {Number(tab.badgeCount || 0) > 0 ? (
                  <span className="native-member-tabbar-badge">{Math.min(Number(tab.badgeCount || 0), 99)}</span>
                ) : null}
              </span>
              <span className="native-member-tabbar-label">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
