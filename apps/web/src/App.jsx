import { useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { TenantProvider, useTenant } from "./context/TenantContext.jsx";
import { useAuth } from "./context/AuthContext.jsx";
import AppShell from "./components/AppShell.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import DirectorOnboardingCommandCenterPage from "./pages/DirectorOnboardingCommandCenterPage.jsx";
import DirectorClaimPage from "./pages/DirectorClaimPage.jsx";
import DirectorCreateAccountPage from "./pages/DirectorCreateAccountPage.jsx";
import TenantAccessPendingPage from "./pages/TenantAccessPendingPage.jsx";
import TenantAuthCallbackPage from "./pages/TenantAuthCallbackPage.jsx";
import DirectorAdminLayout from "./pages/admin/DirectorAdminLayout.jsx";
import {
  DirectorAdminAnalyticsPage,
  DirectorAdminApprovalsPage,
  DirectorAdminBillingPage,
  DirectorAdminDashboardPage,
  DirectorAdminEmailComposePage,
  DirectorAdminEmailHistoryPage,
  DirectorAdminFeaturesPage,
  DirectorAdminImportPage,
  DirectorAdminMembersPage,
  DirectorAdminSettingsAccessPage,
  DirectorAdminSettingsAdminsPage,
  DirectorAdminSettingsBrandingPage,
  DirectorAdminSettingsDangerPage,
  DirectorAdminSettingsLayout,
  DirectorAdminSettingsNetworkPage,
  DirectorAdminSettingsNotificationsPage
} from "./pages/admin/DirectorAdminPages.jsx";
import SuperLoginPage from "./pages/SuperLoginPage.jsx";
import SuperShellLayout from "./pages/super/SuperShellLayout.jsx";
import {
  SuperBillingFailedPage,
  SuperBillingTenantsPage,
  SuperEmailTransactionalPage,
  SuperPlatformPulsePage,
  SuperSettingsPage,
  SuperTenantCreatePage,
  SuperTenantsPage
} from "./pages/super/SuperPages.jsx";
import NotFoundPage from "./pages/NotFoundPage.jsx";
import CedarHomePage from "./cedar/pages/Home.jsx";
import CedarLoginPage from "./cedar/pages/Login.jsx";
import CedarForgotPasswordPage from "./cedar/pages/ForgotPassword.jsx";
import CedarCreateProfileWizardPage from "./cedar/pages/CreateProfileWizard.jsx";
import CedarMainHomePage from "./cedar/pages/MainHome.jsx";
import CedarMyProfilePage from "./cedar/pages/MyProfile.jsx";
import CedarEditProfilePage from "./cedar/pages/EditProfile.jsx";
import CedarAdvancedSearchPage from "./cedar/pages/AdvancedSearch.jsx";
import CedarPhotoStreamPage from "./cedar/pages/PhotoStream.jsx";
import CedarChatAndForumsPage from "./cedar/pages/ChatAndForums.jsx";
import CedarChestPage from "./cedar/pages/CedarChest.jsx";
import CedarLocationMapPage from "./cedar/pages/LocationMap.jsx";
import CedarSearchResultsPage from "./cedar/pages/SearchResults.jsx";
import CedarPublicProfilePage from "./cedar/pages/PublicProfile.jsx";
import CedarLegalPage from "./cedar/pages/Legal.jsx";
import CedarFamilyTreesPage from "./cedar/pages/FamilyTrees.jsx";
import CedarFamilyTreeCreatePage from "./cedar/pages/FamilyTreeCreate.jsx";
import CedarFamilyTreeViewPage from "./cedar/pages/FamilyTreeView.jsx";
import { inferCampSlugFromHost, isPotentialCustomTenantHost } from "./lib/domain.js";

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

function TenantScopeRoutes() {
  const { loading, error, tenant, slug: tenantSlug } = useTenant();
  const { isAuthenticated, isReady, user, authProvider, refreshSession } = useAuth();
  const location = useLocation();
  const params = useParams();
  const slug = params.slug || tenantSlug;
  const membershipSyncKeyRef = useRef("");

  useEffect(() => {
    const clerkMode = ["clerk", "hybrid"].includes(String(authProvider || "").toLowerCase());
    const path = String(location.pathname || "");
    const onSyncBlockedRoute =
      path.includes("/auth/callback") ||
      path.includes("/director-claim") ||
      path.includes("/director-create-account");
    if (!clerkMode || !isAuthenticated || !slug || loading || Boolean(error) || !tenant || onSyncBlockedRoute) {
      membershipSyncKeyRef.current = "";
      return;
    }

    const syncKey = `${String(authProvider || "").toLowerCase()}:${slug}:signed-in`;
    if (membershipSyncKeyRef.current === syncKey) return;
    membershipSyncKeyRef.current = syncKey;

    refreshSession({ tenantSlug: slug }).catch(() => {});
  }, [authProvider, error, isAuthenticated, loading, location.pathname, refreshSession, slug, tenant]);

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

  const isCampDirector =
    isAuthenticated && (user?.roles?.includes("tenant_admin") || user?.roles?.includes("super_admin"));
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
          <Route path="members/import" element={<DirectorAdminImportPage />} />
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
          element={<Navigate to={slug ? `/t/${slug}/admin/members/import` : "/admin/members/import"} replace />}
        />

        <Route path="main-home" element={<Navigate to={slug ? `/t/${slug}/home` : "/home"} replace />} />
        <Route path="advanced-search" element={<Navigate to={slug ? `/t/${slug}/search` : "/search"} replace />} />
        <Route path="directory" element={<Navigate to={slug ? `/t/${slug}/search` : "/search"} replace />} />
        <Route path="search-old" element={<Navigate to={slug ? `/t/${slug}/search` : "/search"} replace />} />
        <Route path="admin/onboarding" element={<Navigate to={slug ? `/t/${slug}/onboarding` : "/onboarding"} replace />} />
        <Route path="admin/import" element={<Navigate to={slug ? `/t/${slug}/admin/members/import` : "/admin/members/import"} replace />} />
        <Route path="admin/invites" element={<Navigate to={slug ? `/t/${slug}/admin/settings/admins` : "/admin/settings/admins"} replace />} />
        <Route path="admin/analytics" element={<Navigate to={slug ? `/t/${slug}/admin/analytics` : "/admin/analytics"} replace />} />
        <Route path="admin/billing" element={<Navigate to={slug ? `/t/${slug}/admin/billing` : "/admin/billing"} replace />} />

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
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
  const routeTimerRef = useRef(null);
  const [isRouting, setIsRouting] = useState(true);
  const hostCampSlug = inferCampSlugFromHost();
  const rememberedSlug = localStorage.getItem("pondbridgeTenantSlug") || "";
  const customDomainHost = isPotentialCustomTenantHost();
  const legacyRedirectEnabled = Boolean(!hostCampSlug && !customDomainHost && rememberedSlug);

  useEffect(() => {
    setIsRouting(true);
    window.clearTimeout(routeTimerRef.current);
    routeTimerRef.current = window.setTimeout(() => {
      setIsRouting(false);
    }, 220);

    return () => {
      window.clearTimeout(routeTimerRef.current);
    };
  }, [location.pathname, location.search, location.hash]);

  return (
    <div className={`app-route-shell ${isRouting ? "is-routing" : ""}`}>
      <div className={`app-route-progress ${isRouting ? "is-active" : ""}`} aria-hidden="true" />
      <div className="app-route-stage">
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
      </div>
    </div>
  );
}
