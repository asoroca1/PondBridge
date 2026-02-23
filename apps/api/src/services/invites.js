import { InviteModel } from "../db/models/index.js";
import { generateOpaqueToken, hashOpaqueToken } from "../utils/tokens.js";

const DAY_MS = 24 * 60 * 60 * 1000;

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
  const token = generateOpaqueToken(24);
  const expiresAt = new Date(Date.now() + Math.max(1, Number(expiresInDays || 7)) * DAY_MS);

  const invite = await InviteModel.create({
    tenantId,
    email: String(email || "").trim().toLowerCase(),
    token: hashOpaqueToken(token),
    expiresAt,
    usedAt: null,
    roleToAssign: String(roleToAssign || "user").trim() || "user",
    createdByUserId
  });

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
