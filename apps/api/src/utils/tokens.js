import crypto from "crypto";

export function generateOpaqueToken(length = 32) {
  return crypto.randomBytes(Math.max(16, Math.trunc(length))).toString("base64url");
}

export function hashOpaqueToken(token = "") {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

