import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { SignUp, useAuth as useClerkAuth } from "@clerk/clerk-react";
import { requestJson } from "../lib/http.js";
import { useTenant } from "../context/TenantContext.jsx";

function routeWithSlug(slug, path, useSlugPrefix = true) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return slug && useSlugPrefix ? `/t/${slug}${normalizedPath}` : normalizedPath;
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
  const [inviteMeta, setInviteMeta] = useState(null);
  const [inviteError, setInviteError] = useState("");
  const callbackPath = inviteToken
    ? `${routeWithSlug(slug, "/auth/callback", usingSlugRoute)}?inviteToken=${encodeURIComponent(inviteToken)}`
    : `${routeWithSlug(slug, "/auth/callback", usingSlugRoute)}?directorBootstrap=1`;
  const signUpPath = routeWithSlug(slug, "/director-create-account", usingSlugRoute);

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
    navigate(callbackPath, { replace: true });
  }, [callbackPath, directorBootstrap, isLoaded, isSignedIn, navigate, slug]);

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
              fallbackRedirectUrl={callbackPath}
              forceRedirectUrl={callbackPath}
              appearance={{
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
                    gap: "10px"
                  },
                  form: {
                    gap: "12px"
                  },
                  headerTitle: {
                    display: "none"
                  },
                  headerSubtitle: {
                    display: "none"
                  }
                },
                unsafe_disableDevelopmentModeWarnings: true
              }}
            />
          ) : null}
        </article>
      </div>
    </section>
  );
}
