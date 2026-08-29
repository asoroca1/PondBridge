import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { isMemberEventsModuleEnabled } from "@pondbridge/shared";
import { TenantProvider, useTenant } from "./context/TenantContext.jsx";
import { useAuth } from "./context/AuthContext.jsx";
import { MobileNotificationsProvider } from "./context/MobileNotificationsContext.jsx";
import { AppTransitionShell } from "./components/AppTransitionShell.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import { resolveCampName, resolveTenantLogoUrl } from "./lib/campLabels.js";
import { defaultTenantDomain, getAppBaseDomain, inferCampSlugFromHost, isBaseDomain, isPotentialCustomTenantHost, isSuperSubdomain } from "./lib/domain.js";
import { isNativeApp } from "./lib/nativeApp.js";
import { readAuthFromStorage } from "./lib/storage.js";
import { attemptAutomaticChunkRecovery } from "./lib/chunkRecovery.js";
import cedarLogo from "./assets/cedar-logo.png";
import {
  installRouteIntentPreloading,
  preloadAuthenticatedCoreRoutes
} from "./lib/routePreload.js";

function lazyPage(loader) {
  return lazy(() =>
    loader().catch((error) => {
      // An actively requested route can recover once from a stale deployment
      // without turning background prefetch failures into random refreshes.
      if (attemptAutomaticChunkRecovery(error)) {
        return new Promise(() => {});
      }
      throw error;
    })
  );
}

const CedarHomePage = lazyPage(() => import("./cedar/pages/Home.jsx"));
const CedarLoginPage = lazyPage(() => import("./cedar/pages/Login.jsx"));
const CedarForgotPasswordPage = lazyPage(() => import("./cedar/pages/ForgotPassword.jsx"));
const CedarCreateProfileWizardPage = lazyPage(() => import("./cedar/pages/CreateProfileWizard.jsx"));
const CedarMainHomePage = lazyPage(() => import("./cedar/pages/MainHome.jsx"));
const CedarMyProfilePage = lazyPage(() => import("./cedar/pages/MyProfile.jsx"));
const CedarEditProfilePage = lazyPage(() => import("./cedar/pages/EditProfile.jsx"));
const CedarAdvancedSearchPage = lazyPage(() => import("./cedar/pages/AdvancedSearch.jsx"));
const CedarPhotoStreamPage = lazyPage(() => import("./cedar/pages/PhotoStream.jsx"));
const CedarChatAndForumsPage = lazyPage(() => import("./cedar/pages/ChatAndForums.jsx"));
const CedarChestPage = lazyPage(() => import("./cedar/pages/CedarChest.jsx"));
const CedarLocationMapPage = lazyPage(() => import("./cedar/pages/LocationMap.jsx"));
const CedarSearchResultsPage = lazyPage(() => import("./cedar/pages/SearchResults.jsx"));
const CedarPublicProfilePage = lazyPage(() => import("./cedar/pages/PublicProfile.jsx"));
const CedarLegalPage = lazyPage(() => import("./cedar/pages/Legal.jsx"));
const CedarFamilyTreesPage = lazyPage(() => import("./cedar/pages/FamilyTrees.jsx"));
const CedarFamilyTreeCreatePage = lazyPage(() => import("./cedar/pages/FamilyTreeCreate.jsx"));
const CedarFamilyTreeViewPage = lazyPage(() => import("./cedar/pages/FamilyTreeView.jsx"));
const EventsPage = lazyPage(() => import("./pages/EventsPage.jsx"));
const EventDetailPage = lazyPage(() => import("./pages/EventDetailPage.jsx"));
const GivingPage = lazyPage(() => import("./pages/GivingPage.jsx"));
const GivingCausePage = lazyPage(() => import("./pages/GivingCausePage.jsx"));
const GivingCreateCausePage = lazyPage(() => import("./pages/GivingCreateCausePage.jsx"));
const MobileNotificationsPage = lazyPage(() => import("./pages/MobileNotificationsPage.jsx"));
const MemberCampAiPage = lazyPage(() => import("./pages/MemberCampAiPage.jsx"));
const AppShell = lazyPage(() => import("./components/AppShell.jsx"));
const TenantAuthCallbackPage = lazyPage(() => import("./pages/TenantAuthCallbackPage.jsx"));
const TenantAccessPendingPage = lazyPage(() => import("./pages/TenantAccessPendingPage.jsx"));
const SuperLoginPage = lazyPage(() => import("./pages/SuperLoginPage.jsx"));
const MobileCampCodeEntryPage = lazyPage(() => import("./pages/MobileCampCodeEntryPage.jsx"));
const NotFoundPage = lazyPage(() => import("./pages/NotFoundPage.jsx"));
const NativeAppExperience = lazyPage(() => import("./components/NativeAppExperience.jsx"));

