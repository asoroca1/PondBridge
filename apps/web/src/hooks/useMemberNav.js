import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { isMemberEventsModuleEnabled } from "@pondbridge/shared";
import {
  BookOpen,
  Bell,
  CalendarDays,
  Home,
  Image,
  Map,
  MessageSquare,
  Pencil,
  Scale,
  Search,
  Settings,
  Shield,
  Shirt,
  TreePine,
  User,
  HeartHandshake
} from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { useTenant } from "../context/TenantContext.jsx";
import { tenantHasFeature } from "../lib/features.js";
import { inferCampSlugFromHost, isPotentialCustomTenantHost } from "../lib/domain.js";
import { isNativeApp } from "../lib/nativeApp.js";
import {
  resolveAlumniWord,
  resolveNewsletterLabel,
  resolveMediaStreamLabel,
  resolveSideNavEnabled,
  resolveTenantContent
} from "../lib/campLabels.js";

// The sidebar only earns its keep when there is room for it beside the page
// content. The member home already runs a feed plus a right-hand column, so
// below this the three of them squeeze each other and the burger stays the
// single member nav.
export const SIDE_NAV_MIN_WIDTH = 1200;
const SIDE_NAV_COLLAPSED_KEY = "pondbridgeSideNavCollapsed";

export function pathWithCamp(slug, path) {
  const nextPath = String(path || "/").startsWith("/") ? path : `/${path}`;
  const hostScopedTenant = Boolean(inferCampSlugFromHost() || isPotentialCustomTenantHost());
  if (hostScopedTenant) {
    return nextPath;
  }
  return `/t/${slug}${nextPath}`;
}

function normalizedRoleSet(user = {}) {
  const rawRoles = Array.isArray(user?.roles)
    ? user.roles
    : user?.roles
      ? [user.roles]
      : user?.role
        ? [user.role]
        : [];
  return new Set(rawRoles.map((role) => String(role || "").trim().toLowerCase()).filter(Boolean));
}

/**
 * The one definition of the member menu. Both the header burger dropdown and
 * the left sidebar render these sections, so a module toggled off or renamed
 * disappears from both without a second edit.
 */
export function useMemberNavSections() {
  const params = useParams();
  const { slug: contextSlug, tenant } = useTenant();
  const slug = params.slug || contextSlug || "cedar";
  const { user, isAuthenticated } = useAuth();

  const config = tenant?.config || {};
  const modules = {
    ...(config.modules || tenant?.modules || {}),
    events: isMemberEventsModuleEnabled(config?.modules?.events ?? tenant?.modules?.events)
  };
  const roleSet = normalizedRoleSet(user);
  const isCampDirector = roleSet.has("tenant_admin") || roleSet.has("super_admin") || roleSet.has("admin");
  const needsOnboarding = tenant?.onboardingStatus !== "live";

  const alumniWordTitle = resolveAlumniWord(tenant, { capitalized: true });
  const newsletterLabel = resolveNewsletterLabel(tenant);
  const mediaStreamLabel = resolveMediaStreamLabel(tenant);
  const content = resolveTenantContent(tenant);
  const merchShopUrl =
    String(content.merchShopUrl || "").trim() ||
    (slug === "camp-cedar" || slug === "cedar" ? "https://thecampspot.com/camphome.aspx" : "");
  const nativeApp = isNativeApp();

  const canSearch = Boolean(isAuthenticated && modules.search !== false);
  const canFamilyTrees = Boolean(modules.familyTrees !== false && tenantHasFeature(tenant, "familyTrees"));

  return useMemo(() => {
    if (!isAuthenticated) return [];

    const accountItems = [
      { id: "home", icon: Home, label: "Home", to: pathWithCamp(slug, "/home") },
      { id: "profile", icon: User, label: "My Profile", to: pathWithCamp(slug, "/my-profile") },
      { id: "edit", icon: Pencil, label: "Edit Profile", to: pathWithCamp(slug, "/edit-profile") }
    ];
    if (canSearch) {
      accountItems.push({
        id: "search",
        icon: Search,
        label: "Advanced Search",
        to: pathWithCamp(slug, "/search")
      });
    }

    const communityItems = [];
    if (modules.photoStream !== false) {
      communityItems.push({
        id: "photos",
        icon: Image,
        label: mediaStreamLabel,
        to: pathWithCamp(slug, "/photo-stream")
      });
    }
    if (modules.events !== false) {
      communityItems.push({
        id: "events",
        icon: CalendarDays,
        label: "Events & Info Sessions",
        to: pathWithCamp(slug, "/events")
      });
    }
    if (modules.giving !== false) {
      communityItems.push({
        id: "giving",
        icon: HeartHandshake,
        label: "Giving",
        to: pathWithCamp(slug, "/giving")
      });
    }
    if (modules.chat !== false) {
      communityItems.push({
        id: "chat",
        icon: MessageSquare,
        label: "Chats and Forums",
        to: pathWithCamp(slug, "/chat-rooms?tab=personal")
      });
    }
    if (modules.map !== false) {
      communityItems.push({
        id: "map",
        icon: Map,
        label: `${alumniWordTitle} Map`,
        to: pathWithCamp(slug, "/location-map")
      });
    }
    if (canFamilyTrees) {
      communityItems.push({
        id: "trees",
        icon: TreePine,
        label: "Family Trees",
        to: pathWithCamp(slug, "/family-trees")
      });
    }
    if (modules.newsletter !== false) {
      communityItems.push({
        id: "chest",
        icon: BookOpen,
        label: newsletterLabel,
        to: pathWithCamp(slug, "/newsletter")
      });
    }
    if (modules.merchShop !== false && merchShopUrl) {
      communityItems.push({ id: "merch", icon: Shirt, label: "Merch Shop", href: merchShopUrl });
    }

    const adminItems = [];
    if (isCampDirector) {
      if (needsOnboarding) {
        adminItems.push({
          id: "setup",
          icon: Settings,
          label: "Setup Wizard",
          to: pathWithCamp(slug, "/director-create-account")
        });
      }
      adminItems.push({
        id: "admin",
        icon: Shield,
        label: "Director Dashboard",
        to: pathWithCamp(slug, "/admin")
      });
    }

    const sections = [];
    if (accountItems.length) sections.push({ id: "account", title: "Account", items: accountItems });
    if (communityItems.length) sections.push({ id: "community", title: "Community", items: communityItems });
    if (nativeApp) {
      sections.push({
        id: "mobile",
        title: "Mobile",
        items: [{ id: "notifications", icon: Bell, label: "Notifications", to: pathWithCamp(slug, "/notifications") }]
      });
    }
    if (adminItems.length) sections.push({ id: "admin-tools", title: "Director", items: adminItems });
    // Untitled: a single legal link does not earn a section header beside
    // Account and Community. The burger renders it the same way.
    sections.push({
      id: "policy",
      items: [{ id: "legal", icon: Scale, label: "Terms & Privacy", to: pathWithCamp(slug, "/legal") }]
    });

    return sections;
  }, [
    isAuthenticated,
    slug,
    canSearch,
    alumniWordTitle,
    modules.chat,
    modules.events,
    modules.giving,
    modules.map,
    modules.photoStream,
    mediaStreamLabel,
    modules.newsletter,
    canFamilyTrees,
    modules.merchShop,
    newsletterLabel,
    merchShopUrl,
    nativeApp,
    isCampDirector,
    needsOnboarding
  ]);
}

