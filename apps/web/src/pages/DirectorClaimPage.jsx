import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@pondbridge/ui";
import { useTenant } from "../context/TenantContext.jsx";

export default function DirectorClaimPage() {
  const { slug: paramSlug } = useParams();
  const { slug: tenantSlug } = useTenant();
  const navigate = useNavigate();

  const slug = String(paramSlug || tenantSlug || "").trim().toLowerCase();
  const createAccountPath = useMemo(
    () => (slug ? `/t/${slug}/director-create-account` : "/director-create-account"),
    [slug]
  );

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
          <div className="product-claim-actions director-claim-actions">
            <Button onClick={() => navigate(createAccountPath)}>Create director account</Button>
          </div>
        </article>
      </div>
    </section>
  );
}
