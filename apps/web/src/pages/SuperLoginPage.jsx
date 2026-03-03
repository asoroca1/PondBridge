import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { SignIn, useAuth as useClerkAuth } from "@clerk/clerk-react";
import { Button } from "@pondbridge/ui";
import { noteTabLoginIntent, useAuth } from "../context/AuthContext.jsx";
import { clerkConfigError, clerkUiEnabled } from "../lib/authMode.js";

function roleSetFromUser(user) {
  return new Set(user?.roles || []);
}

function hasSuperConsoleRole(user) {
  const roles = roleSetFromUser(user);
  return roles.has("super_admin") || roles.has("support_admin") || roles.has("finance_admin");
}

function superDestinationFromUser(user) {
  const roles = roleSetFromUser(user);
  return roles.has("finance_admin") && !roles.has("super_admin")
    ? "/super/billing/tenants"
    : "/super/tenants";
}

function ClerkSuperLoginPage() {
  const { token, user, isReady, logout, bootstrapError, retryBootstrap } = useAuth();
  const { isSignedIn, isLoaded: clerkIsLoaded } = useClerkAuth();
  const [signingOutUnauthorized, setSigningOutUnauthorized] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const autoSignOutRef = useRef("");
  useEffect(() => {
    try {
      localStorage.removeItem("pondbridgeTenantSlug");
    } catch {
      // no-op
    }
    noteTabLoginIntent();
  }, []);
  const handleAuthInteraction = useCallback(() => {
    noteTabLoginIntent();
  }, []);
  const handleSwitchAccount = useCallback(async () => {
    setSigningOutUnauthorized(true);
    await logout();
    setSigningOutUnauthorized(false);
    noteTabLoginIntent();
  }, [logout]);

  const handleRetryBootstrap = useCallback(() => {
    setRetrying(true);
    retryBootstrap();
  }, [retryBootstrap]);

  // Clear the retrying state when isReady transitions back to true
  // (bootstrap attempt finished).
  useEffect(() => {
    if (isReady) setRetrying(false);
  }, [isReady]);

  useEffect(() => {
    if (!token || !isReady || !user || hasSuperConsoleRole(user)) {
      autoSignOutRef.current = "";
      setSigningOutUnauthorized(false);
      return;
    }

    const userId = String(user?.id || user?._id || user?.email || "").trim();
    if (!userId || autoSignOutRef.current === userId) return;
    autoSignOutRef.current = userId;
    setSigningOutUnauthorized(true);

    Promise.resolve(logout())
      .catch(() => {
        // no-op
      })
      .finally(() => {
        setSigningOutUnauthorized(false);
      });
  }, [isReady, logout, token, user]);

  if (token && hasSuperConsoleRole(user)) {
    return <Navigate to={superDestinationFromUser(user)} replace />;
  }

  if (signingOutUnauthorized) {
    return (
      <section className="super-login-shell">
        <div className="super-login-backdrop" />
        <div className="super-login-content">
          <div className="super-login-panel">
            <div className="super-login-panel-header">
              <p className="super-login-kicker">PondBridge</p>
              <h1>Super Admin Console</h1>
              <p className="error-text">This account is not authorized for super admin access.</p>
              <p className="super-login-subtitle">
                Signing out <strong>{String(user?.email || "unknown account")}</strong> so you can continue with your
                normal Super Admin login.
              </p>
            </div>
            <Button onClick={handleSwitchAccount} disabled>
              Switching account...
            </Button>
          </div>
        </div>
      </section>
    );
  }

  // -----------------------------------------------------------------
  // BOOTSTRAP-FAILURE GATE: Clerk reports the user as signed-in but
  // the API bootstrap failed (401/403).  Rendering the <SignIn>
  // component in this state would cause an infinite redirect loop
  // because Clerk detects the active session and immediately
  // force-redirects to /super/tenants, which redirects back here.
  // Instead, show a diagnostic error with retry / sign-out options.
  // -----------------------------------------------------------------
  if (isReady && !token && clerkIsLoaded && isSignedIn && bootstrapError) {
    return (
      <section className="super-login-shell">
        <div className="super-login-backdrop" />
        <div className="super-login-content">
          <div className="super-login-panel">
            <div className="super-login-panel-header">
              <p className="super-login-kicker">PondBridge</p>
              <h1>Super Admin Console</h1>
              <p className="error-text">Could not verify your admin access.</p>
              <p className="super-login-subtitle">
                You are signed in through Clerk but the server could not establish
                your super admin session. This usually means the API server is
                unreachable, your account is not provisioned as a super admin, or
                there is an environment configuration mismatch.
              </p>
              <p className="super-login-subtitle" style={{ fontSize: "0.85em", opacity: 0.75 }}>
                <code>{bootstrapError}</code>
              </p>
            </div>
            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
              <Button onClick={handleRetryBootstrap} disabled={retrying || !isReady}>
                {retrying ? "Retrying..." : "Retry"}
              </Button>
              <Button variant="ghost" onClick={handleSwitchAccount}>
                Sign out &amp; switch account
              </Button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="super-login-shell">
      <div className="super-login-backdrop" />
      <div className="super-login-content">
        <div className="super-login-panel">
          <div className="super-login-panel-header">
            <p className="super-login-kicker">PondBridge</p>
            <h1>Super Admin Console</h1>
            <p className="super-login-subtitle">Secure sign-in for platform administration.</p>
          </div>
          <div
            className="super-login-card"
            onMouseDownCapture={handleAuthInteraction}
            onTouchStartCapture={handleAuthInteraction}
            onKeyDownCapture={handleAuthInteraction}
          >
            <SignIn
              routing="virtual"
              fallbackRedirectUrl="/super/tenants"
              forceRedirectUrl="/super/tenants"
              withSignUp={false}
              localization={{
                signIn: {
                  start: {
                    title: "Sign in to PondBridge Super Admin",
                    subtitle: "Use your authorized administrator account."
                  },
                  password: {
                    title: "Enter your password",
                    subtitle: "Continue to PondBridge Super Admin."
                  },
                  emailCode: {
                    title: "Check your email",
                    subtitle: "Enter the verification code we sent to your email."
                  },
                  emailLink: {
                    title: "Check your email",
                    subtitle: "Open the secure sign-in link in your email to continue."
                  }
                }
              }}
              appearance={{
                variables: {
                  colorPrimary: "var(--brand-primary)",
                  colorText: "var(--text)",
                  colorTextSecondary: "var(--text-muted)",
                  colorInputBackground: "#ffffff",
                  colorInputText: "var(--text)",
                  colorNeutral: "#d4dfec",
                  borderRadius: "12px",
                  fontFamily: "Inter, Avenir Next, Segoe UI, sans-serif"
                },
                elements: {
                  rootBox: {
                    width: "100%"
                  },
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
                  },
                  header: {
                    display: "none"
                  },
                  headerTitle: {
                    display: "none"
                  },
                  headerSubtitle: {
                    display: "none"
                  },
                  footerAction: {
                    display: "none"
                  },
                  footer: {
                    display: "none"
                  }
                },
                unsafe_disableDevelopmentModeWarnings: true
              }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function ClerkConfigErrorPage() {
  return (
    <section className="super-login-shell">
      <div className="super-login-backdrop" />
      <div className="super-login-content">
        <div className="super-login-panel">
          <div className="super-login-panel-header">
            <p className="super-login-kicker">PondBridge</p>
            <h1>Super Admin Console</h1>
            <p className="error-text">{clerkConfigError() || "Clerk auth is not configured correctly."}</p>
            <p className="super-login-subtitle">
              Set <code>VITE_CLERK_PUBLISHABLE_KEY</code> and restart the web build.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function SuperLoginPage() {
  if (!clerkUiEnabled()) return <ClerkConfigErrorPage />;
  return <ClerkSuperLoginPage />;
}
