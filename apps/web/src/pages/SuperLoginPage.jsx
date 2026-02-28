import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { SignIn } from "@clerk/clerk-react";
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
  const { token, user, isReady, logout } = useAuth();
  const [signingOutUnauthorized, setSigningOutUnauthorized] = useState(false);
  const autoSignOutRef = useRef("");
  useEffect(() => {
    try {
      localStorage.removeItem("pondbridgeTenantSlug");
    } catch {
      // no-op
    }
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
