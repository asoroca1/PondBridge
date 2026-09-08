import { Navigate, useLocation, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { useTenant } from "../context/TenantContext.jsx";
import { isNativeApp } from "../lib/nativeApp.js";
import { readAuthFromStorage } from "../lib/storage.js";

export default function ProtectedRoute({ children, role }) {
  const { slug } = useParams();
  const location = useLocation();
  const { slug: tenantSlug } = useTenant();
  const { isAuthenticated, isReady, user } = useAuth();
  const nativeApp = isNativeApp();
  const cachedNativeAuth = nativeApp ? readAuthFromStorage() : { token: "", user: null };
  const effectiveUser = user || cachedNativeAuth.user || null;
  const hasNativeCachedSession = nativeApp && Boolean((isAuthenticated || cachedNativeAuth.token) && effectiveUser);
  const effectiveSlug = slug || tenantSlug;
  const returnTo = `${location.pathname || ""}${location.search || ""}${location.hash || ""}` || "/";
  const loginParams = new URLSearchParams();
  if (returnTo.startsWith("/")) {
    loginParams.set("returnTo", returnTo);
  }
  const loginBasePath = effectiveSlug ? `/t/${effectiveSlug}/login` : "/login";
  const loginPath = loginParams.toString() ? `${loginBasePath}?${loginParams.toString()}` : loginBasePath;
  const fallbackPath = effectiveSlug ? `/t/${effectiveSlug}/home` : "/home";
  const claimPath = effectiveSlug ? `/t/${effectiveSlug}/claim-profile` : "/claim-profile";

  // Wait until auth is fully resolved before making any routing decisions.
  // This prevents the race where isReady flickers to true before the user
  // object has been populated from the session refresh.
  if (!isReady && !hasNativeCachedSession) {
    return null;
  }

  if (!isAuthenticated && !hasNativeCachedSession) {
    return <Navigate to={loginPath} replace />;
  }

  if (nativeApp && effectiveUser?.roles?.includes("super_admin")) {
    return <Navigate to="/" replace />;
  }

  // A profile an import created stays invisible until the person it describes
  // confirms it is theirs. The Clerk callback learns that from the access
  // decision, but the legacy login hands back a session directly — so the guard
  // enforces it here, which covers password sign-in, magic links and a restored
  // session alike rather than each of them separately.
  if (effectiveUser?.profile?.status === "pending") {
    return <Navigate to={claimPath} replace />;
  }

  if (role && !effectiveUser) {
    return null;
  }

  if (role && !effectiveUser?.roles?.includes(role) && !effectiveUser?.roles?.includes("super_admin")) {
    return <Navigate to={fallbackPath} replace />;
  }

  return children;
}
