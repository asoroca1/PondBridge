import { Navigate } from "react-router-dom";
import { SignIn } from "@clerk/clerk-react";
import { Button } from "@pondbridge/ui";
import { useAuth } from "../context/AuthContext.jsx";
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
  return roles.has("finance_admin") && !roles.has("super_admin") ? "/super/billing" : "/super/dashboard";
}

function ClerkSuperLoginPage() {
  const { token, user, isReady, logout } = useAuth();

  if (token && hasSuperConsoleRole(user)) {
    return <Navigate to={superDestinationFromUser(user)} replace />;
  }

  if (token && isReady && user && !hasSuperConsoleRole(user)) {
    return (
      <section className="super-login-shell">
        <div className="super-login-backdrop" />
        <div className="super-login-content">
          <p className="super-login-kicker">PondBridge</p>
          <h1>Super Admin Console</h1>
          <p className="error-text">This account is not authorized for super admin access.</p>
          <Button onClick={() => logout()}>Sign out</Button>
        </div>
      </section>
    );
  }

  return (
    <section className="super-login-shell">
      <div className="super-login-backdrop" />
      <div className="super-login-content">
        <p className="super-login-kicker">PondBridge</p>
        <h1>Super Admin Console</h1>
        <p className="super-login-subtitle">Secure sign-in for platform administration.</p>
        <div className="super-login-card">
          <SignIn
            routing="virtual"
            fallbackRedirectUrl="/super/dashboard"
            forceRedirectUrl="/super/dashboard"
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
                colorPrimary: "#0b2f57",
                colorText: "#17375e",
                colorTextSecondary: "#5d738d",
                colorInputBackground: "#ffffff",
                colorInputText: "#17375e",
                colorNeutral: "#d4dfec",
                borderRadius: "12px",
                fontFamily: "Inter, Avenir Next, Segoe UI, sans-serif"
              },
              elements: {
                rootBox: {
                  width: "100%"
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
    </section>
  );
}

function ClerkConfigErrorPage() {
  return (
    <section className="super-login-shell">
      <div className="super-login-backdrop" />
      <div className="super-login-content">
        <p className="super-login-kicker">PondBridge</p>
        <h1>Super Admin Console</h1>
        <p className="error-text">{clerkConfigError() || "Clerk auth is not configured correctly."}</p>
        <p className="super-login-subtitle">
          Set <code>VITE_CLERK_PUBLISHABLE_KEY</code> and restart the web build.
        </p>
      </div>
    </section>
  );
}

export default function SuperLoginPage() {
  if (!clerkUiEnabled()) return <ClerkConfigErrorPage />;
  return <ClerkSuperLoginPage />;
}
