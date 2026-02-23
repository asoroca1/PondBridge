import { env } from "../config/env.js";

function serializeCookie(name, value, options = {}) {
  const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path || "/"}`);

  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.domain) parts.push(`Domain=${options.domain}`);
  if (Number.isFinite(options.maxAge)) parts.push(`Max-Age=${Math.max(0, Math.trunc(options.maxAge))}`);

  return parts.join("; ");
}

function parseCookies(header = "") {
  return String(header || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const index = part.indexOf("=");
      if (index <= 0) return acc;
      const key = decodeURIComponent(part.slice(0, index).trim());
      const value = decodeURIComponent(part.slice(index + 1).trim());
      acc[key] = value;
      return acc;
    }, {});
}

function modeUsesCookie(mode = env.AUTH_TOKEN_MODE) {
  return ["cookie", "hybrid"].includes(String(mode || "").trim().toLowerCase());
}

export function shouldUseAuthCookie() {
  return modeUsesCookie();
}

export function readAuthTokenFromCookie(req) {
  if (!modeUsesCookie()) return "";
  const cookies = parseCookies(req.headers.cookie || "");
  return String(cookies[env.AUTH_COOKIE_NAME] || "").trim();
}

export function setAuthCookie(res, token) {
  if (!modeUsesCookie()) return;

  const cookie = serializeCookie(env.AUTH_COOKIE_NAME, String(token || ""), {
    path: "/",
    httpOnly: true,
    secure: env.AUTH_COOKIE_SECURE,
    sameSite: env.AUTH_COOKIE_SAMESITE,
    domain: env.AUTH_COOKIE_DOMAIN || undefined,
    maxAge: env.AUTH_COOKIE_MAX_AGE_SECONDS
  });

  res.append("Set-Cookie", cookie);
}

export function clearAuthCookie(res) {
  if (!modeUsesCookie()) return;

  const cookie = serializeCookie(env.AUTH_COOKIE_NAME, "", {
    path: "/",
    httpOnly: true,
    secure: env.AUTH_COOKIE_SECURE,
    sameSite: env.AUTH_COOKIE_SAMESITE,
    domain: env.AUTH_COOKIE_DOMAIN || undefined,
    maxAge: 0
  });

  res.append("Set-Cookie", cookie);
}
