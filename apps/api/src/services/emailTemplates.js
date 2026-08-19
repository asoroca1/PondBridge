// ---------------------------------------------------------------------------
// PondBridge branded email templates
// Each function returns { subject, text, html } for use with sendTransactionalEmail.
// HTML is table-based with inline styles for maximum email-client compatibility.
// ---------------------------------------------------------------------------

import { buildEmailPalette } from "./brandPalette.js";

// Fallbacks only, used when a camp has not set a brand. They must stay hueless
// so an un-branded camp's mail is grey rather than somebody else's navy.
const BRAND = {
  primary: "#404040",
  secondary: "#e6e6e6",
  accent: "#404040",
  bg: "#f5f5f5",
  white: "#ffffff",
  muted: "#737373",
  border: "#e0e0e0",
  fontStack:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji'"
};
const HEX_COLOR_REGEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

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

function normalizeHttpUrl(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return url.toString();
  } catch {
    return "";
  }
}

function normalizeBrandColor(value = "", fallback = BRAND.primary) {
  const candidate = String(value || "").trim();
  if (HEX_COLOR_REGEX.test(candidate)) return candidate;
  return fallback;
}

function initialsFromName(value = "", fallback = "PB") {
  const parts = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return fallback;
  const letters = parts.slice(0, 2).map((part) => String(part[0] || "").toUpperCase()).join("");
  return letters || fallback;
}

function wordmark(value = "PondBridge") {
  return `<span style="font-size:22px;font-weight:700;color:${BRAND.primary};letter-spacing:-0.5px;font-family:${BRAND.fontStack};">${escapeHtml(value)}</span>`;
}

function ctaButton(href, label, { backgroundColor = BRAND.accent } = {}) {
  const safeHref = escapeHtml(href);
  const safeLabel = escapeHtml(label);
  const safeColor = escapeHtml(normalizeBrandColor(backgroundColor, BRAND.accent));
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px auto;">
      <tr>
        <td align="center" style="border-radius:9999px;background-color:${safeColor};">
          <a href="${safeHref}" target="_blank" style="display:inline-block;padding:14px 36px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:9999px;font-family:${BRAND.fontStack};">${safeLabel}</a>
        </td>
      </tr>
    </table>`;
}

function formatPlainTextParagraphs(value = "") {
  const normalized = String(value || "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) return "";
  return normalized
    .split(/\n{2,}/)
    .filter(Boolean)
    .map(
      (paragraph) =>
        `<p style="margin:0 0 12px;">${escapeHtml(paragraph).replace(/\n/g, "<br/>")}</p>`
    )
    .join("");
}

function footerHtml({ unsubscribeUrl = "", contextName = "" } = {}) {
  const context = String(contextName || "").trim();
  const poweredByLine = context
    ? `Sent for ${escapeHtml(context)} via ${wordmark("PondBridge")}`
    : `Powered by ${wordmark("PondBridge")}`;
  const unsubLine = unsubscribeUrl
    ? `<br/><a href="${escapeHtml(unsubscribeUrl)}" style="color:${BRAND.muted};text-decoration:underline;font-size:12px;">Unsubscribe</a>`
    : `<br/><span style="font-size:11px;color:${BRAND.muted};">To stop receiving these emails, update your notification preferences in your account settings.</span>`;
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:32px;border-top:1px solid ${BRAND.border};padding-top:20px;">
      <tr>
        <td align="center" style="font-size:12px;color:${BRAND.muted};font-family:${BRAND.fontStack};line-height:1.6;">
          ${poweredByLine}${unsubLine}
        </td>
      </tr>
    </table>`;
}

