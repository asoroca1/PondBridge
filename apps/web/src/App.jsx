import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { TenantProvider, useTenant } from "./context/TenantContext.jsx";
import { useAuth } from "./context/AuthContext.jsx";
import AppShell from "./components/AppShell.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import TenantAccessPendingPage from "./pages/TenantAccessPendingPage.jsx";
import TenantAuthCallbackPage from "./pages/TenantAuthCallbackPage.jsx";
import SuperLoginPage from "./pages/SuperLoginPage.jsx";
import NotFoundPage from "./pages/NotFoundPage.jsx";
import { defaultTenantDomain, inferCampSlugFromHost, isPotentialCustomTenantHost } from "./lib/domain.js";

const CedarHomePage = lazy(() => import("./cedar/pages/Home.jsx"));
const CedarLoginPage = lazy(() => import("./cedar/pages/Login.jsx"));
const CedarForgotPasswordPage = lazy(() => import("./cedar/pages/ForgotPassword.jsx"));
const CedarCreateProfileWizardPage = lazy(() => import("./cedar/pages/CreateProfileWizard.jsx"));
const CedarMainHomePage = lazy(() => import("./cedar/pages/MainHome.jsx"));
const CedarMyProfilePage = lazy(() => import("./cedar/pages/MyProfile.jsx"));
const CedarEditProfilePage = lazy(() => import("./cedar/pages/EditProfile.jsx"));
const CedarAdvancedSearchPage = lazy(() => import("./cedar/pages/AdvancedSearch.jsx"));
const CedarPhotoStreamPage = lazy(() => import("./cedar/pages/PhotoStream.jsx"));
const CedarChatAndForumsPage = lazy(() => import("./cedar/pages/ChatAndForums.jsx"));
const CedarChestPage = lazy(() => import("./cedar/pages/CedarChest.jsx"));
const CedarLocationMapPage = lazy(() => import("./cedar/pages/LocationMap.jsx"));
const CedarSearchResultsPage = lazy(() => import("./cedar/pages/SearchResults.jsx"));
const CedarPublicProfilePage = lazy(() => import("./cedar/pages/PublicProfile.jsx"));
const CedarLegalPage = lazy(() => import("./cedar/pages/Legal.jsx"));
const CedarFamilyTreesPage = lazy(() => import("./cedar/pages/FamilyTrees.jsx"));
const CedarFamilyTreeCreatePage = lazy(() => import("./cedar/pages/FamilyTreeCreate.jsx"));
const CedarFamilyTreeViewPage = lazy(() => import("./cedar/pages/FamilyTreeView.jsx"));

