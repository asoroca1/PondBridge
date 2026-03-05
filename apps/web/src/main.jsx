import React from "react";
import ReactDOM from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import { clerkUiEnabled, CLERK_PUBLISHABLE_KEY } from "./lib/authMode.js";
import { installChunkRecoveryListeners } from "./lib/chunkRecovery.js";
import { API_BASE } from "./lib/http.js";
import "@pondbridge/ui/theme.css";
import "./styles.css";
import "./styles/productOnboarding.css";

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

const clerkNoSocialAppearance = {
  elements: {
    socialButtons: {
      display: "none"
    },
    socialButtonsBlock: {
      display: "none"
    },
    socialButtonsBlockButton: {
      display: "none"
    },
    socialButtonsIconButton: {
      display: "none"
    },
    dividerRow: {
      display: "none"
    },
    dividerLine: {
      display: "none"
    },
    dividerText: {
      display: "none"
    }
  }
};

const baseTree = (
  <BrowserRouter>
    <AuthProvider>
      <App />
    </AuthProvider>
  </BrowserRouter>
);

const appTree = clerkUiEnabled() ? (
  <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} appearance={clerkNoSocialAppearance}>
    {baseTree}
  </ClerkProvider>
) : (
  baseTree
);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary level="app">
      {appTree}
    </ErrorBoundary>
  </React.StrictMode>
);
