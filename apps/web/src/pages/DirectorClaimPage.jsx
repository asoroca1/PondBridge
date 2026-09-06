import { useEffect, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth as useClerkAuth } from "@clerk/clerk-react";
import { Button } from "@pondbridge/ui";
import { useAuth } from "../context/AuthContext.jsx";
import { useTenant } from "../context/TenantContext.jsx";
import { clerkUiEnabled } from "../lib/authMode.js";
import { resolveAlumniWord } from "../lib/campLabels.js";
import { tenantRoute } from "../lib/tenantRouting.js";
import "../styles/productOnboarding.css";

function DirectorClaimPageContent() {
  const { slug: paramSlug } = useParams();
  const { slug: tenantSlug, tenant } = useTenant();
  const navigate = useNavigate();
  const alumniWord = resolveAlumniWord(tenant);

  const slug = String(paramSlug || tenantSlug || "").trim().toLowerCase();
  const createAccountPath = useMemo(
    () => tenantRoute(slug, "/director-create-account"),
    [slug]
  );
  const loginPath = useMemo(() => tenantRoute(slug, "/login"), [slug]);
  const campName = String(tenant?.name || "").trim();

  return (
    <section className="product-claim-page product-director-claim-page">
      <div className="product-claim-wrap product-director-claim-wrap">
        <article className="product-claim-card product-director-claim-card">
          <p className="product-director-create-kicker">Director Onboarding</p>
          {/* A director arriving from an invite link needs to see which camp
              this is before creating anything. */}
          {campName ? <p className="director-claim-camp">{campName}</p> : null}
          <h1>{`Welcome to the future of your camp's ${alumniWord} network.`}</h1>
          {/* The steps named here are the steps the wizard actually has. It
              previously promised access settings and an import step, neither of
              which exists in setup. */}
          <p className="product-claim-body director-claim-subtitle">
            Create your director account to start setup. You&apos;ll choose your branding, features,
            and camp details, then launch.
          </p>
          <div className="product-claim-actions director-claim-actions">
            <Button onClick={() => navigate(createAccountPath)}>Create director account</Button>
          </div>
          <p className="product-claim-body director-claim-signin">
            Already have a director account?{" "}
            <button type="button" className="director-claim-link" onClick={() => navigate(loginPath)}>
              Sign in
            </button>
          </p>
        </article>
      </div>
    </section>
  );
}

function LegacyDirectorClaimPage() {
  return <DirectorClaimPageContent />;
}

function ClerkDirectorClaimPage() {
  const { slug: paramSlug } = useParams();
  const { slug: tenantSlug } = useTenant();
  const navigate = useNavigate();
  const { isLoaded, isSignedIn } = useClerkAuth();
  const { isAuthenticated, user } = useAuth();

  const slug = String(paramSlug || tenantSlug || "").trim().toLowerCase();
  const directorCreatePath = useMemo(() => tenantRoute(slug, "/director-create-account"), [slug]);
  const directorSetupPath = useMemo(() => tenantRoute(slug, "/director-create-account?setup=1"), [slug]);
  const callbackPath = useMemo(() => tenantRoute(slug, "/auth/callback?directorBootstrap=1"), [slug]);
  const hasDirectorMembership = Boolean(isAuthenticated && user?.roles?.includes("tenant_admin"));

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    if (hasDirectorMembership) {
      navigate(directorSetupPath, { replace: true });
      return;
    }
    if (isAuthenticated && user) {
      navigate(directorCreatePath, { replace: true });
      return;
    }
    navigate(callbackPath, { replace: true });
  }, [
    callbackPath,
    directorCreatePath,
    directorSetupPath,
    hasDirectorMembership,
    isAuthenticated,
    isLoaded,
    isSignedIn,
    navigate,
    user
  ]);

  return <DirectorClaimPageContent />;
}

export default function DirectorClaimPage() {
  if (clerkUiEnabled()) return <ClerkDirectorClaimPage />;
  return <LegacyDirectorClaimPage />;
}