const DirectorOnboardingCommandCenterPage = lazy(() => import("./pages/DirectorOnboardingCommandCenterPage.jsx"));
const DirectorClaimPage = lazy(() => import("./pages/DirectorClaimPage.jsx"));
const DirectorCreateAccountPage = lazy(() => import("./pages/DirectorCreateAccountPage.jsx"));
const DirectorAdminLayout = lazy(() => import("./pages/admin/DirectorAdminLayout.jsx"));
const DirectorAdminAnalyticsPage = lazy(() =>
  import("./pages/admin/DirectorAdminPages.jsx").then((module) => ({ default: module.DirectorAdminAnalyticsPage }))
);
const DirectorAdminApprovalsPage = lazy(() =>
  import("./pages/admin/DirectorAdminPages.jsx").then((module) => ({ default: module.DirectorAdminApprovalsPage }))
);
const DirectorAdminBillingPage = lazy(() =>
  import("./pages/admin/DirectorAdminPages.jsx").then((module) => ({ default: module.DirectorAdminBillingPage }))
);
const DirectorAdminDashboardPage = lazy(() =>
  import("./pages/admin/DirectorAdminPages.jsx").then((module) => ({ default: module.DirectorAdminDashboardPage }))
);
const DirectorAdminEmailComposePage = lazy(() =>
  import("./pages/admin/DirectorAdminPages.jsx").then((module) => ({ default: module.DirectorAdminEmailComposePage }))
);
const DirectorAdminEmailHistoryPage = lazy(() =>
  import("./pages/admin/DirectorAdminPages.jsx").then((module) => ({ default: module.DirectorAdminEmailHistoryPage }))
);
const DirectorAdminFeaturesPage = lazy(() =>
  import("./pages/admin/DirectorAdminPages.jsx").then((module) => ({ default: module.DirectorAdminFeaturesPage }))
);
const DirectorAdminInvitesPage = lazy(() =>
  import("./pages/admin/DirectorAdminPages.jsx").then((module) => ({ default: module.DirectorAdminInvitesPage }))
);
const DirectorAdminMembersPage = lazy(() =>
  import("./pages/admin/DirectorAdminPages.jsx").then((module) => ({ default: module.DirectorAdminMembersPage }))
);
const DirectorAdminSettingsAccessPage = lazy(() =>
  import("./pages/admin/DirectorAdminPages.jsx").then((module) => ({
    default: module.DirectorAdminSettingsAccessPage
  }))
);
const DirectorAdminSettingsAdminsPage = lazy(() =>
  import("./pages/admin/DirectorAdminPages.jsx").then((module) => ({
    default: module.DirectorAdminSettingsAdminsPage
  }))
);
const DirectorAdminSettingsBrandingPage = lazy(() =>
  import("./pages/admin/DirectorAdminPages.jsx").then((module) => ({
    default: module.DirectorAdminSettingsBrandingPage
  }))
);
const DirectorAdminSettingsDangerPage = lazy(() =>
  import("./pages/admin/DirectorAdminPages.jsx").then((module) => ({
    default: module.DirectorAdminSettingsDangerPage
  }))
);
const DirectorAdminSettingsLayout = lazy(() =>
  import("./pages/admin/DirectorAdminPages.jsx").then((module) => ({ default: module.DirectorAdminSettingsLayout }))
);
const DirectorAdminSettingsNetworkPage = lazy(() =>
  import("./pages/admin/DirectorAdminPages.jsx").then((module) => ({
    default: module.DirectorAdminSettingsNetworkPage
  }))
);
const DirectorAdminSettingsNotificationsPage = lazy(() =>
  import("./pages/admin/DirectorAdminPages.jsx").then((module) => ({
    default: module.DirectorAdminSettingsNotificationsPage
  }))
);
const SuperShellLayout = lazy(() => import("./pages/super/SuperShellLayout.jsx"));
const SuperBillingFailedPage = lazy(() =>
  import("./pages/super/SuperPages.jsx").then((module) => ({ default: module.SuperBillingFailedPage }))
);
const SuperBillingTenantsPage = lazy(() =>
  import("./pages/super/SuperPages.jsx").then((module) => ({ default: module.SuperBillingTenantsPage }))
);
const SuperEmailTransactionalPage = lazy(() =>
  import("./pages/super/SuperPages.jsx").then((module) => ({ default: module.SuperEmailTransactionalPage }))
);
const SuperPlatformPulsePage = lazy(() =>
  import("./pages/super/SuperPages.jsx").then((module) => ({ default: module.SuperPlatformPulsePage }))
);
const SuperSettingsPage = lazy(() =>
  import("./pages/super/SuperPages.jsx").then((module) => ({ default: module.SuperSettingsPage }))
);
const SuperTenantCreatePage = lazy(() =>
  import("./pages/super/SuperPages.jsx").then((module) => ({ default: module.SuperTenantCreatePage }))
);
const SuperTenantsPage = lazy(() =>
  import("./pages/super/SuperPages.jsx").then((module) => ({ default: module.SuperTenantsPage }))
);

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

