import { Navigate, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { useTenant } from "../context/TenantContext.jsx";
import { isNativeApp } from "../lib/nativeApp.js";
import { readAuthFromStorage } from "../lib/storage.js";

export default function ProtectedRoute({ children, role }) {
  const { slug } = useParams();
  const { slug: tenantSlug } = useTenant();
  const { isAuthenticated, isReady, user } = useAuth();
  const nativeApp = isNativeApp();
  const cachedNativeAuth = nativeApp ? readAuthFromStorage() : { token: "", user: null };
  const effectiveUser = user || cachedNativeAuth.user || null;
  const hasNativeCachedSession = nativeApp && Boolean((isAuthenticated || cachedNativeAuth.token) && effectiveUser);
  const effectiveSlug = slug || tenantSlug;
  const loginPath = effectiveSlug ? `/t/${effectiveSlug}/login` : "/login";
  const fallbackPath = effectiveSlug ? `/t/${effectiveSlug}/home` : "/home";

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

  if (role && !effectiveUser) {
    return null;
  }

  if (role && !effectiveUser?.roles?.includes(role) && !effectiveUser?.roles?.includes("super_admin")) {
    return <Navigate to={fallbackPath} replace />;
  }

  return children;
}
