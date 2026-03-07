import { InviteModel } from "../db/models/index.js";
import { generateOpaqueToken, hashOpaqueToken } from "../utils/tokens.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function isUniqueViolation(error) {
  const code = String(error?.code || "").trim();
  if (code === "23505") return true;
  const message = String(error?.message || "").toLowerCase();
  return message.includes("duplicate key") || message.includes("unique constraint");
}

async function findLatestInviteByEmail(tenantId, email = "") {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!tenantId || !normalizedEmail) return null;
  const matches = await InviteModel.find(
    tenantId,
    { email: normalizedEmail },
    { sort: { createdAt: -1 }, limit: 1 }
  );
  return matches[0] || null;
}

export function inviteExpired(invite) {
  return !invite?.expiresAt || new Date(invite.expiresAt) <= new Date();
}

export async function createInviteRecord({
  tenantId,
  email = "",
  roleToAssign = "user",
  createdByUserId = null,
  expiresInDays = 7
}) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const token = generateOpaqueToken(24);
  const expiresAt = new Date(Date.now() + Math.max(1, Number(expiresInDays || 7)) * DAY_MS);
  const nextInvitePayload = {
    email: normalizedEmail,
    token: hashOpaqueToken(token),
    expiresAt,
    usedAt: null,
    usedByUserId: null,
    roleToAssign: String(roleToAssign || "user").trim() || "user",
    createdByUserId
  };

  let invite = null;
  try {
    invite = await InviteModel.create({
      tenantId,
      ...nextInvitePayload
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const existingInvite = await findLatestInviteByEmail(tenantId, normalizedEmail);
    if (!existingInvite?._id) throw error;
    invite = await InviteModel.update(existingInvite._id, nextInvitePayload);
  }

  return { invite, token };
}

export async function findInviteByOpaqueToken(tenantId, token) {
  const raw = String(token || "").trim();
  if (!raw) return null;
  const hashed = hashOpaqueToken(raw);
  const query = { token: hashed, usedAt: null };
  let invite = await InviteModel.findOne(tenantId, query);

  // Backward compatibility during migration from plaintext token storage.
  if (!invite) {
    const legacyInvite = await InviteModel.findOne(tenantId, { token: raw, usedAt: null });
    if (legacyInvite) {
      invite = await InviteModel.update(legacyInvite._id, { token: hashed }).catch(() => legacyInvite);
    }
  }

  if (!invite || inviteExpired(invite)) return null;
  return invite;
}

export async function findInviteByOpaqueTokenAnyState(tenantId, token) {
  const raw = String(token || "").trim();
  if (!raw) return null;
  const hashed = hashOpaqueToken(raw);

  let invite = await InviteModel.findOne(tenantId, { token: hashed });
  if (!invite) {
    const legacyInvite = await InviteModel.findOne(tenantId, { token: raw });
    if (legacyInvite) {
      invite = await InviteModel.update(legacyInvite._id, { token: hashed }).catch(() => legacyInvite);
    }
  }
  if (!invite || inviteExpired(invite)) return null;
  return invite;
}

export async function markInviteUsed(invite, userId) {
  if (!invite?._id || invite.usedAt) return invite || null;
  const consumed = await InviteModel.consumeIfUnused(invite.tenantId, invite._id, {
    usedByUserId: userId || null,
    usedAt: new Date()
  });
  return consumed || invite;
}
