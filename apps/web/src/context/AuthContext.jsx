import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAuth as useClerkAuth, useClerk } from "@clerk/clerk-react";
import { clearAuthStorage, readAuthFromStorage, writeAuthToStorage } from "../lib/storage.js";
import { requestJson } from "../lib/http.js";
import { inferCampSlugFromHost } from "../lib/domain.js";
import {
  AUTH_PROVIDER,
  clerkConfigError,
  clerkModeRequested,
  clerkUiEnabled
} from "../lib/authMode.js";

const AuthContext = createContext(null);

const IDLE_EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"];
const TAB_AUTH_SESSION_KEY = "pondbridgeTabAuthSession";
const TAB_LOGIN_INTENT_KEY = "pondbridgeTabLoginIntent";
const AUTO_LOGOUT_MINUTES = Number(import.meta.env.VITE_AUTO_LOGOUT_MINUTES || 60);
const SESSION_WARNING_MINUTES = 5;
const AUTO_LOGOUT_TIMEOUT_MS =
  Number.isFinite(AUTO_LOGOUT_MINUTES) && AUTO_LOGOUT_MINUTES > 0
    ? AUTO_LOGOUT_MINUTES * 60 * 1000
    : 0;
const CLERK_TOKEN_SYNC_INTERVAL_MS = 4 * 60 * 1000;
const SESSION_TOKEN_STORAGE_KEY = "pondbridgeSessionToken";
const AUTH_BOOTSTRAP_TIMEOUT_MS = 12_000;
const SESSION_WARNING_TIMEOUT_MS =
  AUTO_LOGOUT_TIMEOUT_MS > SESSION_WARNING_MINUTES * 60 * 1000
    ? AUTO_LOGOUT_TIMEOUT_MS - SESSION_WARNING_MINUTES * 60 * 1000
    : 0;
const CLERK_BOOTSTRAP_RETRY_DELAYS_MS = [0, 160, 420, 900];
const CLERK_BOOTSTRAP_MAX_RETRIES = 4;
const FORCE_RELOGIN_ON_TAB_CLOSE = !["0", "false", "off", "no"].includes(
  String(import.meta.env.VITE_FORCE_LOGOUT_ON_TAB_CLOSE || "false")
    .trim()
    .toLowerCase()
);
const DEMO_TENANT_FLAG_CACHE_TTL_MS = 5 * 60 * 1000;
const demoTenantFlagCache = new Map();

function inferTenantSlugForSessionRequest() {
  if (typeof window === "undefined") return "";
  const pathname = String(window.location.pathname || "");
  const host = String(window.location.hostname || "");
  const fromPath = pathname.match(/^\/t\/([^/]+)/i)?.[1] || "";
  const fromHost = inferCampSlugFromHost(host);

  // Never carry remembered tenant scope into global/super-console routes.
  const onSuperRoute = pathname === "/super" || pathname.startsWith("/super/");
  if (onSuperRoute || host === "pondbridgealumni.com" || host === "app.pondbridgealumni.com") {
    return String(fromPath || fromHost || "").trim().toLowerCase();
  }

  const remembered = String(localStorage.getItem("pondbridgeTenantSlug") || "").trim().toLowerCase();
  return String(fromPath || fromHost || remembered || "").trim().toLowerCase();
}

function isAuthEntryRoute(pathname = "") {
  const path = String(pathname || "");
  return (
    path === "/super" ||
    path.startsWith("/super/") ||
    path.includes("/login") ||
    path.includes("/auth/callback") ||
    path.includes("/create-account") ||
    path.includes("/director-claim") ||
    path.includes("/director-create-account")
  );
}

async function isDemoTenantSlug(slug = "") {
  const normalizedSlug = String(slug || "").trim().toLowerCase();
  if (!normalizedSlug) return false;

  const cached = demoTenantFlagCache.get(normalizedSlug);
  if (cached && Date.now() < Number(cached.expiresAt || 0)) {
    return Boolean(cached.value);
  }

  try {
    const payload = await requestJson(`/api/public/tenant-config?slug=${encodeURIComponent(normalizedSlug)}`);
    const value = Boolean(payload?.accessSettings?.demoAccessEnabled);
    demoTenantFlagCache.set(normalizedSlug, {
      value,
      expiresAt: Date.now() + DEMO_TENANT_FLAG_CACHE_TTL_MS
    });
    return value;
  } catch {
    demoTenantFlagCache.set(normalizedSlug, {
      value: false,
      expiresAt: Date.now() + 30 * 1000
    });
    return false;
  }
}

