import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { SignUp, useAuth as useClerkAuth } from "@clerk/clerk-react";
import { requestJson } from "../../lib/http.js";
import { noteTabLoginIntent } from "../../context/AuthContext.jsx";
import { useTenant } from "../../context/TenantContext.jsx";
import { tenantRoute } from "../../lib/tenantRouting.js";
import { resolveNetworkDisplayName } from "../../lib/campLabels.js";
import {
  clearPendingLegalAgreement,
  readPendingLegalAgreement,
  setPendingLegalAgreementAccepted
} from "../../lib/legalAgreement.js";

function routeWithSlug(slug, path) {
  return tenantRoute(slug, path);
}

export default function ClerkCreateAccountFlow() {
  const navigate = useNavigate();
  const params = useParams();
  const { slug: contextSlug, tenant } = useTenant();
  const slug = String(params.slug || contextSlug || "").trim().toLowerCase();
  const networkName = resolveNetworkDisplayName(tenant);
  const [searchParams] = useSearchParams();
  const inviteToken = String(searchParams.get("inviteToken") || searchParams.get("token") || "").trim();
  const legalRequired = String(searchParams.get("legalRequired") || "").trim() === "1";
  const { isLoaded, isSignedIn } = useClerkAuth();
  const [inviteMeta, setInviteMeta] = useState(null);
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [legalError, setLegalError] = useState("");

  useEffect(() => {
    noteTabLoginIntent();
  }, []);

  useEffect(() => {
    const pending = readPendingLegalAgreement(slug);
    setLegalAccepted(Boolean(pending?.accepted));
  }, [slug]);

  useEffect(() => {
    if (!legalRequired) return;
    setLegalError("You must agree to Terms and Privacy to create your account.");
  }, [legalRequired]);

  useEffect(() => {
    if (legalAccepted) {
      setPendingLegalAgreementAccepted(slug);
      return;
    }
    clearPendingLegalAgreement(slug);
  }, [legalAccepted, slug]);

  useEffect(() => {
    if (!inviteToken || !slug) return;
    requestJson(`/api/t/${slug}/auth/invite/verify`, {
      method: "POST",
      body: { inviteToken }
    })
      .then((payload) => {
        setInviteMeta(payload?.invite || null);
      })
      .catch(() => {
        setInviteMeta(null);
      });
  }, [inviteToken, slug]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !slug) return;
    const callbackPath = routeWithSlug(
      slug,
      `/auth/callback${inviteToken ? `?inviteToken=${encodeURIComponent(inviteToken)}` : ""}`
    );
    navigate(callbackPath, { replace: true });
  }, [inviteToken, isLoaded, isSignedIn, navigate, slug]);

  const path = routeWithSlug(slug, "/create-account");
  const callbackPath = routeWithSlug(
    slug,
    `/auth/callback${inviteToken ? `?inviteToken=${encodeURIComponent(inviteToken)}` : ""}`
  );
  const signInUrl = routeWithSlug(slug, `/login${inviteToken ? `?inviteToken=${encodeURIComponent(inviteToken)}` : ""}`);
  const legalPath = routeWithSlug(slug, "/legal");
  const onSignUpSubmitCapture = (event) => {
    if (legalAccepted) {
      setLegalError("");
      setPendingLegalAgreementAccepted(slug);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setLegalError("You must agree to Terms and Privacy to create your account.");
  };

  return (
    <section className="product-claim-page product-director-create-page product-director-create-clerk-page alumni-create-clerk-page">
      <div className="product-claim-wrap product-director-create-wrap product-director-create-clerk-wrap">
        <article className="product-claim-card product-director-create-card product-director-create-clerk-card alumni-create-clerk-card">
          <div className="product-director-create-clerk-intro alumni-create-clerk-intro">
            <p className="product-director-create-kicker">Camp Access</p>
            <h1 className="auth-entry-title">Create Account</h1>
          </div>
          {inviteMeta ? (
            <p className="success-text">
              Invite recognized for <strong>{inviteMeta.email || "this account"}</strong>.
            </p>
          ) : null}
          <div className={`alumni-create-legal-block ${legalError ? "has-error" : ""}`}>
            <label className="alumni-create-legal-check">
              <input
                type="checkbox"
                checked={legalAccepted}
                onChange={(event) => {
                  setLegalAccepted(event.target.checked);
                  setLegalError("");
                }}
              />
              <span>
                I agree to the{" "}
                <a href={`${legalPath}#terms`} target="_blank" rel="noreferrer">
                  Terms of Service
                </a>{" "}
                and{" "}
                <a href={`${legalPath}#privacy`} target="_blank" rel="noreferrer">
                  Privacy Policy
                </a>
                .
              </span>
            </label>
            {legalError ? <p className="error-text alumni-create-legal-error">{legalError}</p> : null}
          </div>
          <div className="alumni-create-clerk-host" onSubmitCapture={onSignUpSubmitCapture}>
            <SignUp
              path={path}
              routing="path"
              withSignIn={false}
              signInUrl={signInUrl}
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
                    subtitle: `Open the secure sign-up link to continue to ${networkName}.`,
                    formSubtitle: `Use the secure link we sent to continue to ${networkName}.`
                  },
                  emailCode: {
                    title: "Check your email",
                    subtitle: `Enter the verification code to continue to ${networkName}.`,
                    formSubtitle: `Enter the code from your email to continue to ${networkName}.`
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
                  headerTitle: {
                    display: "none"
                  },
                  headerSubtitle: {
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
                  formFieldInputShowPasswordButton: {
                    color: "var(--text-muted)"
                  },
                  formButtonPrimary: {
                    minHeight: "48px",
                    borderRadius: "12px",
                    background: "var(--brand-primary)",
                    boxShadow: "none",
                    fontWeight: "700",
                    fontSize: "1rem"
                  }
                }
              }}
              unsafe_disableDevelopmentModeWarnings
            />
          </div>
        </article>
      </div>
    </section>
  );
}
