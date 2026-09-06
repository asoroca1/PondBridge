import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, useLocation } from "react-router-dom";
import App from "./App.jsx";
import { PublicAuthProvider } from "./context/AuthContext.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import { AppTransitionShell } from "./components/AppTransitionShell.jsx";
import { AssetUpdateNotice } from "./components/AssetUpdateNotice.jsx";
import { clerkSdkEnabled } from "./lib/authMode.js";
import { needsAuthRuntime } from "./lib/authRuntimeScope.js";
import {
  attemptAutomaticChunkRecovery,
  cleanChunkRecoveryUrl,
  installChunkRecoveryListeners
} from "./lib/chunkRecovery.js";
import { canonicalTenantUrlForPreview } from "./lib/domain.js";
import { API_BASE } from "./lib/http.js";
import { readAuthFromStorage } from "./lib/storage.js";
import { loadFullAuthRuntime } from "./lib/authRuntimePreload.js";
import "./fonts.css";
import "@pondbridge/ui/theme.css";
import "./styles.css";
import "./styles/productShell.css";

// Build marker used to scope chunk-recovery attempts to the current deployed bundle.
const inferredBuildMarker = (() => {
  const configured = String(import.meta.env.VITE_BUILD_ID || "").trim();
  if (configured) return configured;
  try {
    const url = new URL(import.meta.url, window.location.href);
    const fileName = String(url.pathname.split("/").pop() || "").trim();
    return fileName || "runtime-build";
  } catch {
    return "runtime-build";
  }
})();
window.__PONDBRIDGE_BUILD__ = inferredBuildMarker;
installChunkRecoveryListeners();
cleanChunkRecoveryUrl();

function warmApiConnection() {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  let apiOrigin = "";
  try {
    apiOrigin = new URL(API_BASE, window.location.href).origin;
  } catch {
    apiOrigin = "";
  }
  if (!apiOrigin || apiOrigin === window.location.origin) return;

  const existing = new Set(
    [...document.querySelectorAll("link[rel='preconnect'],link[rel='dns-prefetch']")]
      .map((link) => String(link.getAttribute("href") || "").trim())
      .filter(Boolean)
  );

  const hasOriginHints = existing.has(apiOrigin);

  if (!hasOriginHints) {
    const preconnect = document.createElement("link");
    preconnect.rel = "preconnect";
    preconnect.href = apiOrigin;
    preconnect.crossOrigin = "";
    document.head.appendChild(preconnect);
  }

  if (!hasOriginHints) {
    const dnsPrefetch = document.createElement("link");
    dnsPrefetch.rel = "dns-prefetch";
    dnsPrefetch.href = apiOrigin;
    document.head.appendChild(dnsPrefetch);
  }
}

warmApiConnection();

// Read once, at startup: this is the session the app boots with.
const bootAuth = readAuthFromStorage();
const hasBootSessionSnapshot = Boolean(bootAuth.token && bootAuth.user);

function runtimeRequiredFor(pathname = "") {
  return needsAuthRuntime({
    pathname,
    clerkEnabled: clerkSdkEnabled(),
    hasSessionSnapshot: hasBootSessionSnapshot
  });
}

const runtimeNeededAtBoot = runtimeRequiredFor(window.location.pathname);

// Start the request now so awaiting it below overlaps with the rest of startup.
const bootRuntimePromise = runtimeNeededAtBoot ? loadFullAuthRuntime() : null;

/**
 * Chooses the auth provider `<App />` renders under.
 *
 * The runtime is resolved *before* the first render whenever the visit needs
 * it, so the app mounts underneath its real provider once and stays there.
 * The old shape — a lazy runtime with `<App />` in both the Suspense fallback
 * and the resolved children — mounted the entire application, tore it down,
 * and mounted it again on every page load: requests discarded, page state
 * reset, and the branded sign-in shell flashing over a screen the member had
 * already been shown. That was the phantom reload.
 *
 * An anonymous visit that starts on a public landing page still skips the
 * runtime entirely, and only pays for a remount if it later navigates
 * somewhere that needs a session.
 */
function AppRoot({ initialRuntime = null }) {
  const location = useLocation();
  const [AuthRuntime, setAuthRuntime] = useState(() => initialRuntime);
  const runtimeRequired = runtimeRequiredFor(location.pathname);

  useEffect(() => {
    if (AuthRuntime || !runtimeRequired) return undefined;

    let active = true;
    loadFullAuthRuntime()
      .then((module) => {
        if (active) setAuthRuntime(() => module.default);
      })
      .catch((error) => {
        // A stale deployment is handled by the update notice rather than
        // killing the visit here.
        attemptAutomaticChunkRecovery(error);
      });

    return () => {
      active = false;
    };
  }, [AuthRuntime, runtimeRequired]);

  if (AuthRuntime) {
    return (
      <AuthRuntime>
        <App />
      </AuthRuntime>
    );
  }

  // The visit started on a public landing page and has now moved somewhere
  // that needs a real session, but the runtime chunk is still in flight.
  // `<App />` must not stay mounted through that gap: Login, the auth
  // callback, and the account-creation pages all call Clerk's own hooks, and
  // those throw when ClerkProvider is not an ancestor yet.
  if (runtimeRequired) return <AppTransitionShell />;

  return (
    <PublicAuthProvider>
      <App />
    </PublicAuthProvider>
  );
}

function renderApp(initialRuntime) {
  ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <ErrorBoundary level="app">
        <AssetUpdateNotice />
        <BrowserRouter>
          <AppRoot initialRuntime={initialRuntime} />
        </BrowserRouter>
      </ErrorBoundary>
    </React.StrictMode>
  );
}

async function start() {
  let initialRuntime = null;
  if (bootRuntimePromise) {
    try {
      initialRuntime = (await bootRuntimePromise).default;
    } catch (error) {
      // A missing chunk means the deployment moved under us; recovery reloads
      // onto the current build rather than rendering a broken tree.
      if (attemptAutomaticChunkRecovery(error)) return;
      throw error;
    }
  }
  renderApp(initialRuntime);
}

const canonicalPreviewUrl = canonicalTenantUrlForPreview();
if (canonicalPreviewUrl && canonicalPreviewUrl !== window.location.href) {
  window.location.replace(canonicalPreviewUrl);
} else {
  start();
}