function wait(ms = 0) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function createPendingClerkTokenError() {
  const error = new Error("Clerk session token is not ready yet.");
  error.code = "AUTH_TOKEN_PENDING";
  return error;
}

function createAuthBootstrapTimeoutError() {
  const error = new Error("Auth bootstrap timed out.");
  error.code = "AUTH_BOOTSTRAP_TIMEOUT";
  return error;
}

function markTabSessionAuthenticated() {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(TAB_AUTH_SESSION_KEY, "1");
}

function clearTabSessionAuthenticated() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(TAB_AUTH_SESSION_KEY);
}

function hasTabSessionAuthenticated() {
  if (typeof window === "undefined") return false;
  return window.sessionStorage.getItem(TAB_AUTH_SESSION_KEY) === "1";
}

function markTabLoginIntent() {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(TAB_LOGIN_INTENT_KEY, "1");
}

function clearTabLoginIntent() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(TAB_LOGIN_INTENT_KEY);
}

function hasTabLoginIntent() {
  if (typeof window === "undefined") return false;
  return window.sessionStorage.getItem(TAB_LOGIN_INTENT_KEY) === "1";
}

export function noteTabLoginIntent() {
  markTabLoginIntent();
}

function useIdleLogout({ enabled, isAuthenticated, onLogout, onSessionWarning }) {
  const timeoutRef = useRef(null);
  const warningRef = useRef(null);
  const logoutInFlightRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (warningRef.current) {
      window.clearTimeout(warningRef.current);
      warningRef.current = null;
    }
  }, []);

  const schedule = useCallback(() => {
    if (!enabled || !isAuthenticated || AUTO_LOGOUT_TIMEOUT_MS <= 0) return;
    clearTimer();

    // Schedule a warning before the actual logout.
    if (SESSION_WARNING_TIMEOUT_MS > 0 && onSessionWarning) {
      warningRef.current = window.setTimeout(() => {
        onSessionWarning(SESSION_WARNING_MINUTES);
      }, SESSION_WARNING_TIMEOUT_MS);
    }

    timeoutRef.current = window.setTimeout(() => {
      if (logoutInFlightRef.current) return;
      logoutInFlightRef.current = true;
      Promise.resolve(onLogout?.()).finally(() => {
        logoutInFlightRef.current = false;
      });
    }, AUTO_LOGOUT_TIMEOUT_MS);
  }, [clearTimer, enabled, isAuthenticated, onLogout, onSessionWarning]);

  useEffect(() => {
    if (!enabled || !isAuthenticated || AUTO_LOGOUT_TIMEOUT_MS <= 0) {
      clearTimer();
      return undefined;
    }

    const onActivity = () => schedule();
    schedule();
    for (const eventName of IDLE_EVENTS) {
      window.addEventListener(eventName, onActivity, { passive: true });
    }
    document.addEventListener("visibilitychange", onActivity);

    return () => {
      clearTimer();
      for (const eventName of IDLE_EVENTS) {
        window.removeEventListener(eventName, onActivity);
      }
      document.removeEventListener("visibilitychange", onActivity);
    };
  }, [clearTimer, enabled, isAuthenticated, schedule]);
}

function normalizeUserShape(user) {
  if (!user) return null;
  const id = String(user.id || user._id || "").trim();
  if (!id) return null;
  const rawRoles = Array.isArray(user.roles)
    ? user.roles
    : user?.roles
      ? [user.roles]
      : user?.role
        ? [user.role]
        : [];
  const roleSet = new Set(
    rawRoles
      .map((role) => String(role || "").trim().toLowerCase())
      .filter(Boolean)
  );
  if (roleSet.has("admin")) roleSet.add("tenant_admin");
  if ((roleSet.has("tenant_admin") || roleSet.has("admin")) && !roleSet.has("user")) {
    roleSet.add("user");
  }
  return {
    ...user,
    id,
    _id: id,
    roles: [...roleSet]
  };
}

function normalizeTenantSlug(value = "") {
  return String(value || "").trim().toLowerCase();
}

