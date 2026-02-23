import { createClerkClient, verifyToken } from "@clerk/backend";
import { env } from "../config/env.js";

const clerkClient = env.CLERK_SECRET_KEY
  ? createClerkClient({ secretKey: env.CLERK_SECRET_KEY })
  : null;

function authUsesClerk() {
  return ["clerk", "hybrid"].includes(env.AUTH_PROVIDER);
}

function parseBearerToken(req) {
  const header = String(req.headers.authorization || "").trim();
  if (header.startsWith("Bearer ")) return header.slice(7).trim();
  return "";
}

function parseCookieToken(req, cookieName = "__session") {
  const raw = String(req.headers.cookie || "");
  if (!raw) return "";
  const parts = raw.split(";").map((part) => part.trim());
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = decodeURIComponent(part.slice(0, idx).trim());
    if (key !== cookieName) continue;
    return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return "";
}

function normalizeEmail(email = "") {
  return String(email || "").trim().toLowerCase();
}

async function resolvePrimaryEmailFromClerkUser(clerkUserId = "") {
  if (!clerkClient || !clerkUserId) return "";
  const user = await clerkClient.users.getUser(clerkUserId);
  const primaryEmailId = String(user?.primaryEmailAddressId || "");
  const emailObj = (user?.emailAddresses || []).find((item) => String(item?.id || "") === primaryEmailId);
  const fallback = user?.emailAddresses?.[0]?.emailAddress || "";
  return normalizeEmail(emailObj?.emailAddress || fallback);
}

export async function resolveClerkIdentityFromRequest(req) {
  if (!authUsesClerk()) return null;
  const token = parseBearerToken(req) || parseCookieToken(req);
  if (!token) return null;

  const verifyOptions = {
    secretKey: env.CLERK_SECRET_KEY
  };
  if (env.CLERK_JWT_AUDIENCE) verifyOptions.audience = env.CLERK_JWT_AUDIENCE;
  if (env.CLERK_AUTHORIZED_PARTIES.length > 0) {
    verifyOptions.authorizedParties = env.CLERK_AUTHORIZED_PARTIES;
  }

  const claims = await verifyToken(token, verifyOptions);
  const clerkUserId = String(claims?.sub || "").trim();
  if (!clerkUserId) return null;

  const candidateEmail =
    claims?.email ||
    claims?.email_address ||
    claims?.primary_email_address ||
    claims?.primaryEmailAddress ||
    "";

  const email = candidateEmail
    ? normalizeEmail(candidateEmail)
    : await resolvePrimaryEmailFromClerkUser(clerkUserId);

  return {
    provider: "clerk",
    token,
    clerkUserId,
    email,
    claims
  };
}

