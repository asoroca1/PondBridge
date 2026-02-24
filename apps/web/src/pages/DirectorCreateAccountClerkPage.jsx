import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { SignUp, useAuth as useClerkAuth } from "@clerk/clerk-react";
import { Button } from "@pondbridge/ui";
import { requestJson } from "../lib/http.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useTenant } from "../context/TenantContext.jsx";

function routeWithSlug(slug, path, useSlugPrefix = true) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return slug && useSlugPrefix ? `/t/${slug}${normalizedPath}` : normalizedPath;
}

function directorBootstrapIntentKey(slug = "") {
  return `pondbridgeDirectorBootstrapIntent:${String(slug || "").trim().toLowerCase() || "default"}`;
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
  const [searchParams] = useSearchParams();
  const inviteToken = String(searchParams.get("inviteToken") || searchParams.get("token") || "").trim();
  const directorBootstrap = !inviteToken;
  const { isLoaded, isSignedIn } = useClerkAuth();
  const { user, isAuthenticated, logout } = useAuth();
  const [inviteMeta, setInviteMeta] = useState(null);
  const [inviteError, setInviteError] = useState("");
  const bootstrapInFlightRef = useRef(false);
  const callbackPath = inviteToken
    ? `${routeWithSlug(slug, "/auth/callback", usingSlugRoute)}?inviteToken=${encodeURIComponent(inviteToken)}`
    : `${routeWithSlug(slug, "/auth/callback", usingSlugRoute)}?directorBootstrap=1`;
  const signUpPath = routeWithSlug(slug, "/director-create-account", usingSlugRoute);
  const signInPath = routeWithSlug(slug, "/login", usingSlugRoute);
  const setupPath = routeWithSlug(slug, "/director-create-account?setup=1", usingSlugRoute);
  const hasDirectorMembership = Boolean(isAuthenticated && user?.roles?.includes("tenant_admin"));
  const showDirectorContinue = Boolean(isLoaded && isSignedIn && directorBootstrap && hasDirectorMembership);
  const showAccountSwitchPrompt = Boolean(isLoaded && isSignedIn && directorBootstrap && !hasDirectorMembership);

  useEffect(() => {
    if (typeof window === "undefined" || !slug) return;
    const key = directorBootstrapIntentKey(slug);
    if (directorBootstrap && !(isLoaded && isSignedIn)) {
      window.sessionStorage.setItem(key, "1");
      return;
    }
    window.sessionStorage.removeItem(key);
  }, [directorBootstrap, isLoaded, isSignedIn, slug]);

  useEffect(() => {
    if (!inviteToken || !slug) return;
    requestJson(`/api/t/${slug}/auth/invite/verify`, {
      method: "POST",
      body: { inviteToken }
    })
      .then((payload) => {
        setInviteMeta(payload?.invite || null);
        setInviteError("");
      })
      .catch((err) => {
        setInviteMeta(null);
        setInviteError(String(err?.message || "This invite is invalid or expired."));
      });
  }, [inviteToken, slug]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !slug || !inviteToken) return;
    navigate(callbackPath, { replace: true });
  }, [callbackPath, inviteToken, isLoaded, isSignedIn, navigate, slug]);

  useEffect(() => {
    if (!showDirectorContinue) return;
    navigate(setupPath, { replace: true });
  }, [navigate, setupPath, showDirectorContinue]);

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
          </div>
          {inviteError ? <p className="error-text">{inviteError}</p> : null}
          {inviteMeta ? (
            <p className="success-text">
              Invite verified for <strong>{inviteMeta.email || "director"}</strong>.
            </p>
          ) : null}

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

          {!inviteError && !showAccountSwitchPrompt ? (
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
                    color: "#17375e",
                    fontWeight: "700"
                  },
                  formFieldInput: {
                    minHeight: "46px",
                    borderRadius: "12px",
                    border: "1px solid #d4dfec",
                    boxShadow: "none",
                    color: "#17375e",
                    background: "#ffffff"
                  },
                  formButtonPrimary: {
                    minHeight: "48px",
                    borderRadius: "12px",
                    background: "#0b2f57",
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
