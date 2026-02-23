import crypto from "crypto";

const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;

export function isValidObjectId(value) {
  if (!value) return false;
  return OBJECT_ID_REGEX.test(String(value));
}

export function generateObjectId() {
  return crypto.randomBytes(12).toString("hex");
}
