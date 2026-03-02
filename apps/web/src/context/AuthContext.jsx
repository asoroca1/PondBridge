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
const AUTO_LOGOUT_MINUTES = Number(import.meta.env.VITE_AUTO_LOGOUT_MINUTES || 30);
const AUTO_LOGOUT_TIMEOUT_MS =
  Number.isFinite(AUTO_LOGOUT_MINUTES) && AUTO_LOGOUT_MINUTES > 0
    ? AUTO_LOGOUT_MINUTES * 60 * 1000
    : 0;
const CLERK_TOKEN_SYNC_INTERVAL_MS = 45 * 1000;
const CLERK_BOOTSTRAP_RETRY_DELAYS_MS = [0, 160, 420, 900];
const CLERK_BOOTSTRAP_MAX_RETRIES = 4;
const FORCE_RELOGIN_ON_TAB_CLOSE = !["0", "false", "off", "no"].includes(
  String(import.meta.env.VITE_FORCE_LOGOUT_ON_TAB_CLOSE || "false")
    .trim()
    .toLowerCase()
);

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

function wait(ms = 0) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function createPendingClerkTokenError() {
  const error = new Error("Clerk session token is not ready yet.");
  error.code = "AUTH_TOKEN_PENDING";
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

function useIdleLogout({ enabled, isAuthenticated, onLogout }) {
  const timeoutRef = useRef(null);
  const logoutInFlightRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const schedule = useCallback(() => {
    if (!enabled || !isAuthenticated || AUTO_LOGOUT_TIMEOUT_MS <= 0) return;
    clearTimer();
    timeoutRef.current = window.setTimeout(() => {
      if (logoutInFlightRef.current) return;
      logoutInFlightRef.current = true;
      Promise.resolve(onLogout?.()).finally(() => {
        logoutInFlightRef.current = false;
      });
    }, AUTO_LOGOUT_TIMEOUT_MS);
  }, [clearTimer, enabled, isAuthenticated, onLogout]);

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

function LegacyAuthProvider({ children }) {
  const initial = readAuthFromStorage();
  const hydrateLegacySession = !FORCE_RELOGIN_ON_TAB_CLOSE || hasTabSessionAuthenticated();
  const [token, setToken] = useState(hydrateLegacySession ? initial.token : "");
  const [user, setUser] = useState(hydrateLegacySession ? normalizeUserShape(initial.user) : null);
  const bootstrapCompleteRef = useRef(false);

  useEffect(() => {
    function syncFromStorage() {
      if (FORCE_RELOGIN_ON_TAB_CLOSE && !hasTabSessionAuthenticated()) {
        setToken("");
        setUser(null);
        return;
      }
      const next = readAuthFromStorage();
      setToken(next.token || "");
      setUser(normalizeUserShape(next.user));
    }

    window.addEventListener("storage", syncFromStorage);
    window.addEventListener("pondbridge-auth-updated", syncFromStorage);

    return () => {
      window.removeEventListener("storage", syncFromStorage);
      window.removeEventListener("pondbridge-auth-updated", syncFromStorage);
    };
  }, []);

  const login = useCallback((nextToken, nextUser) => {
    const normalized = normalizeUserShape(nextUser);
    setToken(nextToken || "");
    setUser(normalized);
    writeAuthToStorage(nextToken || "", normalized);
    markTabSessionAuthenticated();
    clearTabLoginIntent();
  }, []);

  const logout = useCallback(() => {
    setToken("");
    setUser(null);
    clearAuthStorage();
    clearTabSessionAuthenticated();
    clearTabLoginIntent();
  }, []);

  useIdleLogout({
    enabled: true,
    isAuthenticated: Boolean(token),
    onLogout: logout
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
        const normalizedUser = normalizeUserShape(payload?.user);
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
    if (FORCE_RELOGIN_ON_TAB_CLOSE && !hasTabSessionAuthenticated()) return;

    refreshSession({ tenantSlug: inferTenantSlugForSessionRequest() }).catch(() => {});
  }, [refreshSession]);

  const value = useMemo(
    () => ({
      token,
      user,
      isAuthenticated: Boolean(token || user?.id),
      isReady: true,
      authProvider: "legacy",
      authConfigError: "",
      login,
      logout,
      getAuthToken: async () => token || "",
      refreshSession,
      setUser: (nextUser) => {
        const normalized = normalizeUserShape(nextUser);
        setUser(normalized);
        writeAuthToStorage(token || "", normalized);
      }
    }),
    [login, logout, refreshSession, token, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function ClerkBackedAuthProvider({ children }) {
  // Hydrate cached user from localStorage on mount so returning users
  // see content immediately instead of a blank flash while Clerk loads.
  const cachedAuth = readAuthFromStorage();
  const shouldHydrate = !FORCE_RELOGIN_ON_TAB_CLOSE || hasTabSessionAuthenticated();
  const [token, setToken] = useState("");
  const [user, setUser] = useState(shouldHydrate ? normalizeUserShape(cachedAuth.user) : null);
  const [sessionRefreshing, setSessionRefreshing] = useState(true);
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
    bootstrappedSessionIdRef.current = "";
    pendingBootstrapRetriesRef.current = 0;
  }, []);

  const getAuthToken = useCallback(
    async ({ forceRefresh = false } = {}) => {
      if (!isLoaded || !isSignedIn) return "";
      const nextToken = (await getToken(forceRefresh ? { skipCache: true } : undefined)) || "";
      if (nextToken) {
        setToken(nextToken);
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
    async ({ tenantSlug = "" } = {}) => {
      if (!isLoaded || !isSignedIn) {
        clearLocalAuth();
        if (!bootstrapDoneRef.current) {
          bootstrapDoneRef.current = true;
          setSessionRefreshing(false);
        }
        return null;
      }

      const clerkToken = await resolveBootstrapToken();
      if (!clerkToken) {
        throw createPendingClerkTokenError();
      }

      // Only block isReady during the very first bootstrap.  After that,
      // subsequent refreshes (e.g. membership-sync) must NOT toggle
      // sessionRefreshing – otherwise isReady flickers true→false→true,
      // causing the entire AppShell / NavBar tree to unmount and remount.
      const isInitialBootstrap = !bootstrapDoneRef.current;
      if (isInitialBootstrap) setSessionRefreshing(true);
      setToken(clerkToken);

      try {
        const payload = await requestJson("/api/auth/session", {
          token: clerkToken,
          headers: tenantSlug ? { "X-Tenant-Slug": tenantSlug } : {}
        });
        const normalizedUser = normalizeUserShape({
          ...(payload?.user || {}),
          tenantSlug: String(payload?.tenant?.slug || payload?.user?.tenantSlug || "").trim().toLowerCase()
        });
        setUser(normalizedUser);
        writeAuthToStorage(clerkToken, normalizedUser);
        markTabSessionAuthenticated();
        clearTabLoginIntent();
        return payload;
      } catch (error) {
        if (error?.status === 401 || error?.status === 403) {
          clearLocalAuth();
          clearTabSessionAuthenticated();
          clearTabLoginIntent();
          return null;
        }
        // Network / CORS / API-unreachable error.  If we already have a
        // cached user (e.g. returning visitor, or second refresh after a
        // successful bootstrap), keep the cached auth instead of clearing
        // everything and bouncing the user to the login screen.
        const hasExistingUser = Boolean(
          String(userRef.current?.id || userRef.current?._id || "").trim()
        );
        if (hasExistingUser) {
          writeAuthToStorage(clerkToken, userRef.current);
          markTabSessionAuthenticated();
          return null;
        }
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
  // direct fetch() calls with getToken() helpers.
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return undefined;
    let active = true;

    const syncToken = async (forceRefresh = false) => {
      try {
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
      syncToken(true);
    };
    const onVisibility = () => {
      if (!active) return;
      if (document.visibilityState === "visible") {
        syncToken(true);
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
      clearLocalAuth();
      bootstrappedSessionIdRef.current = "";
      bootstrapDoneRef.current = true;
      setSessionRefreshing(false);
      return;
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
      doRefresh({ tenantSlug })
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
  }, [clearLocalAuth, isLoaded, isSignedIn, sessionId]);

  const login = useCallback(
    (nextToken, nextUser) => {
      if (nextToken) {
        const normalized = normalizeUserShape(nextUser);
        setToken(nextToken);
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

  useIdleLogout({
    enabled: Boolean(isLoaded),
    isAuthenticated: Boolean(isSignedIn),
    onLogout: logout
  });

  const value = useMemo(
    () => ({
      token,
      user,
      isAuthenticated: Boolean(token || user?.id),
      isReady: Boolean(isLoaded) && !sessionRefreshing,
      authProvider: AUTH_PROVIDER,
      authConfigError: "",
      login,
      logout,
      getAuthToken,
      refreshSession,
      setUser: (nextUser) => {
        const normalized = normalizeUserShape(nextUser);
        setUser(normalized);
        writeAuthToStorage(token || "", normalized);
      }
    }),
    [getAuthToken, isLoaded, login, logout, refreshSession, sessionRefreshing, token, user]
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
      login: () => {},
      logout,
      getAuthToken: async () => "",
      refreshSession,
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