const DirectorOnboardingCommandCenterPage = lazyPage(() => import("./pages/DirectorOnboardingCommandCenterPage.jsx"));
const DirectorOnboardingAgentPage = lazyPage(() => import("./pages/DirectorOnboardingAgentPage.jsx"));
const DirectorClaimPage = lazyPage(() => import("./pages/DirectorClaimPage.jsx"));
const DirectorCreateAccountPage = lazyPage(() => import("./pages/DirectorCreateAccountPage.jsx"));
const DirectorLegalAgreementPage = lazyPage(() => import("./pages/DirectorLegalAgreementPage.jsx"));
const DirectorAdminLayout = lazyPage(() => import("./pages/admin/DirectorAdminLayout.jsx"));
const DirectorAdminCopilotPage = lazyPage(() => import("./pages/admin/DirectorAdminCopilotPage.jsx"));
const DirectorAdminBillingPage = lazyPage(() => import("./pages/admin/DirectorAdminBillingPage.jsx"));
const DirectorAdminDashboardPage = lazyPage(() =>
  import("./pages/admin/DirectorAdminPages.jsx").then((module) => ({ default: module.DirectorAdminDashboardPage }))
);
const DirectorAdminMailPage = lazyPage(() => import("./pages/admin/DirectorAdminMailPage.jsx"));
const DirectorAdminEventsPage = lazyPage(() => import("./pages/admin/DirectorAdminEventsPage.jsx"));
const DirectorAdminGivingPage = lazyPage(() => import("./pages/admin/DirectorAdminGivingPage.jsx"));
const DirectorAdminFeaturesPage = lazyPage(() =>
  import("./pages/admin/DirectorAdminPages.jsx").then((module) => ({ default: module.DirectorAdminFeaturesPage }))
);
const DirectorAdminPeoplePage = lazyPage(() => import("./pages/admin/DirectorAdminPeoplePage.jsx"));
const DirectorAdminMemberEditPage = lazyPage(() => import("./pages/admin/DirectorAdminMemberEditPage.jsx"));
const DirectorAdminSettingsAdminsPage = lazyPage(() =>
  import("./pages/admin/DirectorAdminSettingsAdminsPage.jsx")
);
const DirectorAdminSettingsBrandingPage = lazyPage(() =>
  import("./pages/admin/DirectorAdminPages.jsx").then((module) => ({
    default: module.DirectorAdminSettingsBrandingPage
  }))
);
const DirectorAdminSettingsAccessPage = lazyPage(() => import("./pages/admin/DirectorAdminSettingsAccessPage.jsx"));
const DirectorAdminSettingsDangerPage = lazyPage(() => import("./pages/admin/DirectorAdminSettingsDangerPage.jsx"));
const DirectorAdminSettingsSupportPage = lazyPage(() =>
  import("./pages/admin/DirectorAdminSettingsSupportPage.jsx")
);
const DirectorAdminSettingsNotificationsPage = lazyPage(() =>
  import("./pages/admin/DirectorAdminNotificationsPage.jsx")
);
const DirectorAdminSettingsLayout = lazyPage(() => import("./pages/admin/DirectorAdminSettingsLayout.jsx"));
const DirectorAdminSettingsNetworkPage = lazyPage(() =>
  import("./pages/admin/DirectorAdminPages.jsx").then((module) => ({
    default: module.DirectorAdminSettingsNetworkPage
  }))
);
const PlatformLandingPage = lazyPage(() => import("./pages/PlatformLandingPage.jsx"));
const EmailPreferencesPage = lazyPage(() => import("./pages/EmailPreferencesPage.jsx"));
const SuperShellLayout = lazyPage(() => import("./pages/super/SuperShellLayout.jsx"));
const SuperOperationsAgentPage = lazyPage(() => import("./pages/super/SuperOperationsAgentPage.jsx"));
const SuperStatusPage = lazyPage(() => import("./pages/super/SuperStatusPage.jsx"));
const SuperBillingFailedPage = lazyPage(() =>
  import("./pages/super/SuperPages.jsx").then((module) => ({ default: module.SuperBillingFailedPage }))
);
const SuperBillingTenantsPage = lazyPage(() =>
  import("./pages/super/SuperPages.jsx").then((module) => ({ default: module.SuperBillingTenantsPage }))
);
const SuperEmailTransactionalPage = lazyPage(() =>
  import("./pages/super/SuperPages.jsx").then((module) => ({ default: module.SuperEmailTransactionalPage }))
);
const SuperSettingsPage = lazyPage(() =>
  import("./pages/super/SuperPages.jsx").then((module) => ({ default: module.SuperSettingsPage }))
);
const SuperTenantCreatePage = lazyPage(() =>
  import("./pages/super/SuperPages.jsx").then((module) => ({ default: module.SuperTenantCreatePage }))
);
const SuperTenantsPage = lazyPage(() =>
  import("./pages/super/SuperPages.jsx").then((module) => ({ default: module.SuperTenantsPage }))
);

const DEFAULT_TAB_TITLE = "PondBridge";
const DEFAULT_FAVICON_PATH = "/favicon.svg";

function normalizeTenantKey(value = "") {
  return String(value || "").trim().toLowerCase();
}

function resolveTenantTabTitle(tenant) {
  const campName = String(resolveCampName(tenant) || "").trim();
  if (!campName) return DEFAULT_TAB_TITLE;
  const labeledCampName = /^camp\s+/i.test(campName) ? campName : `Camp ${campName}`;
  return `${labeledCampName} Alumni Network`;
}

function iconMimeTypeFromUrl(url = "") {
  const normalized = String(url || "").split("#")[0].split("?")[0].trim().toLowerCase();
  if (normalized.endsWith(".svg")) return "image/svg+xml";
  if (normalized.endsWith(".png")) return "image/png";
  if (normalized.endsWith(".jpg") || normalized.endsWith(".jpeg")) return "image/jpeg";
  if (normalized.endsWith(".ico")) return "image/x-icon";
  if (normalized.endsWith(".webp")) return "image/webp";
  return "";
}

