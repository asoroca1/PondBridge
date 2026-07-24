import { useEffect, useRef, useState } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Network } from "@capacitor/network";
import { CheckCircle2, WifiOff } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { getAppBaseDomain } from "../lib/domain.js";
import { isNativeApp } from "../lib/nativeApp.js";
import { resolveNativeNavigationTarget, tenantSlugFromAppPath } from "../lib/nativeNavigation.js";

const RESUME_EVENT = "pondbridge-native-resume";
const ONLINE_EVENT = "pondbridge-native-online";

function rememberedTenantSlug() {
  if (typeof window === "undefined") return "";
  try {
    return String(window.localStorage.getItem("pondbridgeTenantSlug") || "").trim().toLowerCase();
  } catch {
    return "";
  }
}

export default function NativeAppExperience() {
  const location = useLocation();
  const navigate = useNavigate();
  const { isAuthenticated, refreshSession } = useAuth();
  const nativeApp = isNativeApp();
  const [connectionState, setConnectionState] = useState(() =>
    typeof navigator === "undefined" || navigator.onLine !== false ? "online" : "offline"
  );
  const previousOnlineRef = useRef(connectionState !== "offline");
  const reconnectTimerRef = useRef(null);
  const currentPathRef = useRef(location.pathname || "/");

  useEffect(() => {
    currentPathRef.current = location.pathname || "/";
  }, [location.pathname]);

  useEffect(() => {
    if (!nativeApp) return undefined;

    document.documentElement.classList.add("is-native-app");

    let disposed = false;
    const handles = [];

    function announceConnection(connected) {
      const online = Boolean(connected);
      window.clearTimeout(reconnectTimerRef.current);

      if (!online) {
        previousOnlineRef.current = false;
        setConnectionState("offline");
        return;
      }

      if (!previousOnlineRef.current) {
        setConnectionState("restored");
        window.dispatchEvent(new CustomEvent(ONLINE_EVENT));
        reconnectTimerRef.current = window.setTimeout(() => setConnectionState("online"), 3200);
      } else {
        setConnectionState("online");
      }
      previousOnlineRef.current = true;
    }

    function handleAppUrl(url = "") {
      const target = resolveNativeNavigationTarget(url, {
        baseDomain: getAppBaseDomain(),
        rememberedSlug: rememberedTenantSlug()
      });
      if (target) navigate(target);
    }

    function refreshActiveSession() {
      window.dispatchEvent(new CustomEvent(RESUME_EVENT));
      if (!isAuthenticated || typeof refreshSession !== "function") return;
      const tenantSlug = tenantSlugFromAppPath(currentPathRef.current) || rememberedTenantSlug();
      refreshSession({ tenantSlug }).catch(() => {});
    }

    function handleBrowserOnline() {
      announceConnection(true);
    }

    function handleBrowserOffline() {
      announceConnection(false);
    }

    function handleTargetBlankClick(event) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      const anchor = event.target?.closest?.("a[target='_blank']");
      if (!anchor || anchor.hasAttribute("download")) return;

      let target;
      try {
        target = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (!["http:", "https:"].includes(target.protocol)) return;

      event.preventDefault();
      if (target.origin === window.location.origin) {
        navigate(`${target.pathname}${target.search}${target.hash}`);
        return;
      }
      Browser.open({ url: target.href, presentationStyle: "popover" }).catch(() => {});
    }

    window.addEventListener("online", handleBrowserOnline);
    window.addEventListener("offline", handleBrowserOffline);
    document.addEventListener("click", handleTargetBlankClick, true);

    async function setup() {
      const status = await Network.getStatus().catch(() => ({ connected: navigator.onLine !== false }));
      if (!disposed) announceConnection(status.connected);

      const networkHandle = await Network.addListener("networkStatusChange", (nextStatus) => {
        if (!disposed) announceConnection(nextStatus.connected);
      });
      handles.push(networkHandle);

      const stateHandle = await CapacitorApp.addListener("appStateChange", ({ isActive }) => {
        if (!disposed && isActive) refreshActiveSession();
      });
      handles.push(stateHandle);

      const urlHandle = await CapacitorApp.addListener("appUrlOpen", ({ url }) => {
        if (!disposed) handleAppUrl(url);
      });
      handles.push(urlHandle);

      const launch = await CapacitorApp.getLaunchUrl().catch(() => null);
      if (!disposed && launch?.url) handleAppUrl(launch.url);
    }

    setup().catch(() => {});

    return () => {
      disposed = true;
      document.documentElement.classList.remove("is-native-app");
      window.removeEventListener("online", handleBrowserOnline);
      window.removeEventListener("offline", handleBrowserOffline);
      document.removeEventListener("click", handleTargetBlankClick, true);
      window.clearTimeout(reconnectTimerRef.current);
      for (const handle of handles) {
        Promise.resolve(handle?.remove?.()).catch(() => {});
      }
    };
  }, [isAuthenticated, nativeApp, navigate, refreshSession]);

  if (!nativeApp || connectionState === "online") return null;

  const offline = connectionState === "offline";
  return (
    <div
      className={`native-connectivity-banner ${offline ? "is-offline" : "is-restored"}`.trim()}
      role="status"
      aria-live="polite"
    >
      {offline ? <WifiOff size={17} aria-hidden="true" /> : <CheckCircle2 size={17} aria-hidden="true" />}
      <span>
        <strong>{offline ? "You’re offline" : "Back online"}</strong>
        {offline ? " You can keep reading this screen; new actions will need a connection." : " PondBridge is refreshing."}
      </span>
    </div>
  );
}
