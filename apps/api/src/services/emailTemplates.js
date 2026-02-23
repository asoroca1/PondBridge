// ---------------------------------------------------------------------------
// PondBridge branded email templates
// Each function returns { subject, text, html } for use with sendTransactionalEmail.
// HTML is table-based with inline styles for maximum email-client compatibility.
// ---------------------------------------------------------------------------

const BRAND = {
  primary: "#002b5c",
  secondary: "#d3dde8",
  accent: "#1e5cb3",
  bg: "#f5f7fa",
  white: "#ffffff",
  muted: "#6b7280",
  border: "#e5e7eb",
  fontStack:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji'"
};

// ---------------------------------------------------------------------------
// Shared layout helpers
// ---------------------------------------------------------------------------

function escapeHtml(value = "") {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value || "");
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  });
}

function wordmark() {
  return `<span style="font-size:22px;font-weight:700;color:${BRAND.primary};letter-spacing:-0.5px;font-family:${BRAND.fontStack};">PondBridge</span>`;
}

function ctaButton(href, label) {
  const safeHref = escapeHtml(href);
  const safeLabel = escapeHtml(label);
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px auto;">
      <tr>
        <td align="center" style="border-radius:9999px;background-color:${BRAND.accent};">
          <a href="${safeHref}" target="_blank" style="display:inline-block;padding:14px 36px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:9999px;font-family:${BRAND.fontStack};">${safeLabel}</a>
        </td>
      </tr>
    </table>`;
}

function footerHtml(unsubscribeUrl = "") {
  const unsubLine = unsubscribeUrl
    ? `<br/><a href="${escapeHtml(unsubscribeUrl)}" style="color:${BRAND.muted};text-decoration:underline;font-size:12px;">Unsubscribe</a>`
    : `<br/><span style="font-size:11px;color:${BRAND.muted};">To stop receiving these emails, update your notification preferences in your account settings.</span>`;
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:32px;border-top:1px solid ${BRAND.border};padding-top:20px;">
      <tr>
        <td align="center" style="font-size:12px;color:${BRAND.muted};font-family:${BRAND.fontStack};line-height:1.6;">
          Powered by ${wordmark()}${unsubLine}
        </td>
      </tr>
    </table>`;
}

