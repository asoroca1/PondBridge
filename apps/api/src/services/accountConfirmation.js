import { env } from "../config/env.js";

export function accountConfirmationRequired(user) {
  return Boolean(String(user?.accountConfirmationRequestId || "").trim());
}

export function accountConfirmationError() {
  return { code: "ACCOUNT_CONFIRMATION_REQUIRED", message: "Confirm your age eligibility and accept Terms and Privacy to continue.",
    nextRoute: "/t/greenlane/account-confirmation" };
}

export async function resolveAccountConfirmationGate(_identity, user) {
  // Gate the selected admitted membership. A separately authorized membership
  // in another camp keeps its own policy; it cannot authorize GreenLane paths.
  return accountConfirmationRequired(user) ? user : null;
}

// Only a fresh Backend User's verified primary address is confirmation identity.
// The agreement itself remains the authenticated person's self-attestation.
export async function verifyAccountConfirmationIdentity(identity, user) {
  const clerkId = String(user?.clerkUserId || "");
  const sameOwner = identity?.provider === "clerk"
    ? identity.clerkUserId === clerkId
    : identity?.provider === "legacy" && String(identity.userId || "") === String(user?._id || "")
      && String(identity.tenantId || "") === String(user?.tenantId || "");
  if (!sameOwner || !clerkId || !env.CLERK_SECRET_KEY) return false;
  const { createClerkClient } = await import("@clerk/backend");
  const record = await createClerkClient({ secretKey: env.CLERK_SECRET_KEY }).users.getUser(clerkId);
  const primary = (record.emailAddresses || []).find((item) => item.id === record.primaryEmailAddressId);
  const email = String(primary?.emailAddress || "").trim().toLowerCase();
  return !record.banned && !record.locked && primary?.verification?.status === "verified"
    && record.id === user.clerkUserId && email === String(user.email || "").trim().toLowerCase()
    && email === String(identity.email || "").trim().toLowerCase();
}
