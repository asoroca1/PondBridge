import { useNavigate } from "react-router-dom";
import { normalizeHeroImagePosition, normalizeHeroImageSize } from "@pondbridge/shared";
import { useTenant } from "../../context/TenantContext.jsx";
import { resolveAlumniWord, resolveCampName, resolveTenantContent } from "../../lib/campLabels.js";
import { tenantRoute } from "../../lib/tenantRouting.js";
import { preloadFullAuthRuntime } from "../../lib/authRuntimePreload.js";

function Home() {
  const navigate = useNavigate();
  const { tenant, slug = "" } = useTenant();
  const content = resolveTenantContent(tenant);
  const campName = resolveCampName(tenant);
  const alumniWord = resolveAlumniWord(tenant, { capitalized: true });
  const heroBranding = tenant?.config?.branding || tenant?.theme || {};
  const heroImage = String(heroBranding.heroImageUrl || "").trim();
  const heroImagePosition = normalizeHeroImagePosition(
    heroBranding.heroImagePositionLanding || heroBranding.heroImagePosition || ""
  );
  const heroImageSize = normalizeHeroImageSize(
    heroBranding.heroImageSizeLanding || heroBranding.heroImageSize || ""
  );
  const demoAccessEnabled = Boolean(tenant?.accessSettings?.demoAccessEnabled);

  return (
    <section
      className="landing-hero"
      style={{
        ...(heroImage ? { backgroundImage: `url(${heroImage})` } : {}),
        backgroundPosition: heroImagePosition || "center center",
        backgroundSize: heroImageSize || "cover"
      }}
    >
      <div className="landing-overlay" />

      <div className="landing-content">
        <span className="landing-preline">Welcome to the</span>
        <h1 className="landing-headline">
          <span className="landing-headline-camp">{campName}</span>
          <span className="landing-headline-network">{alumniWord}&nbsp;Network</span>
        </h1>
        <p className="landing-subtitle">
          {content.welcomeBody ||
            "Reconnect with bunkmates. Search for people in your industry and reconnect with your camp community."}
        </p>
        <div className="landing-cta">
          {!demoAccessEnabled ? (
            <button
              className="landing-btn landing-btn-primary"
              onPointerEnter={preloadFullAuthRuntime}
              onFocus={preloadFullAuthRuntime}
              onTouchStart={preloadFullAuthRuntime}
              onClick={() => navigate(tenantRoute(slug, "/create-account"))}
            >
              Create Account
            </button>
          ) : null}
          <button
            className="landing-btn landing-btn-secondary"
            onPointerEnter={preloadFullAuthRuntime}
            onFocus={preloadFullAuthRuntime}
            onTouchStart={preloadFullAuthRuntime}
            onClick={() => navigate(tenantRoute(slug, "/login"))}
          >
            Login
          </button>
        </div>
      </div>
    </section>
  );
}

export default Home;
