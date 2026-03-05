import { useMemo } from "react";
import { useTenant } from "../context/TenantContext.jsx";
import { resolveNetworkDisplayName } from "../lib/campLabels.js";

function initialsFromLabel(label = "") {
  const parts = String(label || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "CN";
  return parts
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();
}

export default function ProductHeader() {
  const { tenant } = useTenant();
  const branding = tenant?.config?.branding || tenant?.theme || {};
  const isLaunched = String(tenant?.onboardingStatus || "").trim().toLowerCase() === "live";
  const networkName = useMemo(() => {
    if (!isLaunched) return "PondBridge";
    const resolved = String(resolveNetworkDisplayName(tenant) || "").trim();
    if (resolved) return resolved;
    const campName = String(tenant?.name || "").trim();
    return campName ? `${campName} Network` : "Camp Network";
  }, [isLaunched, tenant]);
  const logoUrl = isLaunched ? String(branding.logoUrl || "").trim() : "";
  const logoInitials = useMemo(() => initialsFromLabel(networkName), [networkName]);

  return (
    <header className="product-header" role="banner">
      <div className="product-header-inner">
        <div className="product-header-brand">
          {logoUrl ? (
            <img className="product-header-brand-logo" src={logoUrl} alt={`${networkName} logo`} />
          ) : (
            <span className="product-header-brand-logo-fallback" aria-hidden="true">
              {logoInitials}
            </span>
          )}
          <div className="product-header-brand-copy">
            <strong>{networkName}</strong>
            <span>Camp Access</span>
          </div>
        </div>
      </div>
    </header>
  );
}
