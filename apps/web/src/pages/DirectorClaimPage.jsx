import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAuth as useClerkAuth } from "@clerk/clerk-react";
import { Button } from "@pondbridge/ui";
import { requestJson } from "../lib/http.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useTenant } from "../context/TenantContext.jsx";

export default function DirectorClaimPage() {
  const { slug: paramSlug } = useParams();
  const { slug: tenantSlug } = useTenant();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isReady, isAuthenticated, authProvider, refreshSession } = useAuth();
  const { isLoaded: clerkLoaded, isSignedIn, getToken } = useClerkAuth();
  const bootstrapRef = useRef(false);
  const [autoClaimError, setAutoClaimError] = useState("");

  const slug = String(paramSlug || tenantSlug || "").trim().toLowerCase();
  const token = String(searchParams.get("token") || searchParams.get("inviteToken") || "").trim();
  const createAccountBasePath = slug ? `/t/${slug}/director-create-account` : "/director-create-account";
  const createAccountPath = token
    ? `${createAccountBasePath}?inviteToken=${encodeURIComponent(token)}`
    : createAccountBasePath;
  const setupWizardPath = slug
    ? `/t/${slug}/director-create-account?setup=1`
    : "/director-create-account?setup=1";

  useEffect(() => {
    const clerkMode = ["clerk", "hybrid"].includes(String(authProvider || "").toLowerCase());
    if (!clerkMode || !isReady || !clerkLoaded || !isSignedIn || !isAuthenticated || !slug || token) return;
    if (bootstrapRef.current) return;
    let cancelled = false;
    bootstrapRef.current = true;

    async function autoClaimDirector() {
      try {
        const authToken = await getToken();
        if (!authToken) return;
        await requestJson(`/api/t/${slug}/access/director-bootstrap`, {
          method: "POST",
          token: authToken,
          body: {}
        });
        await refreshSession({ tenantSlug: slug });
        if (cancelled) return;
        navigate(setupWizardPath, { replace: true });
      } catch (error) {
        if (cancelled) return;
        const status = Number(error?.status || 0);
        if (status === 409 || status === 403) return;
        setAutoClaimError(String(error?.message || "Unable to start director onboarding."));
      } finally {
        bootstrapRef.current = false;
      }
    }

    autoClaimDirector();
    return () => {
      cancelled = true;
    };
  }, [
    authProvider,
    clerkLoaded,
    getToken,
    isAuthenticated,
    isReady,
    isSignedIn,
    navigate,
    setupWizardPath,
    refreshSession,
    slug,
    token
  ]);

  return (
    <section className="product-claim-page product-director-claim-page">
      <div className="product-claim-wrap product-director-claim-wrap">
        <article className="product-claim-card product-director-claim-card">
          <p className="product-director-create-kicker">Director Onboarding</p>
          <h1>Welcome to the future of your camp&apos;s alumni network.</h1>
          <p className="product-claim-body director-claim-subtitle">
            Create your director account to start setup. You&apos;ll be guided through branding,
            access settings, alumni import, and launch.
          </p>
          {autoClaimError ? <p className="error-text">{autoClaimError}</p> : null}
          <div className="product-claim-actions director-claim-actions">
            <Button onClick={() => navigate(createAccountPath)}>Create director account</Button>
          </div>
        </article>
      </div>
    </section>
  );
}
