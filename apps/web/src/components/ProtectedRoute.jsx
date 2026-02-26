import { Navigate, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { useTenant } from "../context/TenantContext.jsx";

export default function ProtectedRoute({ children, role }) {
  const { slug } = useParams();
  const { slug: tenantSlug } = useTenant();
  const { isAuthenticated, isReady, user } = useAuth();
  const hasResolvedUser = Boolean(String(user?.id || user?._id || "").trim());
  const effectiveSlug = slug || tenantSlug;
  const loginPath = effectiveSlug ? `/t/${effectiveSlug}/login` : "/login";
  const fallbackPath = effectiveSlug ? `/t/${effectiveSlug}/home` : "/home";

  if (!isReady && !hasResolvedUser) {
    return null;
  }

  if (!isAuthenticated) {
    return <Navigate to={loginPath} replace />;
  }

  if (role && !user) {
    return null;
  }

  if (role && !user?.roles?.includes(role) && !user?.roles?.includes("super_admin")) {
    return <Navigate to={fallbackPath} replace />;
  }

  return children;
}