// Areas that bring their own chrome: the director and super consoles carry a
// two-level nav of their own, and a member rail beside them would be a third
// competing column of links. Mirrors AppShell's standard-offset list.
const CONSOLE_PATH_PARTS = ["/admin", "/onboarding", "/settings", "/super"];

/**
 * Whether the rail belongs on this route at all, independent of the tenant
 * setting and the viewport. Auth screens and the public entry page must never
 * show member links; the consoles have their own nav.
 */
export function sideNavAllowedForPath(pathname = "") {
  const path = String(pathname || "/");

  const onAuthRoute =
    /\/login\/?$/.test(path) ||
    /\/create-account\/?$/.test(path) ||
    /\/forgot-password\/?$/.test(path) ||
    /\/auth\/callback\/?$/.test(path);
  if (onAuthRoute) return false;

  const isTenantRoot = path === "/" || /^\/t\/[^/]+\/?$/.test(path);
  if (isTenantRoot) return false;

  return !CONSOLE_PATH_PARTS.some((part) => path.includes(part));
}

/**
 * Whether the left rail is the active member nav right now. The director's
 * tenant setting decides whether it exists at all; the viewport decides whether
 * there is room. NavBar reads the same answer to know when to drop the burger,
 * so the two navs are never on screen together.
 */
export function useSideNavActive() {
  const { tenant } = useTenant();
  const { isAuthenticated } = useAuth();
  const enabledForTenant = resolveSideNavEnabled(tenant);
  const nativeApp = isNativeApp();

  const [wideEnough, setWideEnough] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(`(min-width: ${SIDE_NAV_MIN_WIDTH}px)`).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const query = window.matchMedia(`(min-width: ${SIDE_NAV_MIN_WIDTH}px)`);
    const onChange = (event) => setWideEnough(event.matches);
    setWideEnough(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return Boolean(isAuthenticated && enabledForTenant && wideEnough && !nativeApp);
}

/**
 * Collapsed state is a per-member convenience, so it lives in localStorage
 * rather than on the tenant. A browser that refuses storage just starts
 * expanded every time, which is the safe default.
 */
export function useSideNavCollapsed() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDE_NAV_COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(SIDE_NAV_COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      // Storage is unavailable (private window, blocked cookies); the rail
      // still toggles for this session.
    }
  }, [collapsed]);

  return [collapsed, setCollapsed];
}