function wrapLayout(bodyInner, options = {}) {
  const opts = typeof options === "string" ? { unsubscribeUrl: options } : options || {};
  const contextName = String(opts.contextName || "").trim();
  const titleLabel = contextName || "PondBridge";
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <meta http-equiv="X-UA-Compatible" content="IE=edge"/>
  <title>${escapeHtml(titleLabel)}</title>
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
          <tr><td align="center">${wordmark(contextName || "PondBridge")}</td></tr>
        </table>
        <!-- Card -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;background-color:${BRAND.white};border-radius:8px;border:1px solid ${BRAND.border};">
          <tr>
            <td style="padding:40px 36px;font-family:${BRAND.fontStack};font-size:15px;line-height:1.6;color:${palette.text};">
              ${bodyInner}
            </td>
          </tr>
        </table>
        <!-- Footer -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;">
          <tr>
            <td>${footerHtml({ unsubscribeUrl: opts.unsubscribeUrl || "", contextName })}</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function wrapInviteLayout(bodyInner, options = {}) {
  const opts = typeof options === "string" ? { contextName: options } : options || {};
  const contextName = String(opts.contextName || "").trim();
  const displayName = contextName || "PondBridge";
  const titleLabel = displayName;
  const brandPrimary = normalizeBrandColor(opts.brandPrimary || BRAND.primary, BRAND.primary);
  // Chrome follows the camp's colour; email cannot use CSS variables.
  const palette = buildEmailPalette(brandPrimary);
  const logoUrl = normalizeHttpUrl(opts.logoUrl || "");
  const tagline = escapeHtml(opts.tagline || "Member invitation");
  const initials = escapeHtml(initialsFromName(displayName, "PB"));
  const headerLogoMarkup = logoUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:42px;height:42px;border-radius:10px;overflow:hidden;border:1px solid rgba(255,255,255,0.32);background:rgba(255,255,255,0.14);"><tr><td align="center" valign="middle" style="width:42px;height:42px;line-height:0;"><img src="${escapeHtml(logoUrl)}" alt="" style="display:block;max-width:38px;max-height:38px;width:auto;height:auto;border:0;outline:none;text-decoration:none;" /></td></tr></table>`
    : `<div style="width:42px;height:42px;border-radius:10px;background:rgba(255,255,255,0.18);color:#ffffff;font-size:13px;font-weight:700;line-height:42px;text-align:center;font-family:${BRAND.fontStack};">${initials}</div>`;

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <meta http-equiv="X-UA-Compatible" content="IE=edge"/>
  <title>${escapeHtml(titleLabel)}</title>
  <!--[if mso]>
  <style>table,td{font-family:Arial,Helvetica,sans-serif !important;}</style>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background-color:${palette.page};font-family:${BRAND.fontStack};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${palette.page};">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="680" style="max-width:680px;width:100%;background-color:${palette.surface};border-radius:18px;border:1px solid ${palette.border};overflow:hidden;">
          <tr>
            <td style="padding:18px 20px;background-color:${escapeHtml(brandPrimary)};color:${palette.onPrimary};">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="width:52px;vertical-align:middle;">${headerLogoMarkup}</td>
                  <td style="vertical-align:middle;font-family:${BRAND.fontStack};">
                    <div style="font-size:17px;font-weight:700;line-height:1.3;">${escapeHtml(displayName)}</div>
                    <div style="font-size:13px;line-height:1.4;opacity:0.95;">${tagline}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 24px 24px;font-family:${BRAND.fontStack};font-size:15px;line-height:1.65;color:${palette.text};">
              ${bodyInner}
            </td>
          </tr>
        </table>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="680" style="max-width:680px;width:100%;">
          <tr>
            <td>${footerHtml({ unsubscribeUrl: opts.unsubscribeUrl || "", contextName: displayName })}</td>
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

export function inviteTemplate({
  tenantName,
  link,
  customSubject = "",
  customMessage = "",
  firstName = "",
  lastName = "",
  brandPrimary = BRAND.primary,
  logoUrl = ""
}) {
  const P = buildEmailPalette(brandPrimary);
  const safeTenant = escapeHtml(tenantName);
  const recipientName = [String(firstName || "").trim(), String(lastName || "").trim()]
    .filter(Boolean)
    .join(" ");
  const safeRecipientName = escapeHtml(recipientName || "there");
  const normalizedCustomSubject = String(customSubject || "").trim();
  const normalizedCustomMessage = String(customMessage || "").trim();
  const customMessageHtml = normalizedCustomMessage
    ? `
      <div style="margin:0 0 18px;padding:14px 16px;border:1px solid ${P.border};border-radius:12px;background:${P.wash};">
        <div style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#51657d;">Personal note</div>
        ${formatPlainTextParagraphs(normalizedCustomMessage)}
      </div>
    `
    : "";

  const subject = normalizedCustomSubject || `You are invited to ${tenantName}`;

  const textLines = [`Hi ${recipientName || "there"},`, ""];
  if (normalizedCustomMessage) {
    textLines.push("Personal note:", normalizedCustomMessage, "");
  }
  textLines.push(`You were invited to join ${tenantName}.`);
  textLines.push(`Create your account: ${link}`);
  const text = textLines.join("\n");

  const html = wrapInviteLayout(`
    <h1 style="margin:0 0 16px;font-size:36px;font-weight:700;line-height:1.2;color:${P.text};letter-spacing:-0.02em;">You're Invited</h1>
    <p style="margin:0 0 12px;">Hi <strong>${safeRecipientName}</strong>,</p>
    ${customMessageHtml}
    <p style="margin:0 0 12px;">You've been invited to join <strong>${safeTenant}</strong>.</p>
    ${ctaButton(link, "Create Your Account", { backgroundColor: brandPrimary })}
    <p style="margin:0;font-size:13px;color:${BRAND.muted};">If the button above doesn't work, copy and paste this link into your browser:</p>
    <p style="margin:6px 0 0;font-size:13px;color:${BRAND.accent};word-break:break-all;"><a href="${escapeHtml(link)}" style="color:${BRAND.accent};text-decoration:underline;">${escapeHtml(link)}</a></p>
  `, {
    contextName: tenantName,
    brandPrimary,
    logoUrl,
    tagline: "Account invitation"
  });

  return { subject, text, html };
}

// ---------------------------------------------------------------------------
// 2. Magic link template
// ---------------------------------------------------------------------------

export function magicLinkTemplate({
  tenantName,
  link,
  expiresAt,
  brandPrimary = BRAND.primary,
  logoUrl = ""
}) {
  const P = buildEmailPalette(brandPrimary);
  const safeTenant = escapeHtml(tenantName);
  const expiresStr = formatDate(expiresAt);

  const subject = `Your ${tenantName} sign-in link`;

  const text = [
    `Use this one-time sign-in link for ${tenantName}.`,
    expiresStr ? `This link expires on ${expiresStr}.` : "",
    `Sign in: ${link}`
  ].filter(Boolean).join("\n");

  const html = wrapInviteLayout(`
    <h1 style="margin:0 0 16px;font-size:36px;font-weight:700;line-height:1.2;color:${P.text};letter-spacing:-0.02em;">Sign In to ${safeTenant}</h1>
    <p style="margin:0 0 12px;">Click the button below to sign in to your <strong>${safeTenant}</strong> account. This is a one-time link&mdash;no password needed.</p>
    ${expiresStr ? `<p style="margin:0 0 12px;font-size:13px;color:${BRAND.muted};">This link expires on ${escapeHtml(expiresStr)}.</p>` : ""}
    ${ctaButton(link, "Sign In", { backgroundColor: brandPrimary })}
    <p style="margin:0;font-size:13px;color:${BRAND.muted};">If you didn't request this link, you can safely ignore this email.</p>
    <p style="margin:6px 0 0;font-size:13px;color:${BRAND.accent};word-break:break-all;"><a href="${escapeHtml(link)}" style="color:${BRAND.accent};text-decoration:underline;">${escapeHtml(link)}</a></p>
  `, {
    contextName: tenantName,
    brandPrimary,
    logoUrl,
    tagline: "Secure sign-in"
  });

  return { subject, text, html };
}

// ---------------------------------------------------------------------------
// 3. Welcome template
// ---------------------------------------------------------------------------

export function welcomeTemplate({
  tenantName,
  firstName,
  brandPrimary = BRAND.primary,
  logoUrl = ""
}) {
  const P = buildEmailPalette(brandPrimary);
  const safeTenant = escapeHtml(tenantName);
  const safeName = escapeHtml(firstName || "there");

  const subject = `Welcome to ${tenantName}!`;

  const text = [
    `Hi ${firstName || "there"},`,
    "",
    `Welcome to ${tenantName}! Your account has been created successfully.`,
    "",
    "Here's what you can do next:",
    "- Complete your profile so other members can find you",
    "- Browse the member directory",
    "- Connect with fellow members",
    "",
    "We're glad you're here!"
  ].join("\n");

  const html = wrapInviteLayout(`
    <h1 style="margin:0 0 16px;font-size:36px;font-weight:700;line-height:1.2;color:${P.text};letter-spacing:-0.02em;">Welcome, ${safeName}</h1>
    <p style="margin:0 0 12px;">Your <strong>${safeTenant}</strong> account has been created successfully. We're glad you're here!</p>
    <p style="margin:0 0 8px;font-weight:600;">Here's what you can do next:</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">
      <tr>
        <td style="padding:6px 0;font-family:${BRAND.fontStack};font-size:15px;line-height:1.5;color:${palette.text};">
          &#x2022;&nbsp; Complete your profile so other members can find you
        </td>
      </tr>
      <tr>
        <td style="padding:6px 0;font-family:${BRAND.fontStack};font-size:15px;line-height:1.5;color:${palette.text};">
          &#x2022;&nbsp; Browse the member directory
        </td>
      </tr>
      <tr>
        <td style="padding:6px 0;font-family:${BRAND.fontStack};font-size:15px;line-height:1.5;color:${palette.text};">
          &#x2022;&nbsp; Connect with fellow members
        </td>
      </tr>
    </table>
    <p style="margin:0;color:${BRAND.muted};font-size:14px;">If you have any questions, reach out to your camp director.</p>
  `, {
    contextName: tenantName,
    brandPrimary,
    logoUrl,
    tagline: "Welcome to your network"
  });

  return { subject, text, html };
}

// ---------------------------------------------------------------------------
// 4. Verification code template
// ---------------------------------------------------------------------------

export function passwordChangedTemplate({
  brandName = "PondBridge",
  firstName = "",
  accountEmail = "",
  brandPrimary = BRAND.primary,
  logoUrl = ""
}) {
  const P = buildEmailPalette(brandPrimary);
  const safeBrandName = escapeHtml(brandName || "PondBridge");
  const safeAccountEmail = escapeHtml(String(accountEmail || "").trim());
  const greetingName = String(firstName || "").trim();
  const safeGreeting = greetingName ? `Hi ${escapeHtml(greetingName)},` : "Hi,";
  const subject = `Your ${brandName || "PondBridge"} password has been changed`;

  const text = [
    brandName || "PondBridge",
    "",
    "Password changed",
    greetingName ? `Hi ${greetingName},` : "Hi,",
    accountEmail
      ? `The password for ${accountEmail} has been changed.`
      : "The password on your account has been changed.",
    "",
    "If you did not make this change, contact your camp administrator right away."
  ].filter(Boolean).join("\n");

  const html = wrapInviteLayout(`
    <h1 style="margin:0 0 16px;font-size:34px;font-weight:700;line-height:1.15;color:${P.text};letter-spacing:-0.02em;">Password changed</h1>
    <p style="margin:0 0 12px;">${safeGreeting}</p>
    <p style="margin:0 0 12px;">${
      safeAccountEmail
        ? `The password for <strong>${safeAccountEmail}</strong> has been changed.`
        : "The password on your account has been changed."
    }</p>
    <p style="margin:0;font-size:14px;color:${BRAND.muted};">If you did not make this change, contact your ${safeBrandName} administrator right away.</p>
  `, {
    contextName: brandName,
    brandPrimary,
    logoUrl,
    tagline: "Account security"
  });

  return { subject, text, html };
}

export function passwordResetCodeTemplate({
  brandName = "PondBridge",
  code,
  requestIp = "",
  requestedAt = null,
  brandPrimary = BRAND.primary,
  logoUrl = ""
}) {
  const P = buildEmailPalette(brandPrimary);
  const safeBrandName = escapeHtml(brandName || "PondBridge");
  const safeCode = escapeHtml(String(code || "").trim());
  const safeRequestIp = escapeHtml(String(requestIp || "").trim());
  const requestedAtLabel = formatDate(requestedAt);
  const requestSummary = [safeRequestIp, requestedAtLabel].filter(Boolean).join(" at ");
  const subject = `${String(code || "").trim()} is your password reset code`;

  const text = [
    brandName || "PondBridge",
    "",
    "Reset your password",
    `Enter the code below to reset your ${brandName || "your network"} password.`,
    "",
    String(code || "").trim(),
    "",
    "To protect your account, do not share this code.",
    "If you did not request a password reset, you can ignore this email.",
    requestSummary ? `Requested from ${requestSummary}.` : ""
  ].filter(Boolean).join("\n");

  const html = wrapInviteLayout(`
    <h1 style="margin:0 0 16px;font-size:34px;font-weight:700;line-height:1.15;color:${P.text};letter-spacing:-0.02em;">Reset your password</h1>
    <p style="margin:0 0 12px;">Enter the code below to reset your ${safeBrandName} password.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:16px 0 18px;border:1px solid ${P.border};border-radius:12px;background:#f6f9ff;">
      <tr>
        <td align="center" style="padding:18px 16px;font-size:44px;font-weight:800;letter-spacing:0.08em;color:${P.text};">${safeCode}</td>
      </tr>
    </table>
    <p style="margin:0 0 10px;font-size:14px;color:${BRAND.muted};">To protect your account, do not share this code.</p>
    <p style="margin:0 0 10px;font-size:14px;color:${BRAND.muted};">If you did not request a password reset, you can ignore this email.</p>
    ${
      requestSummary
        ? `<p style="margin:0;font-size:13px;color:${BRAND.muted};">Requested from ${requestSummary}.</p>`
        : ""
    }
  `, {
    contextName: brandName,
    brandPrimary,
    logoUrl,
    tagline: "Password reset"
  });

  return { subject, text, html };
}

export function verificationCodeTemplate({
  brandName = "PondBridge",
  code,
  audience = "member",
  requestIp = "",
  requestedAt = null,
  brandPrimary = BRAND.primary,
  logoUrl = ""
}) {
  const P = buildEmailPalette(brandPrimary);
  const safeBrandName = escapeHtml(brandName || "PondBridge");
  const safeCode = escapeHtml(String(code || "").trim());
  const safeRequestIp = escapeHtml(String(requestIp || "").trim());
  const requestedAtLabel = formatDate(requestedAt);
  const isDirector = String(audience || "").trim().toLowerCase() === "director";
  const intro = isDirector
    ? "Enter the verification code below to continue setting up your PondBridge director account."
    : `Enter the verification code below to continue to ${safeBrandName}.`;
  const requestSummary = [safeRequestIp, requestedAtLabel].filter(Boolean).join(" at ");
  const subject = `${String(code || "").trim()} is your verification code`;

  const text = [
    brandName || "PondBridge",
    "",
    "Verification code",
    isDirector
      ? "Enter the verification code below to continue setting up your PondBridge director account."
      : `Enter the verification code below to continue to ${brandName || "your network"}.`,
    "",
    String(code || "").trim(),
    "",
    "To protect your account, do not share this code.",
    requestSummary ? `Requested from ${requestSummary}.` : ""
  ].filter(Boolean).join("\n");

  const html = wrapInviteLayout(`
    <h1 style="margin:0 0 16px;font-size:34px;font-weight:700;line-height:1.15;color:${P.text};letter-spacing:-0.02em;">Verification code</h1>
    <p style="margin:0 0 12px;">${intro}</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:16px 0 18px;border:1px solid ${P.border};border-radius:12px;background:#f6f9ff;">
      <tr>
        <td align="center" style="padding:18px 16px;font-size:44px;font-weight:800;letter-spacing:0.08em;color:${P.text};">${safeCode}</td>
      </tr>
    </table>
    <p style="margin:0 0 10px;font-size:14px;color:${BRAND.muted};">To protect your account, do not share this code.</p>
    ${
      requestSummary
        ? `<p style="margin:0;font-size:13px;color:${BRAND.muted};">Requested from ${requestSummary}.</p>`
        : ""
    }
  `, {
    contextName: brandName,
    brandPrimary,
    logoUrl,
    tagline: isDirector ? "Director onboarding verification" : "Secure account verification"
  });

  return { subject, text, html };
}

// ---------------------------------------------------------------------------
// 5. Access approved template
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
  `, { contextName: tenantName });

  return { subject, text, html };
}

// ---------------------------------------------------------------------------
// 6. Access denied template
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
  `, { contextName: tenantName });

  return { subject, text, html };
}

// ---------------------------------------------------------------------------
// 7. Broadcast template (director email wrapper)
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
    <div style="font-size:15px;line-height:1.6;color:${palette.text};">
      ${safeBodyHtml}
    </div>
  `, { unsubscribeUrl, contextName: tenantName });

  return { subject: safeSubject, text, html };
}
