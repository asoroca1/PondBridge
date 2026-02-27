import { useNavigate } from "react-router-dom";
import { normalizeHeroImagePosition, normalizeHeroImageSize } from "@pondbridge/shared";
import { useTenant } from "../../context/TenantContext.jsx";
import { resolveCampName, resolveTenantContent } from "../../lib/campLabels.js";
import Navbar1 from "../components/Navbar1";

function Home() {
  const navigate = useNavigate();
  const { tenant } = useTenant();
  const content = resolveTenantContent(tenant);
  const campName = resolveCampName(tenant);
  const heroBranding = tenant?.config?.branding || tenant?.theme || {};
  const heroImage = String(heroBranding.heroImageUrl || "").trim();
  const heroImagePosition = normalizeHeroImagePosition(heroBranding.heroImagePosition || "");
  const heroImageSize = normalizeHeroImageSize(heroBranding.heroImageSize || "");

  return (
    <div className="home1">
      <Navbar1 />

      <section
        className="home1-hero"
        style={{
          ...(heroImage ? { backgroundImage: `url(${heroImage})` } : {}),
          backgroundPosition: heroImagePosition,
          backgroundSize: heroImageSize
        }}
      >
        <div className="home1-hero-content">
          <h1 className="home1-title">
            <>
              {`Welcome to the ${campName}`}
              <span className="home1-title-line">Alumni Network</span>
            </>
          </h1>

          <p className="home1-sub">
            {content.welcomeBody ||
              "Reconnect with bunkmates. Search for people in your industry and reconnect with your camp community."}
          </p>

          <div className="home1-cta">
            <button className="home1-btn" onClick={() => navigate("/create-account")}>
              Create Account
            </button>
            <button className="home1-btn" onClick={() => navigate("/login")}>
              Login
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

export default Home;
