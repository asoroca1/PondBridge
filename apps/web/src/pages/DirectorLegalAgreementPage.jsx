import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useTenant } from "../context/TenantContext.jsx";
import { resolveNetworkDisplayName } from "../lib/campLabels.js";
import "./director-legal.css";

const LEGAL_LAST_UPDATED = "March 6, 2026";
const LEGAL_CONTACT_EMAIL = "support@pondbridgealumni.com";
const GOVERNING_STATE = "New York";

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

        <nav className="director-legal-toc" aria-label="Director legal sections">
          <a href="#client-terms">Client Terms</a>
          <a href="#director-agreement">Director Agreement</a>
          <a href="#privacy-notice">Privacy Notice</a>
        </nav>

        <section id="client-terms" className="director-legal-section">
          <h2>Client Terms</h2>
          <p>
            These Client Terms govern your camp&apos;s subscription to PondBridge and your use of the platform to run{" "}
            {networkName}. By launching the network, you accept these terms on behalf of your organization.
          </p>

          <h3>1) Service scope</h3>
          <ul>
            <li>PondBridge provides hosted software for alumni directory, communication, and engagement workflows.</li>
            <li>Feature access is based on your active plan tier and enabled modules.</li>
            <li>We may update features to improve performance, security, and reliability.</li>
          </ul>

          <h3>2) Account ownership and authority</h3>
          <ul>
            <li>You represent you are authorized to accept terms for your camp or organization.</li>
            <li>Your camp is responsible for director/admin account management and access controls.</li>
            <li>You must maintain accurate billing and account contact information.</li>
          </ul>

          <h3>3) Billing and payment</h3>
          <ul>
            <li>Fees follow the PondBridge Flagship plan and any applicable onboarding fee.</li>
            <li>Payments are processed by Stripe or another designated payment provider.</li>
            <li>Late or failed payments may limit access or pause launch readiness until resolved.</li>
          </ul>

          <h3>4) Data responsibility</h3>
          <ul>
            <li>Your camp controls its member content, profile records, and uploaded media.</li>
            <li>You are responsible for obtaining required permissions to upload or process member data.</li>
            <li>PondBridge processes data to provide the contracted service and support operations.</li>
          </ul>

          <h3>5) Governing law</h3>
          <p>
            These client terms are governed by the laws of <strong>{GOVERNING_STATE}</strong>, without regard to conflict-of-law
            rules.
          </p>
        </section>

        <section id="director-agreement" className="director-legal-section">
          <h2>Director Agreement</h2>
          <p>As a director/admin launching this network, you agree to:</p>
          <ul>
            <li>Use PondBridge only for lawful camp/community purposes.</li>
            <li>Protect member privacy and avoid unauthorized sharing of private data.</li>
            <li>Configure access, invites, and communications responsibly.</li>
            <li>Respond to reported abuse, impersonation, or harmful content promptly.</li>
            <li>Maintain security hygiene for director and admin accounts.</li>
          </ul>
          <p>
            PondBridge may suspend access for material violations that create legal, security, or safety risk.
          </p>
        </section>

        <section id="privacy-notice" className="director-legal-section">
          <h2>Privacy Notice (Client/Director)</h2>
          <h3>1) What we process</h3>
          <ul>
            <li>Director/admin account details and authentication metadata.</li>
            <li>Member profile data, invitations, and communications configured by your network.</li>
            <li>Operational logs needed for security, support, and reliability.</li>
          </ul>

          <h3>2) Why we process it</h3>
          <ul>
            <li>Provide platform functionality and maintain service integrity.</li>
            <li>Deliver account, security, and billing-related communications.</li>
            <li>Investigate support issues and enforce platform safety controls.</li>
          </ul>

          <h3>3) Contact and rights</h3>
          <p>
            For client privacy, legal, or data-use questions, contact{" "}
            <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>.
          </p>
        </section>
      </main>
    </div>
  );
}