function ensureHeadLink(relValue) {
  if (typeof document === "undefined") return null;
  let link = document.querySelector(`link[rel="${relValue}"]`);
  if (!link) {
    link = document.createElement("link");
    link.setAttribute("rel", relValue);
    document.head.appendChild(link);
  }
  return link;
}

function setIconHref(link, href = "") {
  if (!link) return;
  const resolvedHref = String(href || "").trim() || DEFAULT_FAVICON_PATH;
  link.setAttribute("href", resolvedHref);
  const mimeType = iconMimeTypeFromUrl(resolvedHref);
  if (mimeType) {
    link.setAttribute("type", mimeType);
  } else {
    link.removeAttribute("type");
  }
}

function TenantScopeLayout() {
  const { slug } = useParams();

  return (
    <TenantProvider slug={slug}>
      <TenantScopeRoutes />
    </TenantProvider>
  );
}

function SubdomainCampLayout() {
  const slug = inferCampSlugFromHost();

  if (!slug) {
    return <Navigate to="/404" replace />;
  }

  return (
    <TenantProvider slug={slug}>
      <TenantScopeRoutes />
    </TenantProvider>
  );
}

function CustomDomainCampLayout() {
  return (
    <TenantProvider>
      <TenantScopeRoutes />
    </TenantProvider>
  );
}

function RouteLoadingFallback({ compact = false }) {
  return <AppTransitionShell compact={compact} />;
}

function MemberEventsRoute({ children }) {
  const { tenant, slug: tenantSlug } = useTenant();
  const params = useParams();
  const slug = params.slug || tenantSlug;

  if (!isMemberEventsModuleEnabled(tenant?.modules?.events)) {
    return <Navigate to={slug ? `/t/${slug}/home` : "/home"} replace />;
  }

  return children;
}

function MemberModuleRoute({ moduleKey, children, fallbackPath = "/home" }) {
  const { tenant, slug: tenantSlug } = useTenant();
  const params = useParams();
  const slug = params.slug || tenantSlug;
  const modules = tenant?.config?.modules || tenant?.modules || {};

  if (modules?.[moduleKey] === false) {
    return <Navigate to={slug ? `/t/${slug}${fallbackPath}` : fallbackPath} replace />;
  }

  return children;
}

function AdminBillingRoute({ children }) {
  const { tenant, slug: tenantSlug } = useTenant();
  const params = useParams();
  const slug = params.slug || tenantSlug;

  if (tenant?.accessSettings?.demoAccessEnabled) {
    return <Navigate to={slug ? `/t/${slug}/admin/dashboard` : "/admin/dashboard"} replace />;
  }

  return children;
}

