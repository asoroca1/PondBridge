import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { SignUp, useAuth as useClerkAuth } from "@clerk/clerk-react";
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
  const { isLoaded, isSignedIn, getToken } = useClerkAuth();
  const { refreshSession } = useAuth();
  const [inviteMeta, setInviteMeta] = useState(null);
  const [inviteError, setInviteError] = useState("");
  const bootstrapInFlightRef = useRef(false);
  const callbackPath = inviteToken
    ? `${routeWithSlug(slug, "/auth/callback", usingSlugRoute)}?inviteToken=${encodeURIComponent(inviteToken)}`
    : `${routeWithSlug(slug, "/auth/callback", usingSlugRoute)}?directorBootstrap=1`;
  const signUpPath = routeWithSlug(slug, "/director-create-account", usingSlugRoute);
  const signInPath = routeWithSlug(slug, "/login", usingSlugRoute);

  useEffect(() => {
    if (typeof window === "undefined" || !slug) return;
    const key = directorBootstrapIntentKey(slug);
    if (directorBootstrap) {
      window.sessionStorage.setItem(key, "1");
      return;
    }
    window.sessionStorage.removeItem(key);
  }, [directorBootstrap, slug]);

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
    if (!isLoaded || !isSignedIn || !slug || !directorBootstrap) return;
    if (bootstrapInFlightRef.current) return;
    let cancelled = false;
    bootstrapInFlightRef.current = true;

    async function bootstrapDirector() {
      try {
        const token = await getToken();
        if (!token) throw new Error("No authenticated session token from Clerk.");

        await requestJson(`/api/t/${slug}/access/director-bootstrap`, {
          method: "POST",
          token,
          body: {}
        });
        await refreshSession({ tenantSlug: slug });

        if (cancelled) return;
        navigate(routeWithSlug(slug, "/onboarding", usingSlugRoute), { replace: true });
      } catch (error) {
        if (cancelled) return;
        const status = Number(error?.status || 0);
        if (status === 409) {
          navigate(callbackPath, { replace: true });
          return;
        }
        setInviteError(String(error?.message || "Unable to claim director access."));
      } finally {
        bootstrapInFlightRef.current = false;
      }
    }

    bootstrapDirector();
    return () => {
      cancelled = true;
    };
  }, [
    callbackPath,
    directorBootstrap,
    getToken,
    isLoaded,
    isSignedIn,
    navigate,
    refreshSession,
    slug,
    usingSlugRoute
  ]);

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

          {!inviteError ? (
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
