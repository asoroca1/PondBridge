import { createClerkClient, verifyToken } from "@clerk/backend";
import { env } from "../config/env.js";

const clerkClient = env.CLERK_SECRET_KEY
  ? createClerkClient({ secretKey: env.CLERK_SECRET_KEY })
  : null;
const clerkUserSnapshotCache = new Map();
const CLERK_USER_SNAPSHOT_TTL_MS = 5 * 60 * 1000;

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

function normalizeName(value = "") {
  return String(value || "").trim();
}

function readCachedClerkUserSnapshot(clerkUserId = "") {
  const entry = clerkUserSnapshotCache.get(String(clerkUserId || "").trim());
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    clerkUserSnapshotCache.delete(String(clerkUserId || "").trim());
    return null;
  }
  return entry.data || null;
}

async function resolveClerkUserSnapshot(clerkUserId = "") {
  if (!clerkClient || !clerkUserId) return null;
  const cacheHit = readCachedClerkUserSnapshot(clerkUserId);
  if (cacheHit) return cacheHit;

  const user = await clerkClient.users.getUser(clerkUserId);
  const primaryEmailId = String(user?.primaryEmailAddressId || "");
  const emailObj = (user?.emailAddresses || []).find((item) => String(item?.id || "") === primaryEmailId);
  const fallback = user?.emailAddresses?.[0]?.emailAddress || "";
  const snapshot = {
    email: normalizeEmail(emailObj?.emailAddress || fallback),
    firstName: normalizeName(user?.firstName || ""),
    lastName: normalizeName(user?.lastName || "")
  };
  clerkUserSnapshotCache.set(String(clerkUserId || "").trim(), {
    expiresAt: Date.now() + CLERK_USER_SNAPSHOT_TTL_MS,
    data: snapshot
  });
  return snapshot;
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

  const claimFirstName = normalizeName(
    claims?.first_name || claims?.given_name || claims?.firstName || ""
  );
  const claimLastName = normalizeName(
    claims?.last_name || claims?.family_name || claims?.lastName || ""
  );
  const candidateEmail =
    claims?.email ||
    claims?.email_address ||
    claims?.primary_email_address ||
    claims?.primaryEmailAddress ||
    "";
  let email = candidateEmail ? normalizeEmail(candidateEmail) : "";
  let firstName = claimFirstName;
  let lastName = claimLastName;

  if (!email || !firstName || !lastName) {
    const snapshot = await resolveClerkUserSnapshot(clerkUserId);
    if (!email) email = normalizeEmail(snapshot?.email || "");
    if (!firstName) firstName = normalizeName(snapshot?.firstName || "");
    if (!lastName) lastName = normalizeName(snapshot?.lastName || "");
  }

  const normalizedEmail = normalizeEmail(email);

  return {
    provider: "clerk",
    token,
    clerkUserId,
    email: normalizedEmail,
    firstName,
    lastName,
    claims
  };
}