function normalizeScopedUserShape(user, { tenantSlug = "" } = {}) {
  const normalizedUser = normalizeUserShape(user);
  if (!normalizedUser) return null;

  const resolvedTenantSlug = normalizeTenantSlug(
    normalizedUser.tenantSlug || tenantSlug
  );
  if (!resolvedTenantSlug) return normalizedUser;

  return {
    ...normalizedUser,
    tenantSlug: resolvedTenantSlug
  };
}

function cachedSessionMatchesTenant(user, tenantSlug = "") {
  const normalizedUser = normalizeUserShape(user);
  const resolvedTenantSlug = normalizeTenantSlug(tenantSlug);
  if (!normalizedUser || !resolvedTenantSlug) return true;
  if ((normalizedUser.roles || []).includes("super_admin")) return true;

  const cachedTenantSlug = normalizeTenantSlug(normalizedUser.tenantSlug);
  if (!cachedTenantSlug) return true;
  return cachedTenantSlug === resolvedTenantSlug;
}

function LegacyAuthProvider({ children }) {
  const initial = readAuthFromStorage();
  const initialTenantSlug = inferTenantSlugForSessionRequest();
  const hydrateLegacySession = !FORCE_RELOGIN_ON_TAB_CLOSE || hasTabSessionAuthenticated();
  const mismatchedCachedSession =
    hydrateLegacySession &&
    Boolean(initial.token) &&
    !cachedSessionMatchesTenant(initial.user, initialTenantSlug);
  const [token, setToken] = useState(hydrateLegacySession && !mismatchedCachedSession ? initial.token : "");
  const [user, setUser] = useState(
    hydrateLegacySession && !mismatchedCachedSession
      ? normalizeScopedUserShape(initial.user, { tenantSlug: initialTenantSlug })
      : null
  );
  const [sessionReady, setSessionReady] = useState(
    () => !(hydrateLegacySession && !mismatchedCachedSession && Boolean(initial.token))
  );
  const bootstrapCompleteRef = useRef(false);

  useEffect(() => {
    if (!mismatchedCachedSession) return;
    clearAuthStorage();
    clearTabSessionAuthenticated();
    clearTabLoginIntent();
  }, [mismatchedCachedSession]);

  useEffect(() => {
    function syncFromStorage() {
      if (FORCE_RELOGIN_ON_TAB_CLOSE && !hasTabSessionAuthenticated()) {
        setToken("");
        setUser(null);
        setSessionReady(true);
        return;
      }
      const next = readAuthFromStorage();
      const nextTenantSlug = inferTenantSlugForSessionRequest();
      if (!cachedSessionMatchesTenant(next.user, nextTenantSlug)) {
        setToken("");
        setUser(null);
        setSessionReady(true);
        clearAuthStorage();
        clearTabSessionAuthenticated();
        clearTabLoginIntent();
        return;
      }
      setToken(next.token || "");
      setUser(normalizeScopedUserShape(next.user, { tenantSlug: nextTenantSlug }));
      setSessionReady(true);
    }

    window.addEventListener("storage", syncFromStorage);
    window.addEventListener("pondbridge-auth-updated", syncFromStorage);

    return () => {
      window.removeEventListener("storage", syncFromStorage);
      window.removeEventListener("pondbridge-auth-updated", syncFromStorage);
    };
  }, []);

  const login = useCallback((nextToken, nextUser) => {
    const normalized = normalizeScopedUserShape(nextUser, {
      tenantSlug: inferTenantSlugForSessionRequest()
    });
    setToken(nextToken || "");
    setUser(normalized);
    writeAuthToStorage(nextToken || "", normalized);
    markTabSessionAuthenticated();
    clearTabLoginIntent();
    setSessionReady(true);
  }, []);

  const logout = useCallback(() => {
    setToken("");
    setUser(null);
    clearAuthStorage();
    clearTabSessionAuthenticated();
    clearTabLoginIntent();
    setSessionReady(true);
  }, []);

  useIdleLogout({
    enabled: true,
    isAuthenticated: Boolean(token),
    onLogout: logout,
    onSessionWarning: null
  });

  const refreshSession = useCallback(
    async ({ tenantSlug = "" } = {}) => {
      const resolvedTenantSlug = String(tenantSlug || inferTenantSlugForSessionRequest() || "")
        .trim()
        .toLowerCase();
      try {
        const payload = await requestJson("/api/auth/session", {
          token: token || "",
          headers: resolvedTenantSlug ? { "X-Tenant-Slug": resolvedTenantSlug } : {}
        });
        const normalizedUser = normalizeScopedUserShape(
          {
            ...(payload?.user || {}),
            tenantSlug: payload?.tenant?.slug || payload?.user?.tenantSlug || resolvedTenantSlug
          },
          { tenantSlug: resolvedTenantSlug }
        );
        setUser(normalizedUser);
        writeAuthToStorage(token || "", normalizedUser);
        markTabSessionAuthenticated();
        return {
          ok: Boolean(normalizedUser),
          authProvider: payload?.authProvider || "legacy",
          user: normalizedUser
        };
      } catch (error) {
        if (error?.status === 401 || error?.status === 403) {
          setToken("");
          setUser(null);
          clearAuthStorage();
          clearTabSessionAuthenticated();
          clearTabLoginIntent();
          setSessionReady(true);
          return { ok: false, authProvider: "legacy", user: null };
        }
        throw error;
      }
    },
    [token]
  );

  useEffect(() => {
    if (bootstrapCompleteRef.current) return;
    bootstrapCompleteRef.current = true;
    if (FORCE_RELOGIN_ON_TAB_CLOSE && !hasTabSessionAuthenticated()) {
      setSessionReady(true);
      return;
    }

    refreshSession({ tenantSlug: inferTenantSlugForSessionRequest() })
      .catch(() => {})
      .finally(() => {
        setSessionReady(true);
      });
  }, [refreshSession]);

  const value = useMemo(
    () => ({
      token,
      user,
      isAuthenticated: Boolean(token),
      isReady: sessionReady,
      authProvider: "legacy",
      authConfigError: "",
      bootstrapError: "",
      sessionWarningMinutes: 0,
      dismissSessionWarning: () => {},
      login,
      logout,
      getAuthToken: async () => token || "",
      refreshSession,
      retryBootstrap: () => {},
      setUser: (nextUser) => {
        const normalized = normalizeScopedUserShape(nextUser, {
          tenantSlug: inferTenantSlugForSessionRequest()
        });
        setUser(normalized);
        writeAuthToStorage(token || "", normalized);
      }
    }),
    [login, logout, refreshSession, sessionReady, token, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function readSessionToken() {
  try {
    return window.sessionStorage.getItem(SESSION_TOKEN_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function writeSessionToken(value) {
  try {
    if (value) {
      window.sessionStorage.setItem(SESSION_TOKEN_STORAGE_KEY, value);
    } else {
      window.sessionStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
    }
  } catch {
    /* ignore */
  }
}

function clearSessionToken() {
  try {
    window.sessionStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Decode a JWT payload to check expiry. Returns seconds-since-epoch or 0.
 */
function getTokenExpiry(jwt) {
  if (!jwt) return 0;
  try {
    const parts = jwt.split(".");
    if (parts.length < 2) return 0;
    const payload = JSON.parse(atob(parts[1]));
    return (payload.exp || 0) * 1000; // convert to ms
  } catch {
    return 0;
  }
}

function ClerkBackedAuthProvider({ children }) {
  // Hydrate cached user from localStorage on mount so returning users
  // see content immediately instead of a blank flash while Clerk loads.
  const cachedAuth = readAuthFromStorage();
  const initialTenantSlug = inferTenantSlugForSessionRequest();
  const shouldHydrate = !FORCE_RELOGIN_ON_TAB_CLOSE || hasTabSessionAuthenticated();
  const mismatchedCachedSession =
    shouldHydrate &&
    Boolean(cachedAuth.token) &&
    !cachedSessionMatchesTenant(cachedAuth.user, initialTenantSlug);
  const [token, setToken] = useState(() =>
    shouldHydrate && !mismatchedCachedSession ? readSessionToken() : ""
  );
  const [user, setUser] = useState(
    shouldHydrate && !mismatchedCachedSession
      ? normalizeScopedUserShape(cachedAuth.user, { tenantSlug: initialTenantSlug })
      : null
  );
  const [sessionRefreshing, setSessionRefreshing] = useState(true);
  const [sessionWarningMinutes, setSessionWarningMinutes] = useState(0);
  // Tracks bootstrap-level auth errors (e.g. 401 from /api/auth/session)
  // so login pages can detect the failure and avoid auto-redirect loops.
  const [bootstrapError, setBootstrapError] = useState("");
  const { isLoaded, isSignedIn, getToken, sessionId } = useClerkAuth();
  const { signOut } = useClerk();
  const userRef = useRef(null);
  const tokenRef = useRef("");
  const bootstrappedSessionIdRef = useRef("");
  const pendingBootstrapRetriesRef = useRef(0);
  // Tracks whether the first bootstrap cycle has finished (success or fail).
  // After the initial bootstrap, refreshSession must NOT toggle
  // sessionRefreshing – doing so flickers isReady back to false, which
  // unmounts AppShell+NavBar and causes severe visual glitching.
  const bootstrapDoneRef = useRef(false);
  // Ref to hold the latest refreshSession so the bootstrap effect doesn't
  // need it in its dependency array (it's an output, not an input).
  const refreshSessionRef = useRef(null);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  const clearLocalAuth = useCallback(() => {
    setToken("");
    setUser(null);
    clearAuthStorage();
    clearTabSessionAuthenticated();
    clearSessionToken();
    setSessionWarningMinutes(0);
    bootstrappedSessionIdRef.current = "";
    pendingBootstrapRetriesRef.current = 0;
    // NOTE: intentionally does NOT clear bootstrapError here — the login
    // page needs to see the error to prevent redirect loops.
  }, []);

  useEffect(() => {
    if (!mismatchedCachedSession) return;
    clearLocalAuth();
    clearTabLoginIntent();
  }, [clearLocalAuth, mismatchedCachedSession]);

  const tryRestoreDemoLegacySession = useCallback(async ({ tenantSlug = "" } = {}) => {
    const resolvedTenantSlug = String(tenantSlug || inferTenantSlugForSessionRequest() || "")
      .trim()
      .toLowerCase();
    if (!resolvedTenantSlug) return false;

    const demoTenant = await isDemoTenantSlug(resolvedTenantSlug);
    if (!demoTenant) return false;

    const candidateToken = String(tokenRef.current || readSessionToken() || "").trim();
    try {
      const payload = await requestJson("/api/auth/session", {
        token: candidateToken,
        headers: { "X-Tenant-Slug": resolvedTenantSlug }
      });
      const normalizedUser = normalizeScopedUserShape({
        ...(payload?.user || {}),
        tenantSlug: String(payload?.tenant?.slug || payload?.user?.tenantSlug || "").trim().toLowerCase()
      });
      if (!normalizedUser) return false;

      const persistedSessionToken = String(payload?.sessionToken || candidateToken || "").trim();
      setUser(normalizedUser);
      setToken(persistedSessionToken);
      writeSessionToken(persistedSessionToken);
      writeAuthToStorage(persistedSessionToken, normalizedUser);
      markTabSessionAuthenticated();
      clearTabLoginIntent();
      setBootstrapError("");
      return true;
    } catch {
      return false;
    }
  }, []);

  const getAuthToken = useCallback(
    async ({ forceRefresh = false } = {}) => {
      if (!isLoaded || !isSignedIn) return "";
      const nextToken = (await getToken(forceRefresh ? { skipCache: true } : undefined)) || "";
      if (nextToken && nextToken !== tokenRef.current) {
        setToken(nextToken);
        writeSessionToken(nextToken);
        writeAuthToStorage(nextToken, normalizeUserShape(userRef.current));
      }
      return nextToken;
    },
    [getToken, isLoaded, isSignedIn]
  );

  const resolveBootstrapToken = useCallback(async () => {
    for (const [index, delayMs] of CLERK_BOOTSTRAP_RETRY_DELAYS_MS.entries()) {
      if (delayMs > 0) {
        await wait(delayMs);
      }
      const nextToken = await getAuthToken({ forceRefresh: index > 0 });
      if (nextToken) return nextToken;
    }
    return "";
  }, [getAuthToken]);

  const refreshSession = useCallback(
    async ({ tenantSlug = "", strictTenantSync = false } = {}) => {
      if (!isLoaded || !isSignedIn) {
        clearLocalAuth();
        if (!bootstrapDoneRef.current) {
          bootstrapDoneRef.current = true;
          setSessionRefreshing(false);
        }
        return null;
      }

      const hasExistingUser = Boolean(
        String(userRef.current?.id || userRef.current?._id || "").trim()
      );
      const resolvedTenantSlug = String(tenantSlug || "").trim().toLowerCase();
      const isTenantScopedRefresh = Boolean(resolvedTenantSlug);
      const isInitialBootstrap = !bootstrapDoneRef.current;
      const clerkToken = await resolveBootstrapToken();
      if (!clerkToken) {
        if (hasExistingUser && !strictTenantSync) {
          markTabSessionAuthenticated();
          if (isInitialBootstrap) {
            bootstrapDoneRef.current = true;
            setSessionRefreshing(false);
          }
          return null;
        }
        throw createPendingClerkTokenError();
      }

      // Only block isReady during the very first bootstrap.  After that,
      // subsequent refreshes (e.g. membership-sync) must NOT toggle
      // sessionRefreshing – otherwise isReady flickers true→false→true,
      // causing the entire AppShell / NavBar tree to unmount and remount.
      if (isInitialBootstrap) setSessionRefreshing(true);
      setToken(clerkToken);
      writeSessionToken(clerkToken);

      try {
        const payload = await requestJson("/api/auth/session", {
          token: clerkToken,
          getToken: ({ forceRefresh = false } = {}) => getAuthToken({ forceRefresh }),
          headers: resolvedTenantSlug ? { "X-Tenant-Slug": resolvedTenantSlug } : {}
        });
        const normalizedUser = normalizeScopedUserShape({
          ...(payload?.user || {}),
          tenantSlug: String(payload?.tenant?.slug || payload?.user?.tenantSlug || "").trim().toLowerCase()
        });
        setUser(normalizedUser);
        writeAuthToStorage(clerkToken, normalizedUser);
        markTabSessionAuthenticated();
        clearTabLoginIntent();
        setBootstrapError("");
        return payload;
      } catch (error) {
        if (error?.status === 401 || error?.status === 403) {
          const preserveCachedSession =
            hasExistingUser && isSignedIn && !isTenantScopedRefresh && !strictTenantSync;
          if (preserveCachedSession) {
            writeAuthToStorage(clerkToken, userRef.current);
            markTabSessionAuthenticated();
            return null;
          }
          // Record the error so login pages can detect this failure and
          // avoid an infinite redirect loop (Clerk is signed in but the
          // API rejected the session).
          const errCode = String(
            error?.payload?.error?.code || error?.code || ""
          ).trim();
          const errMsg = String(
            error?.payload?.error?.message || error?.message || "Session verification failed"
          ).trim();
          setBootstrapError(errCode ? `${errCode}: ${errMsg}` : errMsg);
          clearLocalAuth();
          clearTabSessionAuthenticated();
          clearTabLoginIntent();
          if (strictTenantSync) {
            throw error;
          }
          return null;
        }
        // Network / CORS / API-unreachable error.  If we already have a
        // cached user (e.g. returning visitor, or second refresh after a
        // successful bootstrap), keep the cached auth instead of clearing
        // everything and bouncing the user to the login screen.
        if (hasExistingUser) {
          writeAuthToStorage(clerkToken, userRef.current);
          markTabSessionAuthenticated();
          return null;
        }
        setBootstrapError(
          String(error?.message || "Could not reach the API server").trim()
        );
        throw error;
      } finally {
        if (isInitialBootstrap) {
          bootstrapDoneRef.current = true;
          setSessionRefreshing(false);
        }
      }
    },
    [clearLocalAuth, isLoaded, isSignedIn, resolveBootstrapToken]
  );

  // Keep volatile token storage in sync for Cedar pages that still issue
  // direct fetch() calls with getToken() helpers.  Also pre-emptively
  // refresh the token 30 seconds before it expires so API calls never
  // hit a stale JWT.
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return undefined;
    let active = true;

    const syncToken = async (forceRefresh = false) => {
      try {
        // Pre-emptive refresh: if the current token expires within 30s,
        // force a refresh now instead of waiting for the next interval.
        if (!forceRefresh) {
          const currentToken = tokenRef.current;
          if (currentToken) {
            const expiresAt = getTokenExpiry(currentToken);
            if (expiresAt > 0 && Date.now() >= expiresAt - 30_000) {
              forceRefresh = true;
            }
          }
        }
        await getAuthToken({ forceRefresh });
      } catch {
        // Ignore token refresh failures; request-level code handles auth errors.
      }
    };

    syncToken();
    const intervalId = window.setInterval(() => {
      if (!active) return;
      syncToken();
    }, CLERK_TOKEN_SYNC_INTERVAL_MS);

    const onFocus = () => {
      if (!active) return;
      syncToken(false);
    };
    const onVisibility = () => {
      if (!active) return;
      if (document.visibilityState === "visible") {
        syncToken(false);
      }
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [getAuthToken, isLoaded, isSignedIn]);

  // Keep the ref in sync so the bootstrap effect can call the latest version.
  useEffect(() => {
    refreshSessionRef.current = refreshSession;
  }, [refreshSession]);

  // Bootstrap effect: only depends on Clerk SDK state and sessionId.
  // token/user are OUTPUTS of this effect, not inputs - using refs avoids
  // re-triggering the effect when they change, which was causing cascading
  // re-renders and visual glitching.
  useEffect(() => {
    if (!isLoaded) {
      setSessionRefreshing(true);
      return;
    }

    const tabSessionExists = hasTabSessionAuthenticated();
    const loginIntentExists = hasTabLoginIntent();
    const pathname = typeof window === "undefined" ? "" : window.location.pathname || "";
    const onAuthRoute = isAuthEntryRoute(pathname);

    if (FORCE_RELOGIN_ON_TAB_CLOSE && !isSignedIn && !tabSessionExists && !loginIntentExists && !onAuthRoute) {
      clearLocalAuth();
      bootstrappedSessionIdRef.current = "";
      bootstrapDoneRef.current = true;
      setSessionRefreshing(false);
      return;
    }

    if (!isSignedIn) {
      let active = true;
      const tenantSlug = inferTenantSlugForSessionRequest();
      setSessionRefreshing(true);

      Promise.resolve(tryRestoreDemoLegacySession({ tenantSlug }))
        .then((restored) => {
          if (!active) return;
          if (restored) {
            bootstrapDoneRef.current = true;
            setSessionRefreshing(false);
            return;
          }
          clearLocalAuth();
          bootstrappedSessionIdRef.current = "";
          bootstrapDoneRef.current = true;
          setSessionRefreshing(false);
        })
        .catch(() => {
          if (!active) return;
          clearLocalAuth();
          bootstrappedSessionIdRef.current = "";
          bootstrapDoneRef.current = true;
          setSessionRefreshing(false);
        });

      return () => {
        active = false;
      };
    }

    const hasResolvedUser = Boolean(String(userRef.current?.id || userRef.current?._id || "").trim());
    const hasLocalAuth = Boolean(tokenRef.current || hasResolvedUser);
    if (sessionId && bootstrappedSessionIdRef.current === sessionId && hasLocalAuth) {
      bootstrapDoneRef.current = true;
      setSessionRefreshing(false);
      return;
    }

    let active = true;
    let retryTimer = null;
    const tenantSlug = inferTenantSlugForSessionRequest();
    const bootstrapSession = () => {
      const doRefresh = refreshSessionRef.current;
      if (!doRefresh) return;
      Promise.race([
        Promise.resolve(doRefresh({ tenantSlug })),
        wait(AUTH_BOOTSTRAP_TIMEOUT_MS).then(() => {
          throw createAuthBootstrapTimeoutError();
        })
      ])
        .then(() => {
          if (!active) return;
          pendingBootstrapRetriesRef.current = 0;
          if (sessionId) {
            bootstrappedSessionIdRef.current = sessionId;
          }
        })
        .catch((error) => {
          if (!active) return;
          if (error?.code === "AUTH_TOKEN_PENDING" && pendingBootstrapRetriesRef.current < CLERK_BOOTSTRAP_MAX_RETRIES) {
            pendingBootstrapRetriesRef.current += 1;
            retryTimer = window.setTimeout(() => {
              retryTimer = null;
              bootstrapSession();
            }, 320);
            return;
          }
          const hasExistingUser = Boolean(
            String(userRef.current?.id || userRef.current?._id || "").trim()
          );
          if (error?.code === "AUTH_BOOTSTRAP_TIMEOUT") {
            pendingBootstrapRetriesRef.current = 0;
            if (hasExistingUser) {
              bootstrapDoneRef.current = true;
              setSessionRefreshing(false);
              return;
            }
          }
          if (hasExistingUser && error?.code === "AUTH_TOKEN_PENDING") {
            pendingBootstrapRetriesRef.current = 0;
            bootstrapDoneRef.current = true;
            setSessionRefreshing(false);
            return;
          }
          pendingBootstrapRetriesRef.current = 0;
          clearLocalAuth();
          bootstrappedSessionIdRef.current = "";
          bootstrapDoneRef.current = true;
          setSessionRefreshing(false);
        });
    };

    bootstrapSession();

    return () => {
      active = false;
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [clearLocalAuth, isLoaded, isSignedIn, sessionId, tryRestoreDemoLegacySession]);

  const login = useCallback(
    (nextToken, nextUser) => {
      if (nextToken) {
        const normalized = normalizeScopedUserShape(nextUser, {
          tenantSlug: inferTenantSlugForSessionRequest()
        });
        setToken(nextToken);
        writeSessionToken(nextToken);
        setUser(normalized);
        writeAuthToStorage(nextToken, normalized);
        markTabSessionAuthenticated();
        clearTabLoginIntent();
        return;
      }
      refreshSession({ tenantSlug: inferTenantSlugForSessionRequest() }).catch(() => {});
    },
    [refreshSession]
  );

  const logout = useCallback(async () => {
    clearTabLoginIntent();
    clearLocalAuth();
    try {
      await signOut();
    } catch {
      // no-op
    }
  }, [clearLocalAuth, signOut]);

  const onSessionWarning = useCallback((minutes) => {
    setSessionWarningMinutes(minutes);
  }, []);

  useIdleLogout({
    enabled: Boolean(isLoaded),
    isAuthenticated: Boolean(isSignedIn),
    onLogout: logout,
    onSessionWarning
  });

  const dismissSessionWarning = useCallback(() => {
    setSessionWarningMinutes(0);
  }, []);

  const retryBootstrap = useCallback(() => {
    setBootstrapError("");
    bootstrapDoneRef.current = false;
    bootstrappedSessionIdRef.current = "";
    setSessionRefreshing(true);
    // Force the bootstrap effect to re-run by resetting state that it
    // inspects synchronously.  The effect depends on isLoaded/isSignedIn/
    // sessionId — we cannot change those, but we CAN invoke refreshSession
    // directly here and let the finally-block settle sessionRefreshing.
    const doRefresh = refreshSessionRef.current;
    if (doRefresh) {
      const tenantSlug = inferTenantSlugForSessionRequest();
      Promise.resolve(doRefresh({ tenantSlug }))
        .then(() => {
          if (sessionId) bootstrappedSessionIdRef.current = sessionId;
        })
        .catch(() => {
          // refreshSession already sets bootstrapError internally.
        });
    }
  }, [sessionId]);

  const value = useMemo(
    () => ({
      token,
      user,
      isAuthenticated: Boolean(token || (isSignedIn && user?.id)),
      isReady: Boolean(isLoaded) && !sessionRefreshing,
      authProvider: AUTH_PROVIDER,
      authConfigError: "",
      bootstrapError,
      sessionWarningMinutes,
      dismissSessionWarning,
      login,
      logout,
      getAuthToken,
      refreshSession,
      retryBootstrap,
      setUser: (nextUser) => {
        const normalized = normalizeScopedUserShape(nextUser, {
          tenantSlug: inferTenantSlugForSessionRequest()
        });
        setUser(normalized);
        writeAuthToStorage(token || "", normalized);
      }
    }),
    [bootstrapError, dismissSessionWarning, getAuthToken, isLoaded, login, logout, refreshSession, retryBootstrap, sessionRefreshing, sessionWarningMinutes, token, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function ClerkUnavailableAuthProvider({ children }) {
  const logout = useCallback(() => {
    clearAuthStorage();
  }, []);

  const refreshSession = useCallback(async () => null, []);
  const configError = clerkConfigError();

  const value = useMemo(
    () => ({
      token: "",
      user: null,
      isAuthenticated: false,
      isReady: true,
      authProvider: AUTH_PROVIDER,
      authConfigError: configError,
      bootstrapError: "",
      sessionWarningMinutes: 0,
      dismissSessionWarning: () => {},
      login: () => {},
      logout,
      getAuthToken: async () => "",
      refreshSession,
      retryBootstrap: () => {},
      setUser: () => {}
    }),
    [configError, logout, refreshSession]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function AuthProvider({ children }) {
  if (clerkUiEnabled()) {
    return <ClerkBackedAuthProvider>{children}</ClerkBackedAuthProvider>;
  }
  if (clerkModeRequested()) {
    return <ClerkUnavailableAuthProvider>{children}</ClerkUnavailableAuthProvider>;
  }
  return <LegacyAuthProvider>{children}</LegacyAuthProvider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
