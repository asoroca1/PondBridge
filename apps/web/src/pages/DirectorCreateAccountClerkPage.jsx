import { useEffect, useRef } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { SignUp, useAuth as useClerkAuth } from "@clerk/clerk-react";
import { Button } from "@pondbridge/ui";
import { useAuth } from "../context/AuthContext.jsx";
import { useTenant } from "../context/TenantContext.jsx";

function routeWithSlug(slug, path, useSlugPrefix = true) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return slug && useSlugPrefix ? `/t/${slug}${normalizedPath}` : normalizedPath;
}

function directorBootstrapIntentKey(slug = "") {
  return `pondbridgeDirectorBootstrapIntent:${String(slug || "").trim().toLowerCase() || "default"}`;
}

function directorBootstrapCallbackAttemptKey(slug = "") {
  return `pondbridgeDirectorBootstrapCallbackAttempt:${String(slug || "").trim().toLowerCase() || "default"}`;
}

export default function DirectorCreateAccountClerkPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const { slug: contextSlug } = useTenant();
  const slug = String(params.slug || contextSlug || "").trim().toLowerCase();
  const usingSlugRoute =
    Boolean(slug) &&
    (location.pathname === `/t/${slug}` || location.pathname.startsWith(`/t/${slug}/`));
  const { isLoaded, isSignedIn } = useClerkAuth();
  const { user, isAuthenticated, logout } = useAuth();
  const bootstrapInFlightRef = useRef(false);
  const callbackPath = `${routeWithSlug(slug, "/auth/callback", usingSlugRoute)}?directorBootstrap=1`;
  const signUpPath = routeWithSlug(slug, "/director-create-account", usingSlugRoute);
  const signInPath = routeWithSlug(slug, "/login", usingSlugRoute);
  const setupPath = routeWithSlug(slug, "/director-create-account?setup=1", usingSlugRoute);
  const setupPathNoQuery = routeWithSlug(slug, "/director-create-account", usingSlugRoute);
  const onSetupRoute = location.pathname === setupPathNoQuery && new URLSearchParams(location.search || "").get("setup") === "1";
  const hasDirectorMembership = Boolean(isAuthenticated && user?.roles?.includes("tenant_admin"));
  const showDirectorContinue = Boolean(isLoaded && isSignedIn && hasDirectorMembership);
  const syncingSignedInState = Boolean(isLoaded && isSignedIn && !isAuthenticated && !hasDirectorMembership);
  const showAccountSwitchPrompt = Boolean(
    isLoaded && isSignedIn && isAuthenticated && user && !hasDirectorMembership
  );

  useEffect(() => {
    if (typeof window === "undefined" || !slug) return;
    const key = directorBootstrapIntentKey(slug);
    const callbackAttemptKey = directorBootstrapCallbackAttemptKey(slug);
    if (!(isLoaded && isSignedIn)) {
      window.sessionStorage.setItem(key, "1");
      window.sessionStorage.removeItem(callbackAttemptKey);
      return;
    }
    window.sessionStorage.removeItem(key);
    if (hasDirectorMembership || showAccountSwitchPrompt) {
      window.sessionStorage.removeItem(callbackAttemptKey);
    }
  }, [hasDirectorMembership, isLoaded, isSignedIn, showAccountSwitchPrompt, slug]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!syncingSignedInState || !slug) return;
    const callbackAttemptKey = directorBootstrapCallbackAttemptKey(slug);
    if (window.sessionStorage.getItem(callbackAttemptKey) === "1") return;
    window.sessionStorage.setItem(callbackAttemptKey, "1");
    navigate(callbackPath, { replace: true });
  }, [callbackPath, navigate, slug, syncingSignedInState]);

  useEffect(() => {
    if (!showDirectorContinue || onSetupRoute) return;
    navigate(setupPath, { replace: true });
  }, [navigate, onSetupRoute, setupPath, showDirectorContinue]);

  async function handleSwitchToDirectorSignup() {
    if (bootstrapInFlightRef.current) return;
    bootstrapInFlightRef.current = true;
    try {
      await logout();
      navigate(signUpPath, { replace: true });
    } finally {
      bootstrapInFlightRef.current = false;
    }
  }

  return (
    <section className="product-claim-page product-director-create-page product-director-create-clerk-page">
      <div className="product-claim-wrap product-director-create-wrap product-director-create-clerk-wrap">
        <article className="product-claim-card product-director-create-card product-director-create-clerk-card">
          <div className="product-director-create-clerk-intro">
            <p className="product-director-create-kicker">Director Onboarding</p>
            <h1>Create Director Account</h1>
            <p className="product-claim-body director-create-subtitle">
              Create your director login to start network setup.
            </p>
            {!showAccountSwitchPrompt ? (
              <div className="director-existing-account-callout director-existing-account-callout--clerk">
                <span>Already created your director account?</span>
                <Link to={signInPath}>Log in and continue onboarding</Link>
              </div>
            ) : null}
          </div>

          {showAccountSwitchPrompt ? (
            <div className="director-create-signed-in-gate">
              <p className="product-claim-body">
                You are currently signed in as <strong>{String(user?.email || "another account")}</strong>.
                Sign out first to create and verify the director account for this camp.
              </p>
              <div className="product-claim-actions director-claim-actions">
                <Button onClick={handleSwitchToDirectorSignup} disabled={bootstrapInFlightRef.current}>
                  {bootstrapInFlightRef.current ? "Switching..." : "Sign out and create director account"}
                </Button>
              </div>
            </div>
          ) : null}

          {syncingSignedInState ? (
            <div className="director-create-signed-in-gate">
              <p className="product-claim-body">
                Finalizing your verified session. If this does not continue automatically, proceed below.
              </p>
              <div className="product-claim-actions director-claim-actions">
                <Button onClick={() => navigate(callbackPath, { replace: true })}>Continue setup</Button>
              </div>
            </div>
          ) : null}

          {!showAccountSwitchPrompt && !(isLoaded && isSignedIn) ? (
            <SignUp
              path={signUpPath}
              routing="path"
              withSignIn={false}
              signInUrl={signInPath}
              fallbackRedirectUrl={callbackPath}
              forceRedirectUrl={callbackPath}
              signInFallbackRedirectUrl={callbackPath}
              signInForceRedirectUrl={callbackPath}
              afterSignUpUrl={callbackPath}
              localization={{
                signUp: {
                  start: {
                    title: "",
                    subtitle: ""
                  },
                  emailLink: {
                    title: "Check your email",
                    subtitle: "Open the secure link to continue director onboarding."
                  },
                  emailCode: {
                    title: "Check your email",
                    subtitle: "Enter the verification code to continue director onboarding."
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
                  colorNeutral: "var(--card-border)",
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
                  footerAction: {
                    display: "none"
                  },
                  footerActionText: {
                    display: "none"
                  },
                  footerActionLink: {
                    display: "none"
                  },
                  footer: {
                    display: "none"
                  },
                  header: {
                    display: "none"
                  },
                  cardBox: {
                    boxShadow: "none",
                    border: "none",
                    width: "100%",
                    maxWidth: "100%",
                    background: "transparent",
                    padding: "0"
                  },
                  card: {
                    boxShadow: "none",
                    border: "none",
                    width: "100%",
                    maxWidth: "100%",
                    borderRadius: "0",
                    background: "transparent",
                    padding: "0"
                  },
                  main: {
                    padding: "0",
                    gap: "12px"
                  },
                  form: {
                    gap: "12px"
                  },
                  formFieldLabel: {
                    color: "var(--brand-primary-strong)",
                    fontWeight: "700"
                  },
                  formFieldInput: {
                    minHeight: "46px",
                    borderRadius: "12px",
                    border: "1px solid var(--card-border)",
                    boxShadow: "none",
                    color: "var(--text)",
                    background: "#ffffff"
                  },
                  formButtonPrimary: {
                    minHeight: "48px",
                    borderRadius: "12px",
                    background: "var(--brand-primary)",
                    boxShadow: "none",
                    fontWeight: "700",
                    fontSize: "1rem"
                  },
                  headerTitle: {
                    display: "none"
                  },
                  headerSubtitle: {
                    display: "none"
                  }
                }
              }}
              unsafe_disableDevelopmentModeWarnings
            />
          ) : null}
        </article>
      </div>
    </section>
  );
}
