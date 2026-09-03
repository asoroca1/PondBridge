export const LEGAL_LAST_UPDATED = "September 3, 2026";
export const LEGAL_CONTACT_EMAIL = "support@pondbridgealumni.com";
export const GOVERNING_STATE = "New York";

/**
 * The full client-facing legal text a director accepts at launch. Rendered
 * inline both on the standalone /director-legal page and inside the launch
 * review modal, so the two can never drift apart.
 */
const SECTIONS = [
  ["client-terms", "Client Terms"],
  ["director-agreement", "Director Agreement"],
  ["privacy-notice", "Privacy Notice"]
];

export default function DirectorLegalContent({ networkName = "your network", linkMode = "hash" }) {
  // The modal scrolls its own container, so hash links there would jump the
  // page behind it instead of the dialog.
  const scrollToSection = (id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <>
      <nav className="director-legal-toc" aria-label="Director legal sections">
        {SECTIONS.map(([id, label]) =>
          linkMode === "scroll" ? (
            <button key={id} type="button" onClick={() => scrollToSection(id)}>
              {label}
            </button>
          ) : (
            <a key={id} href={`#${id}`}>
              {label}
            </a>
          )
        )}
      </nav>

      <section id="client-terms" className="director-legal-section">
        <h2>Client Terms</h2>
        <p>
          These Client Terms are an agreement between PondBridge and the camp or organization you represent
          (&quot;your camp&quot;). They govern your camp&apos;s subscription to PondBridge and its use of the platform to run{" "}
          {networkName}. By launching the network, you accept these terms on behalf of your organization.
        </p>

        <h3>1) Service scope</h3>
        <ul>
          <li>PondBridge provides hosted software for alumni directory, communication, and engagement workflows.</li>
          <li>Feature access is based on your active plan tier and enabled modules.</li>
          <li>We may update features to improve performance, security, and reliability.</li>
          <li>
            We aim for continuous availability but do not guarantee uninterrupted service. Planned maintenance is
            scheduled outside peak hours where practical.
          </li>
        </ul>

        <h3>2) Account ownership and authority</h3>
        <ul>
          <li>You represent you are authorized to accept these terms for your camp or organization.</li>
          <li>Your camp is responsible for director/admin account management and access controls.</li>
          <li>You must maintain accurate billing and account contact information.</li>
          <li>Your camp is responsible for activity that occurs under its director and admin accounts.</li>
        </ul>

        <h3>3) Billing, term, and renewal</h3>
        <ul>
          <li>Subscriptions are sold as an annual term that begins when your network launches.</li>
          <li>Fees follow the plan shown at checkout, plus any one-time onboarding fee for that plan.</li>
          <li>Payments are processed by Stripe. PondBridge does not receive or store full card numbers.</li>
          <li>
            Terms renew automatically for successive one-year periods at the then-current rate unless either party
            gives notice of non-renewal at least 30 days before the term ends.
          </li>
          <li>
            Fees are non-refundable except where required by law, and onboarding fees are non-refundable once setup
            work has begun.
          </li>
          <li>Late or failed payments may limit access or pause launch readiness until resolved.</li>
          <li>Fees are exclusive of taxes; your camp is responsible for any applicable sales or use tax.</li>
        </ul>

        <h3>4) Data responsibility and ownership</h3>
        <ul>
          <li>Your camp controls and owns its member content, profile records, and uploaded media.</li>
          <li>You are responsible for obtaining required permissions to upload or process member data.</li>
          <li>PondBridge processes that data as your camp&apos;s service provider, to deliver and support the service.</li>
          <li>
            We do not sell member data and do not use it to train third-party advertising or general-purpose AI
            models.
          </li>
          <li>
            PondBridge owns the platform, its software, and any aggregated or de-identified statistics derived from
            usage that do not identify your camp or its members.
          </li>
          <li>
            You may export your camp&apos;s data at any time during the term. After termination we retain it for 30
            days for export, then delete or de-identify it on our normal schedule.
          </li>
        </ul>

        <h3>5) Members who are minors</h3>
        <ul>
          <li>
            PondBridge is built for alumni networks and is not intended for members under 13. Your camp must not
            create accounts for or upload directory records about children under 13.
          </li>
          <li>
            Where your camp invites members aged 13 to 17, you are responsible for any parental notice or consent
            your jurisdiction requires.
          </li>
        </ul>

        <h3>6) Security and incident notice</h3>
        <ul>
          <li>
            We maintain administrative, technical, and physical safeguards appropriate to the data we process,
            including encryption in transit and access controls on production systems.
          </li>
          <li>
            We use vetted subprocessors for hosting, authentication, email delivery, and payments, and remain
            responsible for their handling of your data.
          </li>
          <li>
            If we confirm a breach affecting your camp&apos;s data, we will notify your listed account contacts
            without undue delay and share what we know about scope and remediation.
          </li>
        </ul>

        <h3>7) Suspension and termination</h3>
        <ul>
          <li>
            Either party may terminate for material breach if the breach is not cured within 30 days of written
            notice.
          </li>
          <li>
            We may suspend access immediately where continued use creates a legal, security, or safety risk, and
            will restore it once the risk is resolved.
          </li>
          <li>Termination does not relieve your camp of fees already accrued for the current term.</li>
        </ul>

        <h3>8) Warranties and liability</h3>
        <ul>
          <li>
            The platform is provided &quot;as is&quot; except as expressly stated here. We disclaim implied warranties of
            merchantability, fitness for a particular purpose, and non-infringement to the extent the law allows.
          </li>
          <li>
            Neither party is liable for indirect, incidental, or consequential damages, or for lost profits or lost
            data, arising from these terms.
          </li>
          <li>
            Each party&apos;s total liability under these terms is capped at the fees your camp paid PondBridge in the
            12 months before the claim. Nothing here limits liability for fraud, willful misconduct, or amounts owed
            for the service.
          </li>
        </ul>

        <h3>9) Confidentiality</h3>
        <ul>
          <li>
            Each party will protect the other&apos;s non-public business information with at least reasonable care and
            use it only to perform under these terms.
          </li>
          <li>
            This does not cover information that is public, independently developed, or lawfully received from a
            third party, and does not prevent disclosure required by law.
          </li>
        </ul>

        <h3>10) Changes to these terms</h3>
        <p>
          We may update these terms. For material changes we will give notice to your account contacts at least 30
          days before they take effect, and continued use after that date means your camp accepts the update.
        </p>

        <h3>11) Governing law</h3>
        <p>
          These client terms are governed by the laws of <strong>{GOVERNING_STATE}</strong>, without regard to
          conflict-of-law rules, and the parties consent to the exclusive jurisdiction of the state and federal
          courts located there.
        </p>
      </section>

      <section id="director-agreement" className="director-legal-section">
        <h2>Director Agreement</h2>
        <p>As a director/admin launching this network, you agree to:</p>
        <ul>
          <li>Use PondBridge only for lawful camp/community purposes.</li>
          <li>Protect member privacy and avoid unauthorized sharing of private data.</li>
          <li>Configure access, invites, and communications responsibly.</li>
          <li>
            Send member email and messaging only to people with a genuine connection to your camp, honor unsubscribe
            requests, and follow applicable anti-spam law.
          </li>
          <li>Respond to reported abuse, impersonation, or harmful content promptly.</li>
          <li>
            Keep admin access limited to people who need it, and remove access when a director or staff member
            leaves.
          </li>
          <li>Maintain security hygiene for director and admin accounts, including strong, unique credentials.</li>
          <li>
            Not attempt to probe, scrape, reverse engineer, resell, or overload the platform, and not upload malware
            or content you lack the rights to use.
          </li>
        </ul>
        <p>
          PondBridge may suspend access for material violations that create legal, security, or safety risk. Where
          the situation allows, we will contact you before suspending.
        </p>
      </section>

      <section id="privacy-notice" className="director-legal-section">
        <h2>Privacy Notice (Client/Director)</h2>
        <h3>1) What we process</h3>
        <ul>
          <li>Director/admin account details and authentication metadata.</li>
          <li>Member profile data, invitations, and communications configured by your network.</li>
          <li>Operational logs needed for security, support, and reliability.</li>
          <li>Billing contact and subscription records (card details stay with our payment processor).</li>
        </ul>

        <h3>2) Why we process it</h3>
        <ul>
          <li>Provide platform functionality and maintain service integrity.</li>
          <li>Deliver account, security, and billing-related communications.</li>
          <li>Investigate support issues and enforce platform safety controls.</li>
        </ul>

        <h3>3) Who we share it with</h3>
        <ul>
          <li>
            Subprocessors that host, authenticate, email, and bill on our behalf, under contracts that limit their
            use of the data to serving you.
          </li>
          <li>Authorities where the law requires it, or to protect the rights and safety of members.</li>
          <li>
            A successor in a merger or acquisition, subject to this notice. We do not sell or rent personal
            information.
          </li>
        </ul>

        <h3>4) How long we keep it</h3>
        <ul>
          <li>Member and network content: for the life of your subscription, then 30 days after termination.</li>
          <li>Operational and security logs: on a rolling retention schedule, typically no more than 12 months.</li>
          <li>Billing records: as long as tax and accounting law requires.</li>
        </ul>

        <h3>5) Contact and rights</h3>
        <p>
          Members should direct requests to access, correct, or delete their data to your camp, and your camp can
          action them in the platform or ask us for help. For client privacy, legal, or data-use questions, contact{" "}
          <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>.
        </p>
      </section>
    </>
  );
}
