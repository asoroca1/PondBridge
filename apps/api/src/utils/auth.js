import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export async function hashPassword(plainText) {
  return bcrypt.hash(plainText, env.BCRYPT_ROUNDS);
}

export async function comparePassword(plainText, passwordHash) {
  return bcrypt.compare(plainText, passwordHash);
}

export function signToken(user, { expiresIn = env.JWT_EXPIRES_IN, extraClaims = {} } = {}) {
  return jwt.sign(
    {
      sub: String(user._id),
      tenantId: user.tenantId ? String(user.tenantId) : null,
      roles: user.roles || [],
      email: user.email,
      ...extraClaims
    },
    env.JWT_SECRET,
    { expiresIn }
  );
}

export function sanitizeUser(userDoc) {
  const user = userDoc.toObject ? userDoc.toObject({ versionKey: false }) : { ...userDoc };
  delete user.passwordHash;
  return user;
}

function resolveProfileNickname(profile = {}) {
  return String(
    profile?.nickname ||
      profile?.social?.nickname ||
      profile?.socials?.nickname ||
      profile?.socials?.campNickname ||
      ""
  ).trim();
}

function resolveProfilePhotoUrl(profile = {}) {
  return String(
    profile?.uploads?.photoUrl ||
      profile?.uploads?.photo ||
      profile?.photoUrl ||
      profile?.avatarUrl ||
      profile?.profilePhotoUrl ||
      profile?.profilePhoto ||
      ""
  ).trim();
}

export function buildAuthenticatedUserPayload(userDoc, profileDoc = null) {
  const user = sanitizeUser(userDoc);
  const profile = profileDoc && typeof profileDoc === "object" ? profileDoc : null;
  const firstName = String(profile?.firstName || "").trim();
  const lastName = String(profile?.lastName || "").trim();
  const nickname = resolveProfileNickname(profile);
  const photoUrl = resolveProfilePhotoUrl(profile);
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();

  return {
    ...user,
    firstName,
    lastName,
    nickname,
    name: fullName || String(user?.email || "").trim(),
    fullName,
    photoUrl,
    avatarUrl: photoUrl,
    profilePhotoUrl: photoUrl,
    profile: profile
      ? {
          id: String(profile?._id || profile?.id || "").trim(),
          _id: String(profile?._id || profile?.id || "").trim(),
          firstName,
          lastName,
          nickname,
          photoUrl,
          avatarUrl: photoUrl,
          profilePhotoUrl: photoUrl,
          uploads: {
            photoUrl
          }
        }
      : null,
    uploads: {
      ...(user?.uploads && typeof user.uploads === "object" ? user.uploads : {}),
      ...(photoUrl ? { photoUrl } : {})
    }
  };
}
