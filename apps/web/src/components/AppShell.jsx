import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import NavBar from "./NavBar.jsx";
import Footer from "./Footer.jsx";
import ProductHeader from "./ProductHeader.jsx";
import { useTenant } from "../context/TenantContext.jsx";

const STANDARD_OFFSET_MATCHERS = ["/admin", "/onboarding", "/settings", "/super"];
const PRODUCT_LAYOUT_MATCHERS = ["/director-claim", "/director-create-account"];

export default function AppShell({ children }) {
  const location = useLocation();
  const { tenant } = useTenant();

  const onboardingIncomplete = tenant?.onboardingStatus !== "live";
  const isTenantRoot = /^\/t\/[^/]+\/?$/.test(location.pathname);

  const needsOffset = useMemo(
    () => STANDARD_OFFSET_MATCHERS.some((part) => location.pathname.includes(part)),
    [location.pathname]
  );
  const useProductLayout = useMemo(
    () =>
      PRODUCT_LAYOUT_MATCHERS.some((part) => location.pathname.includes(part)) ||
      (isTenantRoot && onboardingIncomplete),
    [location.pathname, isTenantRoot, onboardingIncomplete]
  );

  if (useProductLayout) {
    return (
      <div className="app-shell product-app-shell">
        <ProductHeader />
        <main className="product-app-main">{children}</main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <NavBar />
      <main className={`app-shell-main ${needsOffset ? "page-container" : ""}`.trim()}>{children}</main>
      <Footer />
    </div>
  );
}
