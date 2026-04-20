import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import NavBar from "./NavBar.jsx";
import NativeMemberTabBar from "./NativeMemberTabBar.jsx";
import ProductHeader from "./ProductHeader.jsx";
import SessionWarningBanner from "./SessionWarningBanner.jsx";
import CedarBackground from "../cedar/components/CedarBackground.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useTenant } from "../context/TenantContext.jsx";
import { isNativeApp } from "../lib/nativeApp.js";

const STANDARD_OFFSET_MATCHERS = ["/admin", "/onboarding", "/settings", "/super"];
const PRODUCT_LAYOUT_MATCHERS = ["/director-claim", "/director-create-account", "/director-legal"];

export default function AppShell({ children }) {
  const location = useLocation();
  const { tenant } = useTenant();
  const { isAuthenticated } = useAuth();
  const nativeApp = isNativeApp();

  const onboardingIncomplete = tenant?.onboardingStatus !== "live";
  const currentPath = location.pathname || "/";
  const isTenantRoot = currentPath === "/" || /^\/t\/[^/]+\/?$/.test(currentPath);
  const useNativeAuthLayout = useMemo(
    () =>
      nativeApp &&
      (/\/login\/?$/.test(currentPath) ||
        /\/create-account\/?$/.test(currentPath) ||
        /\/forgot-password\/?$/.test(currentPath)),
    [currentPath, nativeApp]
  );

  const needsOffset = useMemo(
    () => !useNativeAuthLayout && STANDARD_OFFSET_MATCHERS.some((part) => location.pathname.includes(part)),
    [location.pathname, useNativeAuthLayout]
  );
  const useProductLayout = useMemo(
    () => {
      const onDirectorBootstrapCallback =
        location.pathname.includes("/auth/callback") &&
        new URLSearchParams(location.search || "").get("directorBootstrap") === "1";
      return (
        PRODUCT_LAYOUT_MATCHERS.some((part) => location.pathname.includes(part)) ||
        onDirectorBootstrapCallback ||
        (isTenantRoot && onboardingIncomplete)
      );
    },
    [location.pathname, location.search, isTenantRoot, onboardingIncomplete]
  );
  const useNativeMemberShell = useMemo(
    () =>
      nativeApp &&
      isAuthenticated &&
      !useNativeAuthLayout &&
      !useProductLayout &&
      !currentPath.includes("/admin") &&
      !currentPath.includes("/onboarding") &&
      !currentPath.includes("/director-") &&
      !/\/legal\/?$/.test(currentPath),
    [currentPath, isAuthenticated, nativeApp, useNativeAuthLayout, useProductLayout]
  );

  if (useProductLayout) {
    return (
      <div className="app-shell product-app-shell">
        <SessionWarningBanner />
        <ProductHeader />
        <main className="product-app-main">{children}</main>
      </div>
    );
  }

  return (
    <div
      className={`app-shell alumni-app-shell ${useNativeAuthLayout ? "app-shell-native-auth" : ""} ${useNativeMemberShell ? "is-native-member-shell" : ""}`.trim()}
    >
      <SessionWarningBanner />
      <CedarBackground behavior="fixed" opacity={0.9} zIndex={0} />
      <div className={`app-shell-content ${useNativeAuthLayout ? "app-shell-content-native-auth" : ""}`.trim()}>
        {useNativeAuthLayout ? null : <NavBar />}
        <main
          className={`app-shell-main ${needsOffset ? "page-container" : ""} ${useNativeAuthLayout ? "app-shell-main-native-auth" : ""} ${useNativeMemberShell ? "app-shell-main-native-member" : ""}`.trim()}
        >
          {children}
        </main>
        {useNativeMemberShell ? <NativeMemberTabBar /> : null}
      </div>
    </div>
  );
}
