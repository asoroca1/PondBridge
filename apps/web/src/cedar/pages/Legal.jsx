// src/pages/Legal.jsx
import React, { useEffect } from "react";
import { useLocation } from "react-router-dom";
import Navbar2 from "../components/Navbar2";
import CedarBackground from "../components/CedarBackground";
import "./legal.css";

export default function Legal() {
  const location = useLocation();

  // Scroll to hash anchors like /legal#privacy or /legal#terms
  useEffect(() => {
    const hash = location.hash?.replace("#", "");
    if (!hash) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const el = document.getElementById(hash);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [location.hash]);

  return (
    <div className="legal-page nav2-page-shell">
      <CedarBackground />
      <Navbar2 />

      <div className="legal-wrap">
        <div className="legal-card">
          <div className="legal-header">
            <h1>Terms & Privacy</h1>
            <p className="legal-sub">
              Your Camp Alumni Network — Last Updated: <strong>January 5, 2026</strong>
            </p>
          </div>

          <div className="legal-toc">
            <a href="#privacy" className="legal-chip">Privacy Policy</a>
            <a href="#terms" className="legal-chip">Terms of Service</a>
          </div>

          {/* ===================== Privacy ===================== */}
          <section id="privacy" className="legal-section">
            <h2>Privacy Policy (Your Camp Alumni Network)</h2>
            <p className="legal-muted">
              This Privacy Policy explains how Your Camp Alumni Network (“we,” “us,” or “our”) collects,
              uses, and shares information when you use our website and related services (the “Service”).
            </p>
            <p>
              If you have questions or requests about privacy, contact us at{" "}
              <a href="mailto:support@pondbridge.co">support@pondbridge.co</a>.
            </p>

            <h3>1) Information We Collect</h3>

            <h4>A. Information You Provide</h4>
            <p>When you create an account or use the Service, you may provide:</p>
            <ul>
              <li><strong>Account information:</strong> name, email, password (stored in encrypted/hashed form)</li>
              <li>
                <strong>Profile information:</strong> phone number, city/state, camp role (camper/counselor/etc.),
                high school, colleges, graduation years, jobs, industry, social links, and other details you add
              </li>
              <li><strong>User content:</strong> photos you upload, posts/comments, messages, and other content you submit</li>
              <li><strong>Communications:</strong> messages to support, feedback, and other communications</li>
            </ul>

            <h4>B. Information Collected Automatically</h4>
            <p>We may automatically collect:</p>
            <ul>
              <li>
                <strong>Device and usage data:</strong> IP address, browser type, device identifiers, pages viewed,
                timestamps, referring URLs
              </li>
              <li><strong>Logs and diagnostics</strong> used for security and troubleshooting</li>
            </ul>

            <h4>C. Cookies and Similar Technologies</h4>
            <p>We may use cookies and similar technologies to:</p>
            <ul>
              <li>keep you logged in</li>
              <li>remember preferences</li>
              <li>understand usage and improve the Service</li>
            </ul>
            <p className="legal-muted">
              You can control cookies through your browser settings. Some features may not work properly without cookies.
            </p>

            <h3>2) How We Use Information</h3>
            <p>We use information to:</p>
            <ul>
              <li>provide, maintain, and improve the Service</li>
              <li>create and manage accounts and profiles</li>
              <li>enable community features (search, profile viewing, messaging, forums)</li>
              <li>process uploads and display content you choose to share</li>
              <li>send service-related messages (e.g., account verification, password resets, security alerts)</li>
              <li>send announcements or newsletters (where applicable and permitted)</li>
              <li>monitor, prevent, and address fraud, abuse, and security issues</li>
              <li>comply with legal obligations</li>
            </ul>

            <h3>3) How We Share Information</h3>

            <h4>A. With Other Users (Community Visibility)</h4>
            <p>
              The Service is an alumni network, and your profile information and content may be visible to other users of
              the Service. For example:
            </p>
            <ul>
              <li>your name, camp role, and profile details you provide</li>
              <li>photos/posts you upload or share</li>
              <li>messages you send to other users (visible to recipients)</li>
            </ul>
            <p className="legal-callout">
              <strong>Important:</strong> Please do not share information you do not want other members to see.
            </p>

            <h4>B. With Service Providers</h4>
            <p>
              We may share information with vendors who help operate the Service (for example: hosting, databases, storage,
              email delivery, analytics). These providers are authorized to use your information only as necessary to
              provide services to us.
            </p>

            <h4>C. For Legal, Safety, and Security Reasons</h4>
            <p>We may disclose information if we believe it is necessary to:</p>
            <ul>
              <li>comply with law, regulation, or legal process</li>
              <li>enforce our Terms of Service</li>
              <li>protect the rights, safety, and security of the Service, our users, or others</li>
              <li>prevent fraud or abuse</li>
            </ul>

            <h4>D. Business Transfers</h4>
            <p>
              If we’re involved in a merger, acquisition, financing, or sale of assets, your information may be transferred
              as part of that transaction.
            </p>

            <h3>4) Your Choices and Rights</h3>

            <h4>A. Edit Your Information</h4>
            <p>You can update many profile details through your account/profile settings.</p>

            <h4>B. Delete Your Account</h4>
            <p>
              You may request account deletion by contacting{" "}
              <a href="mailto:support@pondbridge.co">support@pondbridge.co</a>. We’ll take reasonable steps to
              delete your account and associated profile information, subject to legal and security requirements.
            </p>

            <h4>C. Email Preferences</h4>
            <p>
              You can opt out of non-essential emails by using an unsubscribe link (if provided) or by contacting us.
              <br />
              <span className="legal-muted">
                Note: We may still send essential service emails (password resets, security alerts, account notices).
              </span>
            </p>

            <h3>5) Data Retention</h3>
            <p>
              We retain information for as long as needed to provide the Service and for legitimate business purposes
              (such as security, dispute resolution, and enforcement), unless a longer retention period is required by law.
            </p>

            <h3>6) Security</h3>
            <p>
              We use reasonable safeguards designed to protect information. However, no system is 100% secure, and we cannot
              guarantee absolute security.
            </p>

            <h3>7) Children’s Privacy</h3>
            <p>
              The Service is intended for users <strong>14 years of age or older</strong>. We do not knowingly collect personal
              information from anyone under 14. If you believe someone under 14 has provided personal information, contact{" "}
              <a href="mailto:support@pondbridge.co">support@pondbridge.co</a> and we will take steps to delete it.
            </p>

            <h3>8) International Users</h3>
            <p>
              If you access the Service from outside the United States, your information may be transferred to and processed
              in the United States or other jurisdictions where our service providers operate.
            </p>

            <h3>9) Third-Party Links</h3>
            <p>
              The Service may contain links to third-party sites (for example, social profiles). We are not responsible for
              the privacy practices of third parties.
            </p>

            <h3>10) Changes to This Policy</h3>
            <p>
              We may update this Privacy Policy from time to time. We’ll update the “Last Updated” date and may provide
              additional notice where appropriate.
            </p>

            <h3>11) Contact Us</h3>
            <p>
              For privacy questions or requests, contact:{" "}
              <a href="mailto:support@pondbridge.co">support@pondbridge.co</a>
            </p>
          </section>

          {/* ===================== Terms ===================== */}
          <section id="terms" className="legal-section">
            <h2>Terms of Service (Your Camp Alumni Network)</h2>
            <p className="legal-muted">
              These Terms of Service (“Terms”) govern your access to and use of the camp alumni network website and
              related services (the “Service”). By using the Service, you agree to these Terms. If you do not agree, do not
              use the Service.
            </p>

            <h3>1) Eligibility</h3>
            <p>
              You must be at least <strong>14 years old</strong> to use the Service. By using the Service, you represent that
              you meet this requirement.
            </p>

            <h3>2) Accounts and Security</h3>
            <ul>
              <li>You are responsible for maintaining the confidentiality of your login credentials.</li>
              <li>You are responsible for all activity that occurs under your account.</li>
              <li>You agree to provide accurate information and keep it updated.</li>
              <li>We may suspend or terminate accounts for violations of these Terms or for security reasons.</li>
            </ul>

            <h3>3) Community Nature of the Service</h3>
            <p>The Service is designed to help your camp alumni connect. You understand that:</p>
            <ul>
              <li>other users may be able to view your profile information and content you share</li>
              <li>you should not post information you do not want other members to see</li>
            </ul>

            <h3>4) User Content</h3>

            <h4>A. Your Content</h4>
            <p>
              “User Content” includes anything you submit to the Service (profile info, photos, posts, messages, comments,
              etc.). You retain ownership of your User Content.
            </p>

            <h4>B. License You Grant Us</h4>
            <p>
              By submitting User Content, you grant Your Camp Alumni Network a worldwide, non-exclusive, royalty-free,
              transferable, sublicensable license to host, store, reproduce, display, perform, and distribute your User
              Content solely for the purpose of operating, providing, and improving the Service.
            </p>

            <h4>C. Your Responsibilities</h4>
            <p>You represent and warrant that:</p>
            <ul>
              <li>you have the rights to submit your User Content</li>
              <li>
                your User Content does not violate any law or any third-party rights (including privacy, publicity, or
                copyright)
              </li>
            </ul>

            <h3>5) Prohibited Conduct</h3>
            <p>You agree not to:</p>
            <ul>
              <li>harass, bully, threaten, or abuse others</li>
              <li>impersonate any person or misrepresent affiliation</li>
              <li>post unlawful, defamatory, hateful, or sexually explicit content</li>
              <li>upload malware or attempt to disrupt the Service</li>
              <li>scrape, harvest, or collect data from the Service without permission</li>
              <li>use the Service for spam or unsolicited promotions</li>
              <li>attempt to access accounts or data you do not have permission to access</li>
              <li>share someone else’s personal information without permission (“doxxing”)</li>
            </ul>
            <p className="legal-muted">We may remove content and/or suspend accounts for violations.</p>

            <h3>6) Moderation and Enforcement</h3>
            <p>
              We may (but are not obligated to) review, remove, or restrict access to User Content and may take action we
              deem appropriate (including suspending or terminating accounts) to enforce these Terms and maintain community
              safety.
            </p>

            <h3>7) Intellectual Property</h3>
            <p>
              The Service (including its design, branding, and software) is owned by us or our licensors and is protected by
              intellectual property laws. You may not copy, modify, or distribute our content or code except as allowed by
              law or with our written permission.
            </p>

            <h3>8) Copyright Complaints</h3>
            <p>If you believe content on the Service infringes your copyright, email <a href="mailto:support@pondbridge.co">support@pondbridge.co</a> with:</p>
            <ul>
              <li>identification of the copyrighted work you believe was infringed</li>
              <li>identification of the material you believe is infringing and where it appears on the Service</li>
              <li>your contact information</li>
              <li>a statement that you have a good-faith belief the use is not authorized</li>
              <li>a statement, under penalty of perjury, that the information is accurate</li>
              <li>your physical or electronic signature</li>
            </ul>

            <h3>9) Third-Party Services</h3>
            <p>
              The Service may link to or integrate with third-party services. We are not responsible for third-party
              services, content, or practices.
            </p>

            <h3>10) Disclaimers</h3>
            <p className="legal-allcaps">
              THE SERVICE IS PROVIDED “AS IS” AND “AS AVAILABLE.” TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE DISCLAIM ALL
              WARRANTIES, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND
              NON-INFRINGEMENT.
            </p>
            <p>We do not guarantee the Service will be uninterrupted, secure, or error-free.</p>

            <h3>11) Limitation of Liability</h3>
            <p className="legal-allcaps">
              TO THE MAXIMUM EXTENT PERMITTED BY LAW: WE WILL NOT BE LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL,
              CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS, DATA, OR GOODWILL. OUR TOTAL LIABILITY FOR ANY
              CLAIM RELATED TO THE SERVICE WILL NOT EXCEED $100 OR THE AMOUNT YOU PAID US (IF ANY) IN THE LAST 12 MONTHS,
              WHICHEVER IS GREATER.
            </p>
            <p className="legal-muted">
              (Some jurisdictions do not allow certain limitations, so some of the above may not apply to you.)
            </p>

            <h3>12) Indemnification</h3>
            <p>
              You agree to defend, indemnify, and hold us harmless from any claims, liabilities, damages, losses, and
              expenses (including reasonable attorneys’ fees) arising out of your use of the Service, your User Content, or
              your violation of these Terms.
            </p>

            <h3>13) Termination</h3>
            <p>
              You may stop using the Service at any time. We may suspend or terminate your access at any time if we believe
              you violated these Terms, created risk, or used the Service unlawfully. Sections that by their nature should
              survive termination (including content license, disclaimers, limitation of liability, and indemnification)
              will survive.
            </p>

            <h3>14) Changes to the Service or Terms</h3>
            <p>
              We may modify the Service or these Terms from time to time. The “Last Updated” date will reflect changes.
              Continued use after changes means you agree to the updated Terms.
            </p>

            <h3>15) Governing Law and Venue</h3>
            <p>
              These Terms are governed by the laws of the <strong>Commonwealth of Massachusetts</strong>, without regard to
              conflict of law principles. Any dispute arising out of or relating to these Terms or the Service will be
              brought in the state or federal courts located in Massachusetts, and you consent to personal jurisdiction and
              venue there.
            </p>

            <h3>16) Contact</h3>
            <p>
              Questions about these Terms:{" "}
              <a href="mailto:support@pondbridge.co">support@pondbridge.co</a>
            </p>
          </section>

          <div className="legal-footer">
            <a href="#privacy">Back to Privacy</a>
            <span>•</span>
            <a href="#terms">Back to Terms</a>
            <span>•</span>
            <a href="#top" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
              Back to Top
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
