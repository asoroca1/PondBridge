import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
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
  const loginPath = inviteToken
    ? `${routeWithSlug(slug, "/login", usingSlugRoute)}?inviteToken=${encodeURIComponent(inviteToken)}`
    : routeWithSlug(slug, "/login", usingSlugRoute);
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
    <section className="product-claim-page product-director-create-page">
      <div className="product-claim-wrap product-director-create-wrap product-director-create-clerk-wrap">
        <article className="product-claim-card product-director-create-card product-director-create-clerk-card">
          <h1>Create Director Account</h1>
          <p className="product-claim-body director-create-subtitle">
            Create your director account to continue camp onboarding.
          </p>
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
              signInUrl={loginPath}
              fallbackRedirectUrl={callbackPath}
              forceRedirectUrl={callbackPath}
              appearance={{
                elements: {
                  rootBox: {
                    width: "100%"
                  },
                  card: {
                    boxShadow: "0 16px 38px rgba(13, 34, 66, 0.12)",
                    border: "1px solid #d6deeb",
                    width: "100%",
                    maxWidth: "100%",
                    borderRadius: "16px",
                    background: "#ffffff"
                  },
                  headerTitle: {
                    fontSize: "2rem",
                    lineHeight: "1.12"
                  },
                  headerSubtitle: {
                    fontSize: "1rem"
                  }
                }
              }}
            />
          ) : (
            <div className="product-claim-actions">
              <Link className="btn btn-secondary" to={loginPath}>
                Back to login
              </Link>
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