function RouteLoadingFallback() {
  return (
    <section className="app-status-shell">
      <div className="app-status-card">
        <h1>Loading page...</h1>
        <p>Please wait while we load this view.</p>
      </div>
    </section>
  );
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

  useEffect(() => {
    const clerkMode = ["clerk", "hybrid"].includes(String(authProvider || "").toLowerCase());
    const path = String(location.pathname || "");
    const onSyncBlockedRoute =
      path.includes("/auth/callback") ||
      path.includes("/director-claim") ||
      path.includes("/director-create-account");
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
    const isSuperAdmin = Boolean(user?.roles?.includes("super_admin"));
    const onDirectorBootstrapRoute =
      path.includes("/director-claim") || path.includes("/director-create-account");
    const alreadyScopedToTenant = Boolean(
      user &&
        ((tenantId && userTenantId && userTenantId === tenantId) ||
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
    return (
      <section className="app-status-shell">
        <div className="app-status-card">
          <h1>Loading your camp...</h1>
          <p>Please wait while we load network settings.</p>
        </div>
      </section>
    );
  }

  if (!isReady) {
    return (
      <section className="app-status-shell">
        <div className="app-status-card">
          <h1>Checking your account...</h1>
          <p>Please wait while we verify your access.</p>
        </div>
      </section>
    );
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
            Your session belongs to a different alumni network and has been signed out for security.
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

  const isCampDirector = isAuthenticated && user?.roles?.includes("tenant_admin");
  const clerkMode = ["clerk", "hybrid"].includes(String(authProvider || "").toLowerCase());
  const onboardingIncomplete = tenant?.onboardingStatus !== "live";
  const currentPath = location.pathname || "";
  const directorSetupPath = slug ? `/t/${slug}/director-create-account?setup=1` : "/director-create-account?setup=1";
  const onOnboardingRoute =
    currentPath.includes("/onboarding") ||
    currentPath.includes("/director-claim") ||
    currentPath.includes("/director-create-account");
  const inviteToken = new URLSearchParams(location.search || "").get("inviteToken");
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

  if (clerkMode && isAuthenticated && !user && !onAuthBootstrapRoute) {
    const callbackPath = slug ? `/t/${slug}/auth/callback` : "/auth/callback";
    return <Navigate to={callbackPath} replace />;
  }

  if (isCampDirector && onboardingIncomplete && !onOnboardingRoute) {
    return <Navigate to={directorSetupPath} replace />;
  }

  if (!isCampDirector && onboardingIncomplete && onMemberCreateAccountRoute && !inviteToken) {
    return <Navigate to={slug ? `/t/${slug}/login` : "/login"} replace />;
  }

  return (
    <AppShell>
      <ErrorBoundary level="page">
      <Suspense fallback={<RouteLoadingFallback />}>
      <Routes>
        <Route index element={onboardingIncomplete ? <DirectorClaimPage /> : <CedarHomePage />} />
        <Route path="login/*" element={<CedarLoginPage />} />
        <Route path="forgot-password" element={<CedarForgotPasswordPage />} />
        <Route path="create-account/*" element={<CedarCreateProfileWizardPage />} />
        <Route path="auth/callback" element={<TenantAuthCallbackPage />} />
        <Route path="request-access" element={<TenantAccessPendingPage />} />
        <Route path="director-claim" element={<DirectorClaimPage />} />
        <Route path="director-create-account/*" element={<DirectorCreateAccountPage />} />
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
              <CedarAdvancedSearchPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="profile/:id"
          element={
            <ProtectedRoute>
              <CedarPublicProfilePage />
            </ProtectedRoute>
          }
        />

        <Route
          path="photo-stream"
          element={
            <ProtectedRoute>
              <CedarPhotoStreamPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="chat-rooms"
          element={
            <ProtectedRoute>
              <CedarChatAndForumsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="chat/:id"
          element={
            <ProtectedRoute>
              <CedarChatAndForumsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="cedar-chest"
          element={
            <ProtectedRoute>
              <CedarChestPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="location-map"
          element={
            <ProtectedRoute>
              <CedarLocationMapPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="search-results"
          element={
            <ProtectedRoute>
              <CedarSearchResultsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="family-trees"
          element={
            <ProtectedRoute>
              <CedarFamilyTreesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="family-trees/new"
          element={
            <ProtectedRoute>
              <CedarFamilyTreeCreatePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="family-trees/:id"
          element={
            <ProtectedRoute>
              <CedarFamilyTreeViewPage />
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
          <Route path="members" element={<DirectorAdminMembersPage />} />
          <Route path="members/approvals" element={<DirectorAdminApprovalsPage />} />
          <Route path="members/import" element={<Navigate to="../invites" replace />} />
          <Route path="invites" element={<DirectorAdminInvitesPage />} />
          <Route path="directory" element={<Navigate to="../members" replace />} />
          <Route path="family-trees" element={<Navigate to="../features" replace />} />
          <Route path="events" element={<Navigate to="../analytics" replace />} />
          <Route path="communications" element={<Navigate to="../email/compose" replace />} />
          <Route path="email/compose" element={<DirectorAdminEmailComposePage />} />
          <Route path="email/history" element={<DirectorAdminEmailHistoryPage />} />
          <Route path="analytics" element={<DirectorAdminAnalyticsPage />} />
          <Route path="features" element={<DirectorAdminFeaturesPage />} />
          <Route path="billing" element={<DirectorAdminBillingPage />} />
          <Route path="settings" element={<DirectorAdminSettingsLayout />}>
            <Route index element={<Navigate to="network" replace />} />
            <Route path="network" element={<DirectorAdminSettingsNetworkPage />} />
            <Route path="branding" element={<DirectorAdminSettingsBrandingPage />} />
            <Route path="access" element={<DirectorAdminSettingsAccessPage />} />
            <Route path="admins" element={<DirectorAdminSettingsAdminsPage />} />
            <Route path="notifications" element={<DirectorAdminSettingsNotificationsPage />} />
            <Route path="danger" element={<DirectorAdminSettingsDangerPage />} />
          </Route>
          <Route path="*" element={<Navigate to="dashboard" replace />} />
        </Route>

        <Route
          path="onboarding"
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
          element={<Navigate to={slug ? `/t/${slug}/admin/settings/access` : "/admin/settings/access"} replace />}
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
          path="settings/imports"
          element={<Navigate to={slug ? `/t/${slug}/admin/invites` : "/admin/invites"} replace />}
        />

        <Route path="main-home" element={<Navigate to={slug ? `/t/${slug}/home` : "/home"} replace />} />
        <Route path="advanced-search" element={<Navigate to={slug ? `/t/${slug}/search` : "/search"} replace />} />
        <Route path="directory" element={<Navigate to={slug ? `/t/${slug}/search` : "/search"} replace />} />
        <Route path="search-old" element={<Navigate to={slug ? `/t/${slug}/search` : "/search"} replace />} />
        <Route path="admin/onboarding" element={<Navigate to={slug ? `/t/${slug}/onboarding` : "/onboarding"} replace />} />
        <Route path="admin/import" element={<Navigate to={slug ? `/t/${slug}/admin/invites` : "/admin/invites"} replace />} />
        <Route path="admin/analytics" element={<Navigate to={slug ? `/t/${slug}/admin/analytics` : "/admin/analytics"} replace />} />
        <Route path="admin/billing" element={<Navigate to={slug ? `/t/${slug}/admin/billing` : "/admin/billing"} replace />} />

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      </Suspense>
      </ErrorBoundary>
    </AppShell>
  );
}

function redirectSlug() {
  return inferCampSlugFromHost() || localStorage.getItem("pondbridgeTenantSlug") || "";
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

export default function App() {
  const location = useLocation();
  const hostCampSlug = inferCampSlugFromHost();
  const rememberedSlug = localStorage.getItem("pondbridgeTenantSlug") || "";
  const customDomainHost = isPotentialCustomTenantHost();
  const legacyRedirectEnabled = Boolean(!hostCampSlug && !customDomainHost && rememberedSlug);

  // Use a key-based CSS animation for route transitions instead of React state.
  // This avoids re-rendering the entire component tree on every navigation,
  // which was causing cascading glitches and visual flicker.
  const routeKey = `${location.pathname}${location.search}${location.hash}`;

  return (
    <div className="app-route-shell">
      <div className="app-route-progress" key={routeKey} aria-hidden="true" />
      <div className="app-route-stage">
        <Suspense fallback={<RouteLoadingFallback />}>
        <Routes location={location}>
          {hostCampSlug || customDomainHost ? (
            <Route path="/t/:slug/*" element={<HostScopedTenantRedirect />} />
          ) : (
            <Route path="/t/:slug/*" element={<TenantScopeLayout />} />
          )}

          <Route path="/super">
            <Route index element={<Navigate to="login" replace />} />
            <Route path="login/*" element={<SuperLoginPage />} />
            <Route element={<ErrorBoundary level="page"><SuperShellLayout /></ErrorBoundary>}>
              <Route path="dashboard" element={<SuperPlatformPulsePage />} />
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
          {!hostCampSlug && !customDomainHost ? <Route path="/admin/*" element={<SuperAliasRedirect />} /> : null}

          {legacyRedirectEnabled ? <Route path="/:legacy/*" element={<LegacyRootRedirect />} /> : null}

          <Route path="/404" element={<NotFoundPage />} />
          {hostCampSlug ? (
            <Route path="/*" element={<SubdomainCampLayout />} />
          ) : customDomainHost ? (
            <Route path="/*" element={<CustomDomainCampLayout />} />
          ) : (
            <Route path="*" element={<Navigate to="/super/login" replace />} />
          )}
        </Routes>
        </Suspense>
      </div>
    </div>
  );
}
