import React from "react";
import ReactDOM from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import { clerkUiEnabled, CLERK_PUBLISHABLE_KEY } from "./lib/authMode.js";
import "@pondbridge/ui/theme.css";
import "./styles.css";
import "./styles/productOnboarding.css";

// Build marker used to force fresh hashed assets after CDN cache corruption.
window.__PONDBRIDGE_BUILD__ = "2026-02-27T19:45Z";

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
