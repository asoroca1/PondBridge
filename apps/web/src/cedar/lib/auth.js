import { clearVolatileAuthToken, getVolatileAuthToken, setVolatileAuthToken } from "../../lib/authMemory.js";

// lib/auth.js
export const AUTH_KEYS = [
  "user",
  "pondbridgeUser"
];

export function saveAuth({ token, user }) {
  const serializedUser = JSON.stringify(user || null);
  setVolatileAuthToken(token || "");
  localStorage.setItem("user", serializedUser);
  localStorage.setItem("pondbridgeUser", serializedUser);
  window.dispatchEvent(new CustomEvent("pondbridge-auth-updated"));
}

export function clearAuth() {
  clearVolatileAuthToken();
  AUTH_KEYS.forEach((k) => localStorage.removeItem(k));
  localStorage.removeItem("token");
  localStorage.removeItem("pondbridgeToken");
  localStorage.removeItem("cedarToken");
  window.dispatchEvent(new CustomEvent("pondbridge-auth-updated"));
}

export function isAuthed() {
  if (getVolatileAuthToken()) return true;
  const rawUser = localStorage.getItem("pondbridgeUser") || localStorage.getItem("user") || "";
  if (!rawUser) return false;
  try {
    const parsed = JSON.parse(rawUser);
    return Boolean(parsed?.id || parsed?._id);
  } catch {
    return false;
  }
}
  
