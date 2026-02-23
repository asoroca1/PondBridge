import nodemailer from "nodemailer";
import { env } from "../config/env.js";

let transport = null;

function asBoolean(value, fallback = false) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  return ["1", "true", "yes", "on"].includes(normalized);
}

function getEmailMode() {
  return String(env.EMAIL_MODE || "mock").trim().toLowerCase();
}

function toAddressList(value) {
  const values = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(values.map((item) => String(item || "").trim()).filter(Boolean))];
}

function getTransport() {
  if (transport) return transport;

  transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: asBoolean(env.SMTP_SECURE, false),
    auth:
      env.SMTP_USER && env.SMTP_PASS
        ? {
            user: env.SMTP_USER,
            pass: env.SMTP_PASS
          }
        : undefined
  });

  return transport;
}

async function sendResendEmail({ to, cc, bcc, replyTo, subject, text, html }) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    throw new Error("Missing Resend settings. Set RESEND_API_KEY and EMAIL_FROM.");
  }

  const recipients = toAddressList(to);
  if (recipients.length === 0) {
    throw new Error("Missing recipient email address.");
  }

  const ccList = toAddressList(cc);
  const bccList = toAddressList(bcc);
  const replyToList = toAddressList(replyTo);
  const payload = {
    from: env.EMAIL_FROM,
    to: recipients,
    subject
  };

  if (ccList.length > 0) payload.cc = ccList;
  if (bccList.length > 0) payload.bcc = bccList;
  if (replyToList.length > 0) payload.reply_to = replyToList[0];
  if (html) payload.html = html;
  if (text) payload.text = text;
  if (!payload.html && !payload.text) payload.text = "";

  const response = await fetch(`${env.RESEND_API_BASE_URL}/emails`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const responseBody = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = String(
      responseBody?.message || responseBody?.name || responseBody?.error?.message || ""
    ).trim();
    throw new Error(
      `Resend email send failed (${response.status}): ${message || "Unknown API error."}`
    );
  }

  return { ok: true, mode: "resend", messageId: String(responseBody?.id || "") };
}

export function inviteLink({ tenantSlug, token, email }) {
  return `${env.FRONTEND_ORIGIN}/t/${tenantSlug}/create-account?inviteToken=${encodeURIComponent(
    token
  )}&email=${encodeURIComponent(email)}`;
}

export function magicLink({ tenantSlug, token }) {
  return `${env.FRONTEND_ORIGIN}/t/${tenantSlug}/login?magicToken=${encodeURIComponent(token)}`;
}

export async function sendTransactionalEmail({ to, cc, bcc, replyTo, subject, text, html }) {
  const mode = getEmailMode();

  if (mode === "mock") {
    console.log("[email:mock]", { to, subject, text });
    return { ok: true, mode: "mock", messageId: "mock-message" };
  }

  if (mode === "resend") {
    return sendResendEmail({ to, cc, bcc, replyTo, subject, text, html });
  }

  if (mode === "smtp") {
    if (!env.SMTP_HOST || !env.SMTP_PORT || !env.EMAIL_FROM) {
      throw new Error("Missing SMTP settings. Set SMTP_HOST, SMTP_PORT, and EMAIL_FROM.");
    }

    const result = await getTransport().sendMail({
      from: env.EMAIL_FROM,
      to,
      cc,
      bcc,
      replyTo,
      subject,
      text,
      html
    });

    return { ok: true, mode: "smtp", messageId: result.messageId || "" };
  }

  throw new Error("Unsupported EMAIL_MODE. Use one of: mock, smtp, resend.");
}

export async function sendInviteEmail({ tenant, email, token, roleToAssign, expiresAt }) {
  const link = inviteLink({ tenantSlug: tenant.slug, token, email });
  const subject = `You are invited to ${tenant.name} on PondBridge`;
  const text = [
    `You were invited to join ${tenant.name}.`,
    `Assigned role: ${roleToAssign}.`,
    `This invite expires on ${new Date(expiresAt).toISOString()}.`,
    `Create your account: ${link}`
  ].join("\n");

  return sendTransactionalEmail({ to: email, subject, text });
}

export async function sendMagicLinkEmail({ tenant, email, token, expiresAt }) {
  const link = magicLink({ tenantSlug: tenant.slug, token });
  const subject = `Your ${tenant.name} sign-in link`;
  const text = [
    `Use this one-time sign-in link for ${tenant.name}.`,
    `This link expires on ${new Date(expiresAt).toISOString()}.`,
    `Sign in: ${link}`
  ].join("\n");

  return sendTransactionalEmail({ to: email, subject, text });
}
