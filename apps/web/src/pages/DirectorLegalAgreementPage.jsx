import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useTenant } from "../context/TenantContext.jsx";
import { resolveNetworkDisplayName } from "../lib/campLabels.js";
import DirectorLegalContent, { LEGAL_LAST_UPDATED } from "../components/DirectorLegalContent.jsx";
import "./director-legal.css";
import "../styles/productOnboarding.css";

export default function DirectorLegalAgreementPage() {
  const location = useLocation();
  const { tenant } = useTenant();
  const networkName = resolveNetworkDisplayName(tenant);
  const mainRef = useRef(null);

  useEffect(() => {
    if (!location.hash && mainRef.current && typeof mainRef.current.focus === "function") {
      mainRef.current.focus();
    }
    const hashId = String(location.hash || "").replace("#", "").trim();
    if (!hashId) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const target = document.getElementById(hashId);
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [location.hash]);

  return (
    <div className="director-legal-page">
      <a className="director-legal-skip" href="#director-legal-content">
        Skip to legal content
      </a>
      <main id="director-legal-content" className="director-legal-card" tabIndex={-1} ref={mainRef}>
        <header className="director-legal-header">
          <h1>PondBridge Client Terms, Director Agreement, and Privacy Notice</h1>
          <p>
            For <strong>{networkName}</strong> directors launching and operating a PondBridge client network.
          </p>
          <p>
            Last Updated: <strong>{LEGAL_LAST_UPDATED}</strong>
          </p>
        </header>

        <DirectorLegalContent networkName={networkName} />
      </main>
    </div>
  );
}
