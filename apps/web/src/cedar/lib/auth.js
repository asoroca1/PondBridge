// lib/auth.js
export const AUTH_KEYS = [
  "token",
  "user",
  "pondbridgeToken",
  "pondbridgeUser"
];

export function saveAuth({ token, user }) {
  const serializedUser = JSON.stringify(user || null);
  localStorage.setItem("token", token || "");
  localStorage.setItem("pondbridgeToken", token || "");
  localStorage.setItem("user", serializedUser);
  localStorage.setItem("pondbridgeUser", serializedUser);
  window.dispatchEvent(new CustomEvent("pondbridge-auth-updated"));
}

export function clearAuth() {
  AUTH_KEYS.forEach((k) => localStorage.removeItem(k));
  window.dispatchEvent(new CustomEvent("pondbridge-auth-updated"));
}

export function isAuthed() {
  return Boolean(localStorage.getItem("pondbridgeToken") || localStorage.getItem("token"));
}
  