function wrapLayout(bodyInner, unsubscribeUrl = "") {
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <meta http-equiv="X-UA-Compatible" content="IE=edge"/>
  <title>PondBridge</title>
  <!--[if mso]>
  <style>table,td{font-family:Arial,Helvetica,sans-serif !important;}</style>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background-color:${BRAND.bg};font-family:${BRAND.fontStack};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${BRAND.bg};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <!-- Wordmark -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
          <tr><td align="center">${wordmark()}</td></tr>
        </table>
        <!-- Card -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;background-color:${BRAND.white};border-radius:8px;border:1px solid ${BRAND.border};">
          <tr>
            <td style="padding:40px 36px;font-family:${BRAND.fontStack};font-size:15px;line-height:1.6;color:#1f2937;">
              ${bodyInner}
            </td>
          </tr>
        </table>
        <!-- Footer -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;">
          <tr>
            <td>${footerHtml(unsubscribeUrl)}</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// 1. Invite template
// ---------------------------------------------------------------------------

export function inviteTemplate({ tenantName, link, roleToAssign = "user", expiresAt }) {
  const safeTenant = escapeHtml(tenantName);
  const safeRole = escapeHtml(roleToAssign);
  const expiresStr = formatDate(expiresAt);

  const subject = `You are invited to ${tenantName} on PondBridge`;

  const text = [
    `You were invited to join ${tenantName}.`,
    `Assigned role: ${roleToAssign}.`,
    expiresAt ? `This invite expires on ${new Date(expiresAt).toISOString()}.` : "",
    `Create your account: ${link}`
  ].filter(Boolean).join("\n");

  const html = wrapLayout(`
    <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:${BRAND.primary};">You're Invited!</h1>
    <p style="margin:0 0 12px;">You've been invited to join <strong>${safeTenant}</strong> on PondBridge.</p>
    <p style="margin:0 0 12px;">Your assigned role: <strong>${safeRole}</strong></p>
    ${expiresStr ? `<p style="margin:0 0 12px;font-size:13px;color:${BRAND.muted};">This invite expires on ${escapeHtml(expiresStr)}.</p>` : ""}
    ${ctaButton(link, "Create Your Account")}
    <p style="margin:0;font-size:13px;color:${BRAND.muted};">If the button above doesn't work, copy and paste this link into your browser:</p>
    <p style="margin:4px 0 0;font-size:13px;color:${BRAND.accent};word-break:break-all;"><a href="${escapeHtml(link)}" style="color:${BRAND.accent};text-decoration:underline;">${escapeHtml(link)}</a></p>
  `);

  return { subject, text, html };
}

// ---------------------------------------------------------------------------
// 2. Magic link template
// ---------------------------------------------------------------------------

export function magicLinkTemplate({ tenantName, link, expiresAt }) {
  const safeTenant = escapeHtml(tenantName);
  const expiresStr = formatDate(expiresAt);

  const subject = `Your ${tenantName} sign-in link`;

  const text = [
    `Use this one-time sign-in link for ${tenantName}.`,
    expiresAt ? `This link expires on ${new Date(expiresAt).toISOString()}.` : "",
    `Sign in: ${link}`
  ].filter(Boolean).join("\n");

  const html = wrapLayout(`
    <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:${BRAND.primary};">Sign In to ${safeTenant}</h1>
    <p style="margin:0 0 12px;">Click the button below to sign in to your <strong>${safeTenant}</strong> account. This is a one-time link&mdash;no password needed.</p>
    ${expiresStr ? `<p style="margin:0 0 12px;font-size:13px;color:${BRAND.muted};">This link expires on ${escapeHtml(expiresStr)}.</p>` : ""}
    ${ctaButton(link, "Sign In")}
    <p style="margin:0;font-size:13px;color:${BRAND.muted};">If you didn't request this link, you can safely ignore this email.</p>
    <p style="margin:4px 0 0;font-size:13px;color:${BRAND.accent};word-break:break-all;"><a href="${escapeHtml(link)}" style="color:${BRAND.accent};text-decoration:underline;">${escapeHtml(link)}</a></p>
  `);

  return { subject, text, html };
}

// ---------------------------------------------------------------------------
// 3. Welcome template
// ---------------------------------------------------------------------------

export function welcomeTemplate({ tenantName, firstName }) {
  const safeTenant = escapeHtml(tenantName);
  const safeName = escapeHtml(firstName || "there");

  const subject = `Welcome to ${tenantName}!`;

  const text = [
    `Hi ${firstName || "there"},`,
    "",
    `Welcome to ${tenantName} on PondBridge! Your account has been created successfully.`,
    "",
    "Here's what you can do next:",
    "- Complete your profile so other members can find you",
    "- Browse the member directory",
    "- Connect with fellow alumni",
    "",
    "We're glad you're here!"
  ].join("\n");

  const html = wrapLayout(`
    <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:${BRAND.primary};">Welcome, ${safeName}!</h1>
    <p style="margin:0 0 12px;">Your <strong>${safeTenant}</strong> account has been created successfully. We're glad you're here!</p>
    <p style="margin:0 0 8px;font-weight:600;">Here's what you can do next:</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">
      <tr>
        <td style="padding:6px 0;font-family:${BRAND.fontStack};font-size:15px;line-height:1.5;color:#1f2937;">
          &#x2022;&nbsp; Complete your profile so other members can find you
        </td>
      </tr>
      <tr>
        <td style="padding:6px 0;font-family:${BRAND.fontStack};font-size:15px;line-height:1.5;color:#1f2937;">
          &#x2022;&nbsp; Browse the member directory
        </td>
      </tr>
      <tr>
        <td style="padding:6px 0;font-family:${BRAND.fontStack};font-size:15px;line-height:1.5;color:#1f2937;">
          &#x2022;&nbsp; Connect with fellow alumni
        </td>
      </tr>
    </table>
    <p style="margin:0;color:${BRAND.muted};font-size:14px;">If you have any questions, reach out to your camp director.</p>
  `);

  return { subject, text, html };
}

// ---------------------------------------------------------------------------
// 4. Access approved template
// ---------------------------------------------------------------------------

export function accessApprovedTemplate({ tenantName, firstName, loginUrl }) {
  const safeTenant = escapeHtml(tenantName);
  const safeName = escapeHtml(firstName || "there");

  const subject = `You're approved for ${tenantName}`;

  const text = [
    `Hi ${firstName || "there"},`,
    "",
    `Great news! Your request to join ${tenantName} was approved. You can now log in to your network.`,
    "",
    loginUrl ? `Log in here: ${loginUrl}` : ""
  ].filter(Boolean).join("\n");

  const html = wrapLayout(`
    <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:${BRAND.primary};">You're In!</h1>
    <p style="margin:0 0 12px;">Hi ${safeName},</p>
    <p style="margin:0 0 12px;">Great news&mdash;your request to join <strong>${safeTenant}</strong> has been approved!</p>
    <p style="margin:0 0 12px;">You can now log in and start exploring the network.</p>
    ${loginUrl ? ctaButton(loginUrl, "Log In to Your Network") : ""}
    ${loginUrl ? `<p style="margin:0;font-size:13px;color:${BRAND.muted};word-break:break-all;"><a href="${escapeHtml(loginUrl)}" style="color:${BRAND.accent};text-decoration:underline;">${escapeHtml(loginUrl)}</a></p>` : ""}
  `);

  return { subject, text, html };
}

// ---------------------------------------------------------------------------
// 5. Access denied template
// ---------------------------------------------------------------------------

export function accessDeniedTemplate({ tenantName, firstName, reason }) {
  const safeTenant = escapeHtml(tenantName);
  const safeName = escapeHtml(firstName || "there");
  const safeReason = escapeHtml(reason || "");

  const subject = `Update on your ${tenantName} request`;

  const text = [
    `Hi ${firstName || "there"},`,
    "",
    `Your request to join ${tenantName} was not approved.`,
    reason ? `Reason: ${reason}` : "",
    "",
    "You can reach out to the camp director for details."
  ].filter(Boolean).join("\n");

  const html = wrapLayout(`
    <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:${BRAND.primary};">Access Request Update</h1>
    <p style="margin:0 0 12px;">Hi ${safeName},</p>
    <p style="margin:0 0 12px;">Unfortunately, your request to join <strong>${safeTenant}</strong> was not approved at this time.</p>
    ${safeReason ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:16px 0;"><tr><td style="padding:12px 16px;background-color:${BRAND.bg};border-radius:6px;border-left:4px solid ${BRAND.secondary};font-family:${BRAND.fontStack};font-size:14px;color:#374151;"><strong>Reason:</strong> ${safeReason}</td></tr></table>` : ""}
    <p style="margin:0;font-size:14px;color:${BRAND.muted};">If you have questions, please reach out to the camp director for more details.</p>
  `);

  return { subject, text, html };
}

// ---------------------------------------------------------------------------
// 6. Broadcast template (director email wrapper)
// ---------------------------------------------------------------------------

export function broadcastTemplate({ tenantName, subject, bodyHtml, unsubscribeUrl }) {
  const safeTenant = escapeHtml(tenantName);
  const safeSubject = String(subject || "").trim();

  // bodyHtml is already sanitized by the caller (sanitizeHtmlContent in admin.js)
  const safeBodyHtml = String(bodyHtml || "");

  // Plain text: strip HTML tags for a rough text version
  const textBody = safeBodyHtml
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim();

  const text = [
    `Message from ${tenantName}`,
    "",
    textBody,
    "",
    "---",
    `Sent via PondBridge on behalf of ${tenantName}.`,
    unsubscribeUrl ? `Unsubscribe: ${unsubscribeUrl}` : ""
  ].filter(Boolean).join("\n");

  const html = wrapLayout(`
    <p style="margin:0 0 4px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:${BRAND.muted};">Message from ${safeTenant}</p>
    <h1 style="margin:0 0 20px;font-size:22px;font-weight:700;color:${BRAND.primary};">${escapeHtml(safeSubject)}</h1>
    <div style="font-size:15px;line-height:1.6;color:#1f2937;">
      ${safeBodyHtml}
    </div>
  `, unsubscribeUrl);

  return { subject: safeSubject, text, html };
}
