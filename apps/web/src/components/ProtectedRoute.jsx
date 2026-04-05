import { Navigate, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { useTenant } from "../context/TenantContext.jsx";
import { isNativeApp } from "../lib/nativeApp.js";

export default function ProtectedRoute({ children, role }) {
  const { slug } = useParams();
  const { slug: tenantSlug } = useTenant();
  const { isAuthenticated, isReady, user } = useAuth();
  const effectiveSlug = slug || tenantSlug;
  const loginPath = effectiveSlug ? `/t/${effectiveSlug}/login` : "/login";
  const fallbackPath = effectiveSlug ? `/t/${effectiveSlug}/home` : "/home";

  // Wait until auth is fully resolved before making any routing decisions.
  // This prevents the race where isReady flickers to true before the user
  // object has been populated from the session refresh.
  if (!isReady) {
    return null;
  }

  if (!isAuthenticated) {
    return <Navigate to={loginPath} replace />;
  }

  if (isNativeApp() && user?.roles?.includes("super_admin")) {
    return <Navigate to="/" replace />;
  }

  if (role && !user) {
    return null;
  }

  if (role && !user?.roles?.includes(role) && !user?.roles?.includes("super_admin")) {
    return <Navigate to={fallbackPath} replace />;
  }

  return children;
}
