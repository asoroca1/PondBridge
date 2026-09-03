import { useEffect, useMemo, useRef } from "react";
import { useLocation } from "react-router-dom";
import NavBar from "./NavBar.jsx";
import NativeMemberTabBar from "./NativeMemberTabBar.jsx";
import SideNav from "./SideNav.jsx";
import ProductHeader from "./ProductHeader.jsx";
import SessionWarningBanner from "./SessionWarningBanner.jsx";
import CedarBackground from "../cedar/components/CedarBackground.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useTenant } from "../context/TenantContext.jsx";
import { isNativeApp } from "../lib/nativeApp.js";
import { useSideNavActive, useSideNavCollapsed } from "../hooks/useMemberNav.js";

const STANDARD_OFFSET_MATCHERS = ["/admin", "/onboarding", "/settings", "/super"];
const PRODUCT_LAYOUT_MATCHERS = ["/director-claim", "/director-create-account", "/director-legal"];

export default function AppShell({ children }) {
  const location = useLocation();
  const { tenant } = useTenant();
  const { isAuthenticated } = useAuth();
  const nativeApp = isNativeApp();

  const onboardingIncomplete = tenant?.onboardingStatus !== "live";
  const currentPath = location.pathname || "/";
  const previousPathRef = useRef(currentPath);
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
  const sideNavAvailable = useSideNavActive();
  const [sideNavCollapsed, setSideNavCollapsed] = useSideNavCollapsed();

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

  // The rail is a signed-in member tool: auth screens and the public entry
  // page keep the plain header so a logged-out visitor never sees member links.
  const onAuthRoute =
    /\/login\/?$/.test(currentPath) ||
    /\/create-account\/?$/.test(currentPath) ||
    /\/forgot-password\/?$/.test(currentPath) ||
    /\/auth\/callback\/?$/.test(currentPath);
  const showSideNav = sideNavAvailable && !onAuthRoute && !isTenantRoot;

  useEffect(() => {
    if (previousPathRef.current === currentPath) return undefined;
    previousPathRef.current = currentPath;
    const timeoutId = window.setTimeout(() => {
      document.getElementById("main-content")?.focus({ preventScroll: true });
    }, 60);
    return () => window.clearTimeout(timeoutId);
  }, [currentPath]);

  if (useProductLayout) {
    return (
      <div className="app-shell product-app-shell">
        <a className="skip-link" href="#main-content">Skip to main content</a>
        <SessionWarningBanner />
        <ProductHeader />
        <main id="main-content" className="product-app-main" tabIndex={-1}>{children}</main>
      </div>
    );
  }

  return (
    <div
      className={`app-shell alumni-app-shell ${useNativeAuthLayout ? "app-shell-native-auth" : ""} ${useNativeMemberShell ? "is-native-member-shell" : ""} ${showSideNav ? "has-side-nav" : ""} ${showSideNav && sideNavCollapsed ? "side-nav-collapsed" : ""}`.trim()}
    >
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <SessionWarningBanner />
      <CedarBackground behavior="fixed" opacity={0.9} zIndex={0} />
      <div className={`app-shell-content ${useNativeAuthLayout ? "app-shell-content-native-auth" : ""}`.trim()}>
        {useNativeAuthLayout ? null : <NavBar hideBurger={showSideNav} />}
        {showSideNav ? (
          <SideNav
            collapsed={sideNavCollapsed}
            onToggleCollapsed={() => setSideNavCollapsed((prev) => !prev)}
          />
        ) : null}
        <main
          id="main-content"
          tabIndex={-1}
          className={`app-shell-main ${needsOffset ? "page-container" : ""} ${useNativeAuthLayout ? "app-shell-main-native-auth" : ""} ${useNativeMemberShell ? "app-shell-main-native-member" : ""}`.trim()}
        >
          {children}
        </main>
        {useNativeMemberShell ? <NativeMemberTabBar /> : null}
      </div>
    </div>
  );
}
