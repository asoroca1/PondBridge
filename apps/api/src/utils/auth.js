import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export async function hashPassword(plainText) {
  return bcrypt.hash(plainText, env.BCRYPT_ROUNDS);
}

export async function comparePassword(plainText, passwordHash) {
  return bcrypt.compare(plainText, passwordHash);
}

export function signToken(user) {
  return jwt.sign(
    {
      sub: String(user._id),
      tenantId: user.tenantId ? String(user.tenantId) : null,
      roles: user.roles || [],
      email: user.email
    },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN }
  );
}

export function sanitizeUser(userDoc) {
  const user = userDoc.toObject ? userDoc.toObject({ versionKey: false }) : { ...userDoc };
  delete user.passwordHash;
  return user;
}
