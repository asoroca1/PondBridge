import { Navigate } from "react-router-dom";
import { useTenant } from "../../context/TenantContext.jsx";
import { tenantRoute } from "../../lib/tenantRouting.js";

export default function DirectorAdminCopilotPage() {
  const { slug } = useTenant();
  return <Navigate to={tenantRoute(slug, "/onboarding")} replace />;
}
