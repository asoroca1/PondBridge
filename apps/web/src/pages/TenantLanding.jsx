import { Link, useParams } from "react-router-dom";
import { normalizeHeroImagePosition, normalizeHeroImageSize } from "@pondbridge/shared";
import { Button, Card, PageShell } from "@pondbridge/ui";
import { useTenant } from "../context/TenantContext.jsx";
import { resolveNetworkDisplayName } from "../lib/campLabels.js";
import cedarBg from "../assets/cedar-bg.jpg";

export default function TenantLanding() {
  const { slug } = useParams();
  const { tenant } = useTenant();
  const networkDisplayName = resolveNetworkDisplayName(tenant);
  const isDemo = tenant?.onboardingStatus !== "live";
  const heroBranding = tenant?.config?.branding || tenant?.theme || {};
  const heroImage = heroBranding.heroImageUrl || cedarBg;
  const heroImagePosition = normalizeHeroImagePosition(
    heroBranding.heroImagePositionLanding || heroBranding.heroImagePosition || ""
  );
  const heroImageSize = normalizeHeroImageSize(
    heroBranding.heroImageSizeLanding || heroBranding.heroImageSize || ""
  );

  return (
    <div className={`home1 ${isDemo ? "home1-demo" : ""}`}>
      <section
        className="home-masthead"
        style={{
          backgroundImage: `url(${heroImage})`,
          backgroundPosition: heroImagePosition || "center center",
          backgroundSize: heroImageSize || "cover"
        }}
      />
      <PageShell className="home-content-shell">
        <section className="welcome-hero">
          <Card className="welcome-banner">
            <div className="welcome-left">
              <div className="welcome-copy">
                <h1 className="welcome-title">
                  Welcome to {networkDisplayName}
                  <span className="title-accent" />
                </h1>
                <p className="welcome-sub">
                  {tenant?.content?.welcomeBody || "Reconnect with your camp community."}
                </p>
                {isDemo ? (
                  <p className="muted">
                    This network is in setup mode. Directors can preview and configure everything before launch.
                  </p>
                ) : null}
                <div className="inline-actions">
                  <Link className="link-button" to={`/t/${slug}/login`}>
                    Sign in
                  </Link>
                  {tenant?.accessSettings?.signupEnabled && !isDemo ? (
                    <Link className="link-button secondary" to={`/t/${slug}/create-account`}>
                      Create account
                    </Link>
                  ) : (
                    <Button variant="secondary" disabled>
                      {isDemo ? "Signup opens after launch" : "Signup unavailable"}
                    </Button>
                  )}
                </div>
              </div>
            </div>
            {!isDemo ? (
              <div className="welcome-right">
                <div className="pulse-card">
                  <span className="pulse-head">Network Pulse</span>
                  <div className="pulse-rows">
                    <span className="pulse-row">
                      <span className="pulse-num">{tenant?.planTier === "premium" ? "Premium" : "Base"}</span>
                      <span className="pulse-label">Plan</span>
                    </span>
                    <span className="pulse-row">
                      <span className="pulse-num">{tenant?.status === "active" ? "Live" : "Paused"}</span>
                      <span className="pulse-label">Status</span>
                    </span>
                  </div>
                </div>
              </div>
            ) : null}
          </Card>
        </section>
      </PageShell>
    </div>
  );
}