function TenantScopeRoutes() {
  const { loading, error, tenant, slug: tenantSlug } = useTenant();
  const { isAuthenticated, isReady, user, authProvider, refreshSession, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams();
  const slug = params.slug || tenantSlug;
  const membershipSyncKeyRef = useRef("");
  const membershipSyncInFlightRef = useRef(false);
  const [wrongNetwork, setWrongNetwork] = useState(null);
  const [allowAuthCallbackRedirect, setAllowAuthCallbackRedirect] = useState(false);
  const isCampDirectorSession = Boolean(isAuthenticated && user?.roles?.includes("tenant_admin"));
  const configuredTenantLogoUrl = resolveTenantLogoUrl(tenant);
  const tenantLogoUrl = configuredTenantLogoUrl || (["cedar", "camp-cedar"].includes(normalizeTenantKey(slug)) ? cedarLogo : "");
  const tenantTabTitle = resolveTenantTabTitle(tenant);
  const isCampDirector = isCampDirectorSession;
  const clerkMode = ["clerk", "hybrid"].includes(String(authProvider || "").toLowerCase());
  const onboardingIncomplete = tenant?.onboardingStatus !== "live";
  const currentPath = location.pathname || "";
  const directorSetupPath = slug ? `/t/${slug}/director-create-account?setup=1` : "/director-create-account?setup=1";
  const onOnboardingRoute =
    currentPath.includes("/onboarding") ||
    currentPath.includes("/director-claim") ||
    currentPath.includes("/director-create-account");
  const inviteToken = new URLSearchParams(location.search || "").get("inviteToken");
  const nativeApp = isNativeApp();
  const cachedNativeAuth = nativeApp ? readAuthFromStorage() : { token: "", user: null };
  const hasNativeCachedSession = nativeApp && Boolean((isAuthenticated || cachedNativeAuth.token) && (user || cachedNativeAuth.user));
  const onMemberCreateAccountRoute =
    (currentPath === "/create-account" || currentPath.endsWith("/create-account")) &&
    !currentPath.includes("/director-create-account");
  const onAuthBootstrapRoute =
    currentPath.includes("/auth/callback") ||
    currentPath.includes("/director-claim") ||
    currentPath.includes("/director-create-account") ||
    currentPath.includes("/login") ||
    currentPath.includes("/create-account") ||
    currentPath.includes("/request-access");
  const waitingForTenantScopedUser = clerkMode && isAuthenticated && !user && !onAuthBootstrapRoute;
  const demoAccessEnabled = Boolean(tenant?.accessSettings?.demoAccessEnabled);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;

    const previousTitle = String(document.title || DEFAULT_TAB_TITLE);
    const iconLink = ensureHeadLink("icon");
    const shortcutIconLink = ensureHeadLink("shortcut icon");
    const appleTouchIconLink = ensureHeadLink("apple-touch-icon");
    const previousIconHref = String(iconLink?.getAttribute("href") || "");
    const previousIconType = String(iconLink?.getAttribute("type") || "");
    const previousShortcutHref = String(shortcutIconLink?.getAttribute("href") || "");
    const previousShortcutType = String(shortcutIconLink?.getAttribute("type") || "");
    const previousAppleHref = String(appleTouchIconLink?.getAttribute("href") || "");

    document.title = tenantTabTitle;
    setIconHref(iconLink, tenantLogoUrl);
    setIconHref(shortcutIconLink, tenantLogoUrl);
    if (appleTouchIconLink) {
      appleTouchIconLink.setAttribute("href", tenantLogoUrl || DEFAULT_FAVICON_PATH);
    }

    return () => {
      document.title = previousTitle;
      setIconHref(iconLink, previousIconHref || DEFAULT_FAVICON_PATH);
      if (iconLink) {
        if (previousIconType) iconLink.setAttribute("type", previousIconType);
        else iconLink.removeAttribute("type");
      }
      setIconHref(shortcutIconLink, previousShortcutHref || DEFAULT_FAVICON_PATH);
      if (shortcutIconLink) {
        if (previousShortcutType) shortcutIconLink.setAttribute("type", previousShortcutType);
        else shortcutIconLink.removeAttribute("type");
      }
      if (appleTouchIconLink) {
        appleTouchIconLink.setAttribute("href", previousAppleHref || DEFAULT_FAVICON_PATH);
      }
    };
  }, [tenantLogoUrl, tenantTabTitle]);

  useEffect(() => {
    const clerkMode = ["clerk", "hybrid"].includes(String(authProvider || "").toLowerCase());
    const path = String(location.pathname || "");
    const onSyncBlockedRoute =
      path.includes("/auth/callback") ||
      path.includes("/director-claim") ||
      path.includes("/director-create-account") ||
      path.includes("/request-access");
    // Wait for auth to be fully ready before syncing membership. This prevents
    // firing a second refreshSession while the initial bootstrap is in flight,
    // which was a major source of cascading re-renders and glitching.
    if (!clerkMode || !isReady || !isAuthenticated || !slug || loading || Boolean(error) || !tenant || onSyncBlockedRoute) {
      membershipSyncKeyRef.current = "";
      membershipSyncInFlightRef.current = false;
      return;
    }

    const syncKey = `${String(authProvider || "").toLowerCase()}:${slug}:signed-in`;
    if (membershipSyncKeyRef.current === syncKey) return;

    const tenantId = String(tenant?.id || tenant?._id || "").trim();
    const userTenantId = String(user?.tenantId || "").trim();
    const resolvedTenantSlug = normalizeTenantKey(slug || tenant?.slug || "");
    const userTenantSlug = normalizeTenantKey(user?.tenantSlug || "");
    const isSuperAdmin = Boolean(user?.roles?.includes("super_admin"));
    const onDirectorBootstrapRoute =
      path.includes("/director-claim") || path.includes("/director-create-account");
    const alreadyScopedToTenant = Boolean(
      user &&
        ((tenantId && userTenantId && userTenantId === tenantId) ||
          (resolvedTenantSlug && userTenantSlug && userTenantSlug === resolvedTenantSlug) ||
          (isSuperAdmin && !onDirectorBootstrapRoute))
    );
    if (alreadyScopedToTenant) {
      membershipSyncKeyRef.current = syncKey;
      membershipSyncInFlightRef.current = false;
      return;
    }

    membershipSyncKeyRef.current = syncKey;
    membershipSyncInFlightRef.current = true;
    refreshSession({ tenantSlug: slug })
      .catch(() => {})
      .finally(() => {
        membershipSyncInFlightRef.current = false;
      });
  }, [authProvider, error, isAuthenticated, isReady, loading, location.pathname, refreshSession, slug, tenant, user]);

  useEffect(() => {
    const path = String(location.pathname || "");
    const onAuthBootstrapRoute =
      path.includes("/auth/callback") ||
      path.includes("/director-claim") ||
      path.includes("/director-create-account") ||
      path.includes("/login") ||
      path.includes("/create-account") ||
      path.includes("/request-access");
    const clerkMode = ["clerk", "hybrid"].includes(String(authProvider || "").toLowerCase());
    const tenantId = String(tenant?.id || tenant?._id || "").trim();
    const userTenantId = String(user?.tenantId || "").trim();
    const isSuperAdmin = Boolean(user?.roles?.includes("super_admin"));
    if (
      wrongNetwork ||
      !isReady ||
      membershipSyncInFlightRef.current ||
      (clerkMode && onAuthBootstrapRoute) ||
      !isAuthenticated ||
      !tenantId ||
      !userTenantId ||
      isSuperAdmin ||
      tenantId === userTenantId
    ) {
      return;
    }

    let cancelled = false;
    Promise.resolve(logout?.()).finally(() => {
      if (cancelled) return;
      const nextWrongNetwork = {
        expectedSlug: String(user?.tenantSlug || "").trim().toLowerCase(),
        currentSlug: String(slug || tenant?.slug || "").trim().toLowerCase()
      };
      setWrongNetwork(nextWrongNetwork);

      const loginParams = new URLSearchParams();
      loginParams.set("authIssue", "wrong_network");
      const targetSlug = nextWrongNetwork.currentSlug;
      if (targetSlug) {
        navigate(`/t/${targetSlug}/login?${loginParams.toString()}`, { replace: true });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [authProvider, isAuthenticated, isReady, location.pathname, logout, navigate, slug, tenant, user, wrongNetwork]);

  useEffect(() => {
    if (!isReady || loading || !tenant || !isAuthenticated) return;
    const path = String(location.pathname || "");
    const onAuthBootstrapRoute =
      path.includes("/auth/callback") ||
      path.includes("/director-claim") ||
      path.includes("/director-create-account") ||
      path.includes("/login") ||
      path.includes("/create-account") ||
      path.includes("/request-access");
    if (onAuthBootstrapRoute) return;

    let cancelled = false;
    let idleHandle = null;
    let timeoutHandle = null;
    const scheduleWarmup = () => {
      if (cancelled) return;
      preloadAuthenticatedCoreRoutes();
    };

    if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
      idleHandle = window.requestIdleCallback(scheduleWarmup, { timeout: 2500 });
    } else {
      timeoutHandle = window.setTimeout(scheduleWarmup, 1500);
    }

    return () => {
      cancelled = true;
      if (idleHandle != null && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleHandle);
      }
      if (timeoutHandle != null) {
        window.clearTimeout(timeoutHandle);
      }
    };
  }, [isAuthenticated, isReady, loading, location.pathname, tenant]);

  useEffect(() => {
    if (!waitingForTenantScopedUser) {
      setAllowAuthCallbackRedirect(false);
      return;
    }

    let cancelled = false;
    setAllowAuthCallbackRedirect(false);
    const timeoutId = window.setTimeout(() => {
      if (!cancelled) setAllowAuthCallbackRedirect(true);
    }, 1800);

    refreshSession({ tenantSlug: slug || "" }).catch(() => {});

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [refreshSession, slug, waitingForTenantScopedUser]);

  function expectedNetworkHref(expectedSlug = "") {
    const normalizedSlug = String(expectedSlug || "").trim().toLowerCase();
    if (!normalizedSlug || typeof window === "undefined") return "";

    const currentHost = String(window.location.hostname || "").trim().toLowerCase();
    const isLocal = currentHost === "localhost" || currentHost.endsWith(".localhost");
    if (isLocal) {
      const protocol = String(window.location.protocol || "http:");
      const port = String(window.location.port || "5173");
      return `${protocol}//${normalizedSlug}.localhost:${port}/login`;
    }

    const domain = defaultTenantDomain(normalizedSlug);
    if (!domain) return "";
    return `https://${domain}/login`;
  }

  if (loading) {
    return <AppTransitionShell />;
  }

  if (!isReady && !hasNativeCachedSession) {
    return <AppTransitionShell />;
  }

  if (error) {
    const normalizedError = String(error || "").toLowerCase();
    const schemaMissing = normalizedError.includes("supabase:apply-schema");
    const apiUnavailable =
      normalizedError.includes("could not reach api server") ||
      normalizedError.includes("api_unreachable") ||
      normalizedError.includes("load failed") ||
      normalizedError.includes("failed to fetch");
    return (
      <section className="app-status-shell is-error">
        <div className="app-status-card">
          <h1>Unable to load this network</h1>
          <p>{error}</p>
          {schemaMissing ? (
            <ol className="app-status-steps">
              <li>Run `npm --workspace @pondbridge/api run supabase:apply-schema`</li>
              <li>Run `npm --workspace @pondbridge/api run seed`</li>
              <li>Refresh this page</li>
            </ol>
          ) : null}
          {apiUnavailable ? (
            <ol className="app-status-steps">
              <li>Run `npm --workspace @pondbridge/api run dev`</li>
              <li>Confirm `apps/web/.env` has the correct `VITE_API_BASE` value</li>
              <li>Refresh this page</li>
            </ol>
          ) : null}
        </div>
      </section>
    );
  }

  if (wrongNetwork) {
    const destination = expectedNetworkHref(wrongNetwork.expectedSlug);
    return (
      <section className="app-status-shell is-error">
        <div className="app-status-card">
          <h1>Wrong network for this account</h1>
          <p>
            Your session belongs to a different camp network and has been signed out for security.
          </p>
          {destination ? (
            <p>
              <a href={destination}>Go to your network sign-in</a>
            </p>
          ) : null}
        </div>
      </section>
    );
  }

  if (waitingForTenantScopedUser && !allowAuthCallbackRedirect && !hasNativeCachedSession) {
    return <AppTransitionShell />;
  }

  if (waitingForTenantScopedUser && !hasNativeCachedSession) {
    const callbackPath = slug ? `/t/${slug}/auth/callback` : "/auth/callback";
    return <Navigate to={callbackPath} replace />;
  }

  const routeFallback = nativeApp ? null : <RouteLoadingFallback compact />;

  if (isCampDirector && onboardingIncomplete && !onOnboardingRoute) {
    return <Navigate to={directorSetupPath} replace />;
  }

  if (!isCampDirector && onboardingIncomplete && onMemberCreateAccountRoute && !inviteToken) {
    return <Navigate to={slug ? `/t/${slug}/login` : "/login"} replace />;
  }

  if (demoAccessEnabled && onMemberCreateAccountRoute) {
    return <Navigate to={slug ? `/t/${slug}/login` : "/login"} replace />;
  }

  return (
    <MobileNotificationsProvider>
    <AppShell>
      <ErrorBoundary level="page">
      <Suspense fallback={routeFallback}>
      <Routes>
        <Route index element={onboardingIncomplete ? <DirectorClaimPage /> : <CedarHomePage />} />
        <Route path="login/*" element={<CedarLoginPage />} />
        <Route path="forgot-password" element={<CedarForgotPasswordPage />} />
        <Route
          path="create-account/*"
          element={demoAccessEnabled ? <Navigate to={slug ? `/t/${slug}/login` : "/login"} replace /> : <CedarCreateProfileWizardPage />}
        />
        <Route path="auth/callback" element={<TenantAuthCallbackPage />} />
        <Route path="request-access" element={<TenantAccessPendingPage />} />
        <Route path="director-claim" element={<DirectorClaimPage />} />
        <Route path="director-create-account/*" element={<DirectorCreateAccountPage />} />
        <Route path="director-legal" element={<DirectorLegalAgreementPage />} />
        <Route path="legal" element={<CedarLegalPage />} />

        <Route
          path="home"
          element={
            <ProtectedRoute>
              <CedarMainHomePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="ai"
          element={
            <ProtectedRoute>
              <MemberCampAiPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="my-profile"
          element={
            <ProtectedRoute>
              <CedarMyProfilePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="edit-profile"
          element={
            <ProtectedRoute>
              <CedarEditProfilePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="search"
          element={
            <ProtectedRoute>
              <MemberModuleRoute moduleKey="search">
                <CedarAdvancedSearchPage />
              </MemberModuleRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="profile/:id"
          element={
            <ProtectedRoute>
              <MemberModuleRoute moduleKey="directory">
                <CedarPublicProfilePage />
              </MemberModuleRoute>
            </ProtectedRoute>
          }
        />

        <Route
          path="photo-stream"
          element={
            <ProtectedRoute>
              <MemberModuleRoute moduleKey="photoStream">
                <CedarPhotoStreamPage />
              </MemberModuleRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="chat-rooms"
          element={
            <ProtectedRoute>
              <MemberModuleRoute moduleKey="chat">
                <CedarChatAndForumsPage />
              </MemberModuleRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="chat/:id"
          element={
            <ProtectedRoute>
              <MemberModuleRoute moduleKey="chat">
                <CedarChatAndForumsPage />
              </MemberModuleRoute>
            </ProtectedRoute>
          }
        />
        {/* `newsletter` is the name every camp sees; `cedar-chest` is the
            original path, kept so existing links and bookmarks still resolve. */}
        {["newsletter", "cedar-chest"].map((newsletterPath) => (
          <Route
            key={newsletterPath}
            path={newsletterPath}
            element={
              <ProtectedRoute>
                <MemberModuleRoute moduleKey="newsletter">
                  <CedarChestPage />
                </MemberModuleRoute>
              </ProtectedRoute>
            }
          />
        ))}
        <Route
          path="location-map"
          element={
            <ProtectedRoute>
              <MemberModuleRoute moduleKey="map">
                <CedarLocationMapPage />
              </MemberModuleRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="search-results"
          element={
            <ProtectedRoute>
              <MemberModuleRoute moduleKey="search">
                <CedarSearchResultsPage />
              </MemberModuleRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="family-trees"
          element={
            <ProtectedRoute>
              <MemberModuleRoute moduleKey="familyTrees">
                <CedarFamilyTreesPage />
              </MemberModuleRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="family-trees/new"
          element={
            <ProtectedRoute>
              <MemberModuleRoute moduleKey="familyTrees">
                <CedarFamilyTreeCreatePage />
              </MemberModuleRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="family-trees/:id"
          element={
            <ProtectedRoute>
              <MemberModuleRoute moduleKey="familyTrees">
                <CedarFamilyTreeViewPage />
              </MemberModuleRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="events"
          element={
            <ProtectedRoute>
              <MemberEventsRoute>
                <EventsPage />
              </MemberEventsRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="events/:eventId"
          element={
            <ProtectedRoute>
              <MemberEventsRoute>
                <EventDetailPage />
              </MemberEventsRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="giving"
          element={
            <ProtectedRoute>
              <MemberModuleRoute moduleKey="giving">
                <GivingPage />
              </MemberModuleRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="giving/new"
          element={
            <ProtectedRoute>
              <MemberModuleRoute moduleKey="giving">
                <GivingCreateCausePage />
              </MemberModuleRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="giving/:causeId"
          element={
            <ProtectedRoute>
              <MemberModuleRoute moduleKey="giving">
                <GivingCausePage />
              </MemberModuleRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="notifications"
          element={
            <ProtectedRoute>
              <MobileNotificationsPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="admin"
          element={
            <ProtectedRoute role="tenant_admin">
              <DirectorAdminLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<DirectorAdminDashboardPage />} />
          <Route path="copilot" element={<DirectorAdminCopilotPage />} />
          <Route path="people" element={<Navigate to="all" replace />} />
          <Route path="people/:view" element={<DirectorAdminPeoplePage />} />
          <Route path="growth" element={<Navigate to="../people/all" replace />} />
          <Route path="members/:profileId/edit" element={<DirectorAdminMemberEditPage />} />
          {/* Members, approvals, and invitations merged into the People workspace;
              these paths stay live for bookmarks and older emails. */}
          <Route path="members" element={<Navigate to="../people/member" replace />} />
          <Route path="members/approvals" element={<Navigate to="../people/request" replace />} />
          <Route path="members/import" element={<Navigate to="../people/add" replace />} />
          <Route path="invites" element={<Navigate to="../people/add" replace />} />
          <Route path="directory" element={<Navigate to="../people/member" replace />} />
          <Route path="family-trees" element={<Navigate to="../features" replace />} />
          <Route
            path="events"
            element={
              <MemberModuleRoute moduleKey="events" fallbackPath="/admin/features">
                <DirectorAdminEventsPage />
              </MemberModuleRoute>
            }
          />
          <Route
            path="giving"
            element={
              <MemberModuleRoute moduleKey="giving" fallbackPath="/admin/features">
                <DirectorAdminGivingPage />
              </MemberModuleRoute>
            }
          />
          <Route path="communications" element={<Navigate to="../email/compose" replace />} />
          <Route path="email" element={<Navigate to="compose" replace />} />
          {/* The old history route is bookmarked in older invites and emails. */}
          <Route path="email/history" element={<Navigate to="../email/sent" replace />} />
          <Route path="email/:folder" element={<DirectorAdminMailPage />} />
          <Route path="analytics" element={<Navigate to="../dashboard" replace />} />
          <Route path="features" element={<Navigate to="../settings/features" replace />} />
          <Route
            path="billing"
            element={
              <AdminBillingRoute>
                <DirectorAdminBillingPage />
              </AdminBillingRoute>
            }
          />
          <Route path="settings" element={<DirectorAdminSettingsLayout />}>
            <Route index element={<Navigate to="network" replace />} />
            <Route path="network" element={<DirectorAdminSettingsNetworkPage />} />
            <Route path="features" element={<DirectorAdminFeaturesPage />} />
            <Route path="branding" element={<DirectorAdminSettingsBrandingPage />} />
            <Route path="access" element={<DirectorAdminSettingsAccessPage />} />
            <Route path="admins" element={<DirectorAdminSettingsAdminsPage />} />
            <Route path="support" element={<DirectorAdminSettingsSupportPage />} />
            <Route path="notifications" element={<DirectorAdminSettingsNotificationsPage />} />
            <Route path="danger" element={<DirectorAdminSettingsDangerPage />} />
          </Route>
          <Route path="*" element={<Navigate to="dashboard" replace />} />
        </Route>

        <Route
          path="onboarding"
          element={
            <ProtectedRoute role="tenant_admin">
              <DirectorOnboardingAgentPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="onboarding/details"
          element={
            <ProtectedRoute role="tenant_admin">
              <DirectorOnboardingCommandCenterPage />
            </ProtectedRoute>
          }
        />
        <Route path="onboarding/wizard" element={<Navigate to={slug ? `/t/${slug}/onboarding` : "/onboarding"} replace />} />

        <Route
          path="settings/branding"
          element={<Navigate to={slug ? `/t/${slug}/admin/settings/branding` : "/admin/settings/branding"} replace />}
        />
        <Route
          path="settings/signup"
          element={<Navigate to={slug ? `/t/${slug}/admin/settings/network` : "/admin/settings/network"} replace />}
        />
        <Route
          path="settings/content"
          element={<Navigate to={slug ? `/t/${slug}/admin/settings/network` : "/admin/settings/network"} replace />}
        />
        <Route
          path="settings/admins"
          element={<Navigate to={slug ? `/t/${slug}/admin/settings/admins` : "/admin/settings/admins"} replace />}
        />
        <Route
          path="settings/support"
          element={<Navigate to={slug ? `/t/${slug}/admin/settings/support` : "/admin/settings/support"} replace />}
        />
        <Route
          path="settings/imports"
          element={<Navigate to={slug ? `/t/${slug}/admin/people/add` : "/admin/people/add"} replace />}
        />

        <Route path="main-home" element={<Navigate to={slug ? `/t/${slug}/home` : "/home"} replace />} />
        <Route path="advanced-search" element={<Navigate to={slug ? `/t/${slug}/search` : "/search"} replace />} />
        <Route path="directory" element={<Navigate to={slug ? `/t/${slug}/search` : "/search"} replace />} />
        <Route path="search-old" element={<Navigate to={slug ? `/t/${slug}/search` : "/search"} replace />} />
        <Route path="admin/onboarding" element={<Navigate to={slug ? `/t/${slug}/onboarding` : "/onboarding"} replace />} />
        <Route path="admin/import" element={<Navigate to={slug ? `/t/${slug}/admin/people/add` : "/admin/people/add"} replace />} />
        <Route path="admin/analytics" element={<Navigate to={slug ? `/t/${slug}/admin/dashboard` : "/admin/dashboard"} replace />} />
        <Route
          path="admin/billing"
          element={
            <Navigate
              to={
                demoAccessEnabled
                  ? (slug ? `/t/${slug}/admin/dashboard` : "/admin/dashboard")
                  : (slug ? `/t/${slug}/admin/billing` : "/admin/billing")
              }
              replace
            />
          }
        />

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      </Suspense>
      </ErrorBoundary>
    </AppShell>
    </MobileNotificationsProvider>
  );
}

function redirectSlug() {
  return inferCampSlugFromHost() || localStorage.getItem("pondbridgeTenantSlug") || "";
}

function rememberedNativeTenantSlug() {
  if (typeof window === "undefined") return "";
  return String(localStorage.getItem("pondbridgeTenantSlug") || "").trim().toLowerCase();
}

function LegacyRootRedirect() {
  const location = useLocation();
  const slug = redirectSlug();
  if (!slug) {
    return <Navigate to="/super/login" replace />;
  }
  const path = location.pathname || "/";
  return (
    <Navigate
      to={`/t/${slug}${path}${location.search || ""}${location.hash || ""}`}
      replace
    />
  );
}

function SuperSubdomainRedirect() {
  const location = useLocation();
  useEffect(() => {
    const baseDomain = getAppBaseDomain();
    const path = String(location.pathname || "/");
    const dest = `https://super.${baseDomain}${path}${location.search || ""}${location.hash || ""}`;
    window.location.replace(dest);
  }, [location]);
  return null;
}

function SuperAliasRedirect() {
  const location = useLocation();
  const nextPath = (location.pathname || "/admin").replace(/^\/admin/, "/super");
  return <Navigate to={`${nextPath}${location.search || ""}${location.hash || ""}`} replace />;
}

function HostScopedTenantRedirect() {
  const location = useLocation();
  const nextPath = String(location.pathname || "/").replace(/^\/t\/[^/]+/, "") || "/";
  return <Navigate to={`${nextPath}${location.search || ""}${location.hash || ""}`} replace />;
}

function NativeAppRoot() {
  const { isAuthenticated, isReady, user } = useAuth();
  const rememberedSlug = rememberedNativeTenantSlug();

  if (!isReady) {
    return <RouteLoadingFallback />;
  }

  if (isAuthenticated && user?.roles?.includes("super_admin")) {
    return <MobileCampCodeEntryPage />;
  }

  if (isAuthenticated && rememberedSlug) {
    return <Navigate to={`/t/${rememberedSlug}/home`} replace />;
  }

  if (rememberedSlug) {
    return <Navigate to={`/t/${rememberedSlug}/login`} replace />;
  }

  return <MobileCampCodeEntryPage />;
}

export default function App() {
  const location = useLocation();
  const hostCampSlug = inferCampSlugFromHost();
  const rememberedSlug = localStorage.getItem("pondbridgeTenantSlug") || "";
  const customDomainHost = isPotentialCustomTenantHost();
  const rootDomain = isBaseDomain();
  const superSubdomain = isSuperSubdomain();
  const nativeApp = isNativeApp();
  const legacyRedirectEnabled = Boolean(!hostCampSlug && !customDomainHost && !rootDomain && !superSubdomain && rememberedSlug);
  const routeFallback = nativeApp ? null : <RouteLoadingFallback />;

  useEffect(() => installRouteIntentPreloading(), []);

  // Use a key-based CSS animation for route transitions instead of React state.
  // This avoids re-rendering the entire component tree on every navigation,
  // which was causing cascading glitches and visual flicker.
  const routeKey = `${location.pathname}${location.search}${location.hash}`;

  return (
    <>
    {nativeApp ? (
      <Suspense fallback={null}>
        <NativeAppExperience />
      </Suspense>
    ) : null}
    <div className="app-route-shell">
      <div className="app-route-progress" key={routeKey} aria-hidden="true" />
      <div className="app-route-stage">
        <Suspense fallback={routeFallback}>
        <Routes location={location}>
          {hostCampSlug || customDomainHost ? (
            <Route path="/t/:slug/*" element={<HostScopedTenantRedirect />} />
          ) : (
            <Route path="/t/:slug/*" element={<TenantScopeLayout />} />
          )}

          {nativeApp ? (
            <Route path="/super/*" element={<Navigate to="/" replace />} />
          ) : rootDomain ? (
            <Route path="/super/*" element={<SuperSubdomainRedirect />} />
          ) : (
            <>
              {superSubdomain ? <Route path="/" element={<Navigate to="/super/login" replace />} /> : null}
              <Route path="/super">
                <Route index element={<Navigate to="login" replace />} />
                <Route path="login/*" element={<SuperLoginPage />} />
                <Route element={<ErrorBoundary level="page"><SuperShellLayout /></ErrorBoundary>}>
                  <Route path="dashboard" element={<SuperOperationsAgentPage />} />
                  <Route path="status" element={<SuperStatusPage />} />
                  <Route path="pulse" element={<Navigate to="/super/status" replace />} />
                  <Route path="tenants/create" element={<SuperTenantCreatePage />} />
                  <Route path="tenants" element={<SuperTenantsPage />} />

                  <Route path="email/transactional" element={<SuperEmailTransactionalPage />} />
                  <Route path="email/broadcast" element={<Navigate to="/super/email/transactional" replace />} />

                  <Route path="billing" element={<Navigate to="/super/billing/tenants" replace />} />
                  <Route path="billing/tenants" element={<SuperBillingTenantsPage />} />
                  <Route path="billing/failed" element={<SuperBillingFailedPage />} />

                  <Route path="settings" element={<SuperSettingsPage />} />
                  <Route path="*" element={<Navigate to="/super/dashboard" replace />} />
                </Route>
              </Route>
            </>
          )}
          {!nativeApp && !hostCampSlug && !customDomainHost && !rootDomain && !superSubdomain ? <Route path="/admin/*" element={<SuperAliasRedirect />} /> : null}

          {legacyRedirectEnabled ? <Route path="/:legacy/*" element={<LegacyRootRedirect />} /> : null}

          {nativeApp && !hostCampSlug && !customDomainHost ? <Route path="/" element={<NativeAppRoot />} /> : null}
          <Route path="/email-preferences" element={<EmailPreferencesPage />} />
          <Route path="/404" element={<NotFoundPage />} />
          {hostCampSlug ? (
            <Route path="/*" element={<SubdomainCampLayout />} />
          ) : customDomainHost ? (
            <Route path="/*" element={<CustomDomainCampLayout />} />
          ) : rootDomain ? (
            <Route path="*" element={<PlatformLandingPage />} />
          ) : (
            <Route path="*" element={<Navigate to={nativeApp ? "/" : "/super/login"} replace />} />
          )}
        </Routes>
        </Suspense>
      </div>
    </div>
    </>
  );
}
