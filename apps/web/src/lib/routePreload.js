const warmedRoutes = new Set();

const ROUTE_PRELOADERS = Object.freeze({
  landing: () => import("../cedar/pages/Home.jsx"),
  login: () => import("../cedar/pages/Login.jsx"),
  createAccount: () => import("../cedar/pages/CreateProfileWizard.jsx"),
  home: () => import("../cedar/pages/MainHome.jsx"),
  campAi: () => import("../pages/MemberCampAiPage.jsx"),
  profile: () => import("../cedar/pages/MyProfile.jsx"),
  publicProfile: () => import("../cedar/pages/PublicProfile.jsx"),
  editProfile: () => import("../cedar/pages/EditProfile.jsx"),
  search: () => import("../cedar/pages/AdvancedSearch.jsx"),
  searchResults: () => import("../cedar/pages/SearchResults.jsx"),
  photos: () => import("../cedar/pages/PhotoStream.jsx"),
  chat: () => import("../cedar/pages/ChatAndForums.jsx"),
  events: () => import("../pages/EventsPage.jsx"),
  eventDetail: () => import("../pages/EventDetailPage.jsx"),
  map: () => import("../cedar/pages/LocationMap.jsx"),
  familyTrees: () => import("../cedar/pages/FamilyTrees.jsx"),
  familyTreeCreate: () => import("../cedar/pages/FamilyTreeCreate.jsx"),
  familyTreeView: () => import("../cedar/pages/FamilyTreeView.jsx"),
  newsletter: () => import("../cedar/pages/CedarChest.jsx"),
  notifications: () => import("../pages/MobileNotificationsPage.jsx"),
  directorDashboard: () => import("../pages/admin/DirectorAdminPages.jsx")
});

function tenantRelativePath(pathname = "") {
  const normalized = String(pathname || "/").split("?")[0].split("#")[0] || "/";
  return normalized.replace(/^\/t\/[^/]+(?=\/|$)/i, "") || "/";
}

export function routePreloadKey(pathname = "") {
  const path = tenantRelativePath(pathname).replace(/\/+$/, "") || "/";
  if (path === "/") return "landing";
  if (path === "/login") return "login";
  if (path === "/create-account") return "createAccount";
  if (path === "/home") return "home";
  if (path === "/ai") return "campAi";
  if (path === "/my-profile") return "profile";
  if (/^\/profile\/[^/]+$/i.test(path)) return "publicProfile";
  if (path === "/edit-profile") return "editProfile";
  if (path === "/search") return "search";
  if (path === "/search-results") return "searchResults";
  if (path === "/photo-stream") return "photos";
  if (path === "/chat-rooms" || /^\/chat\/[^/]+$/i.test(path)) return "chat";
  if (path === "/events") return "events";
  if (/^\/events\/[^/]+$/i.test(path)) return "eventDetail";
  if (path === "/location-map") return "map";
  if (path === "/family-trees") return "familyTrees";
  if (path === "/family-trees/new") return "familyTreeCreate";
  if (/^\/family-trees\/[^/]+$/i.test(path)) return "familyTreeView";
  if (path === "/cedar-chest") return "newsletter";
  if (path === "/notifications") return "notifications";
  if (path === "/admin" || path === "/admin/dashboard") return "directorDashboard";
  return "";
}

export function preloadRouteForPath(pathname = "") {
  const key = routePreloadKey(pathname);
  const loader = ROUTE_PRELOADERS[key];
  if (!key || !loader || warmedRoutes.has(key)) return Promise.resolve(false);

  warmedRoutes.add(key);
  return Promise.resolve(loader())
    .then(() => true)
    .catch(() => {
      warmedRoutes.delete(key);
      return false;
    });
}

/**
 * Whether it is reasonable to download a route the user has not asked for.
 *
 * Warming `/home` and `/my-profile` after login is a good trade on a laptop on
 * wifi and a bad one everywhere else: it spent a member's cellular data, and
 * competed for bandwidth with the page they were actually waiting for, on the
 * connections least able to afford it. Guessing is a luxury, so it is now
 * gated on the browser saying the guess is affordable.
 *
 * Anything the user has actually shown intent toward — hovering or focusing a
 * link — is not speculation and is deliberately not gated here.
 */
export function shouldSpeculativelyPreload({
  connection = typeof navigator === "undefined" ? null : navigator.connection,
  visibilityState = typeof document === "undefined" ? "visible" : document.visibilityState,
  online = typeof navigator === "undefined" ? true : navigator.onLine !== false
} = {}) {
  // Nothing speculative is worth doing for a tab nobody is looking at, or for
  // a browser that is not going to complete the request anyway.
  if (visibilityState === "hidden") return false;
  if (!online) return false;

  // No Network Information API (Safari, Firefox) means no evidence either way.
  // Preloading has been the behaviour there all along, so keep it.
  if (!connection) return true;

  // Data Saver is the user asking, in as many words, not to spend their data
  // on things they did not request.
  if (connection.saveData === true) return false;

  const effectiveType = String(connection.effectiveType || "").toLowerCase();
  if (effectiveType === "slow-2g" || effectiveType === "2g") return false;

  return true;
}

export function preloadAuthenticatedCoreRoutes(options = {}) {
  if (!shouldSpeculativelyPreload(options)) return false;
  preloadRouteForPath("/home");
  preloadRouteForPath("/my-profile");
  return true;
}

export function installRouteIntentPreloading() {
  if (typeof document === "undefined" || typeof window === "undefined") return () => {};

  const onIntent = (event) => {
    const target = event.target;
    const anchor = target instanceof Element ? target.closest("a[href]") : null;
    const href = String(anchor?.getAttribute("href") || "").trim();
    if (!href || href.startsWith("#")) return;

    try {
      const url = new URL(href, window.location.href);
      if (url.origin === window.location.origin) preloadRouteForPath(url.pathname);
    } catch {
      // Ignore malformed or non-navigation href values.
    }
  };

  document.addEventListener("pointerover", onIntent, { passive: true });
  document.addEventListener("focusin", onIntent);
  document.addEventListener("touchstart", onIntent, { passive: true });

  return () => {
    document.removeEventListener("pointerover", onIntent);
    document.removeEventListener("focusin", onIntent);
    document.removeEventListener("touchstart", onIntent);
  };
}
