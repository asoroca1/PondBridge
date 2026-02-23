import { useMemo } from "react";
import { useTenant } from "../context/TenantContext.jsx";
import {
  resolveCampName,
  resolveNetworkDisplayName,
  resolveTenantContent
} from "../lib/campLabels.js";

function normalizeLinks(links = []) {
  if (!Array.isArray(links)) return [];
  return links
    .map((link) => ({
      label: String(link?.label || "").trim(),
      url: String(link?.url || "").trim()
    }))
    .filter((link) => link.label && link.url)
    .slice(0, 6);
}

export default function Footer() {
  const { tenant } = useTenant();
  const content = resolveTenantContent(tenant);
  const campName = resolveCampName(tenant);
  const networkName = resolveNetworkDisplayName(tenant);
  const aboutText =
    content.aboutText ||
    `A private network for the ${campName} community, built with the PondBridge product shell.`;
  const contactEmail = content.contactEmail || "support@pondbridge.co";

  const footerLinks = useMemo(
    () => normalizeLinks(content.footerLinks || []),
    [content.footerLinks]
  );

  return (
    <footer className="camp-footer">
      <div className="camp-footer-inner">
        <div className="camp-footer-col">
          <h3>{networkName}</h3>
          <p>{aboutText}</p>
        </div>
        <div className="camp-footer-col">
          <h4>Contact</h4>
          <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
        </div>
        <div className="camp-footer-col">
          <h4>Links</h4>
          {footerLinks.length === 0 ? <p>More links coming soon.</p> : null}
          {footerLinks.map((link) => (
            <a key={`${link.label}:${link.url}`} href={link.url} target="_blank" rel="noreferrer">
              {link.label}
            </a>
          ))}
        </div>
      </div>
    </footer>
  );
}
