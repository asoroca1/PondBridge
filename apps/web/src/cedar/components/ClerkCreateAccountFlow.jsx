import React, { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { SignUp, useAuth as useClerkAuth } from "@clerk/clerk-react";
import { requestJson } from "../../lib/http.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { useTenant } from "../../context/TenantContext.jsx";
import { normalizeTenantRouteForHost, tenantRoute } from "../../lib/tenantRouting.js";
import { resolveNetworkDisplayName } from "../lib/campLabels.js";

function routeWithSlug(slug, path) {
  return tenantRoute(slug, path);
}

function truthy(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

export default function ClerkCreateAccountFlow() {
  const navigate = useNavigate();
  const params = useParams();
  const { slug: contextSlug, tenant } = useTenant();
  const slug = String(params.slug || contextSlug || "").trim().toLowerCase();
  const networkName = resolveNetworkDisplayName(tenant);
  const [searchParams] = useSearchParams();
  const inviteToken = String(searchParams.get("inviteToken") || searchParams.get("token") || "").trim();
  const completeJoin = truthy(searchParams.get("completeJoin"));
  const { refreshSession } = useAuth();
  const { isLoaded, isSignedIn, getToken } = useClerkAuth();
  const [inviteMeta, setInviteMeta] = useState(null);
  const [accessCode, setAccessCode] = useState("");
  const [submittingJoin, setSubmittingJoin] = useState(false);
  const [error, setError] = useState("");

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
    if (completeJoin) return;
    const callbackPath = routeWithSlug(
      slug,
      `/auth/callback${inviteToken ? `?inviteToken=${encodeURIComponent(inviteToken)}` : ""}`
    );
    navigate(callbackPath, { replace: true });
  }, [completeJoin, inviteToken, isLoaded, isSignedIn, navigate, slug]);

  async function onCompleteJoin(event) {
    event.preventDefault();
    if (!slug) return;
    setError("");
    setSubmittingJoin(true);

    try {
      const token = await getToken();
      if (!token) throw new Error("Missing Clerk session token.");

      const payload = await requestJson(`/api/t/${slug}/access/join`, {
        method: "POST",
        token,
        body: { accessCode: String(accessCode || "").trim() }
      });
      await refreshSession({ tenantSlug: slug });
      const next = normalizeTenantRouteForHost(
        slug,
        String(payload?.decision?.nextRoute || routeWithSlug(slug, "/home")).trim()
      );
      navigate(next, { replace: true });
    } catch (err) {
      setError(String(err?.message || "Unable to complete signup for this network."));
    } finally {
      setSubmittingJoin(false);
    }
  }

  if (isLoaded && isSignedIn && completeJoin) {
    return (
      <section className="product-claim-page product-director-create-page product-director-create-clerk-page alumni-create-clerk-page">
        <div className="product-claim-wrap product-director-create-wrap product-director-create-clerk-wrap">
          <article className="product-claim-card product-director-create-card product-director-create-clerk-card alumni-create-clerk-card">
            <div className="product-director-create-clerk-intro alumni-create-clerk-intro">
              <p className="product-director-create-kicker">Camp Access</p>
              <h1>Complete Signup</h1>
              <p className="product-claim-body director-create-subtitle">
                This camp requires an access code to finish joining {networkName}.
              </p>
            </div>
            <form className="login1-form alumni-create-join-form" onSubmit={onCompleteJoin}>
              <input
                className="login1-input"
                type="text"
                value={accessCode}
                onChange={(event) => setAccessCode(event.target.value)}
                placeholder="Enter access code"
                required
              />
              {error ? <p className="login1-error">{error}</p> : null}
              <button className="login1-btn" type="submit" disabled={submittingJoin}>
                {submittingJoin ? "Joining..." : "Join Network"}
              </button>
            </form>
          </article>
        </div>
      </section>
    );
  }

  const path = routeWithSlug(slug, "/create-account");
  const callbackPath = routeWithSlug(
    slug,
    `/auth/callback${inviteToken ? `?inviteToken=${encodeURIComponent(inviteToken)}` : ""}`
  );
  const signInUrl = routeWithSlug(slug, `/login${inviteToken ? `?inviteToken=${encodeURIComponent(inviteToken)}` : ""}`);

  return (
    <section className="product-claim-page product-director-create-page product-director-create-clerk-page alumni-create-clerk-page">
      <div className="product-claim-wrap product-director-create-wrap product-director-create-clerk-wrap">
        <article className="product-claim-card product-director-create-card product-director-create-clerk-card alumni-create-clerk-card">
          <div className="product-director-create-clerk-intro alumni-create-clerk-intro">
            <p className="product-director-create-kicker">Camp Access</p>
            <h1>Create Account</h1>
            <p className="product-claim-body director-create-subtitle">
              Sign up with email to join {networkName}.
            </p>
          </div>
          {inviteMeta ? (
            <p className="success-text">
              Invite recognized for <strong>{inviteMeta.email || "this account"}</strong>.
            </p>
          ) : null}
          <div className="alumni-create-clerk-host">
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
                    subtitle: `Open the secure sign-up link to continue to ${networkName}.`
                  },
                  emailCode: {
                    title: "Check your email",
                    subtitle: `Enter the verification code to continue to ${networkName}.`
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
