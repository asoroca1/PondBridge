import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAuth as useClerkAuth, useClerk } from "@clerk/clerk-react";
import { clearAuthStorage, readAuthFromStorage, writeAuthToStorage } from "../lib/storage.js";
import { requestJson } from "../lib/http.js";
import {
  AUTH_PROVIDER,
  clerkConfigError,
  clerkModeRequested,
  clerkUiEnabled
} from "../lib/authMode.js";

const AuthContext = createContext(null);

const IDLE_EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"];
const TAB_ID_KEY = "pondbridgeActiveTabId";
const ACTIVE_TABS_KEY = "pondbridgeActiveTabs";
const FORCE_RELOGIN_KEY = "pondbridgeForceReloginOnOpen";
const TAB_HEARTBEAT_MS = 15000;
const TAB_STALE_MS = 120000;
const AUTO_LOGOUT_MINUTES = Number(import.meta.env.VITE_AUTO_LOGOUT_MINUTES || 30);
const AUTO_LOGOUT_TIMEOUT_MS =
  Number.isFinite(AUTO_LOGOUT_MINUTES) && AUTO_LOGOUT_MINUTES > 0
    ? AUTO_LOGOUT_MINUTES * 60 * 1000
    : 0;
const FORCE_RELOGIN_ON_TAB_CLOSE = !["0", "false", "off", "no"].includes(
  String(import.meta.env.VITE_FORCE_LOGOUT_ON_TAB_CLOSE || "true")
    .trim()
    .toLowerCase()
);

function createTabId() {
  return `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function parseJson(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function readActiveTabs() {
  if (typeof window === "undefined") return {};
  const now = Date.now();
  const tabs = parseJson(window.localStorage.getItem(ACTIVE_TABS_KEY), {});
  const next = {};
  for (const [id, seenAt] of Object.entries(tabs || {})) {
    const time = Number(seenAt || 0);
    if (Number.isFinite(time) && now - time <= TAB_STALE_MS) {
      next[id] = time;
    }
  }
  return next;
}

function writeActiveTabs(tabs) {
  if (typeof window === "undefined") return;
  const entries = Object.entries(tabs || {});
  if (!entries.length) {
    window.localStorage.removeItem(ACTIVE_TABS_KEY);
    return;
  }
  window.localStorage.setItem(ACTIVE_TABS_KEY, JSON.stringify(Object.fromEntries(entries)));
}

function useTabCloseRelogin({ enabled, ready, isAuthenticated, onLogout }) {
  const isFreshTabRef = useRef(false);
  const forcedRef = useRef(false);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return undefined;

    const existingTabId = window.sessionStorage.getItem(TAB_ID_KEY);
    isFreshTabRef.current = !existingTabId;
    const tabId = existingTabId || createTabId();
    if (!existingTabId) {
      window.sessionStorage.setItem(TAB_ID_KEY, tabId);
    }

    const heartbeat = () => {
      const tabs = readActiveTabs();
      tabs[tabId] = Date.now();
      writeActiveTabs(tabs);
    };

    let closed = false;
    const markClosed = () => {
      if (closed) return;
      closed = true;
      const tabs = readActiveTabs();
      delete tabs[tabId];
      const remaining = Object.keys(tabs).length;
      writeActiveTabs(tabs);
      if (remaining === 0) {
        window.localStorage.setItem(FORCE_RELOGIN_KEY, "1");
      }
    };

    heartbeat();
    const intervalId = window.setInterval(heartbeat, TAB_HEARTBEAT_MS);
    window.addEventListener("pagehide", markClosed);
    window.addEventListener("beforeunload", markClosed);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("pagehide", markClosed);
      window.removeEventListener("beforeunload", markClosed);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !ready || typeof window === "undefined" || forcedRef.current) return;

    const shouldForce = window.localStorage.getItem(FORCE_RELOGIN_KEY) === "1";
    if (!shouldForce) return;

    if (!isFreshTabRef.current) {
      window.localStorage.removeItem(FORCE_RELOGIN_KEY);
      return;
    }

    forcedRef.current = true;
    Promise.resolve(isAuthenticated ? onLogout?.() : null).finally(() => {
      window.localStorage.removeItem(FORCE_RELOGIN_KEY);
    });
  }, [enabled, isAuthenticated, onLogout, ready]);
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
  return {
    ...user,
    id,
    _id: id,
    roles: Array.isArray(user.roles) ? user.roles : []
  };
}

function LegacyAuthProvider({ children }) {
  const initial = readAuthFromStorage();
  const [token, setToken] = useState(initial.token);
  const [user, setUser] = useState(normalizeUserShape(initial.user));

  useEffect(() => {
    function syncFromStorage() {
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
  }, []);

  const logout = useCallback(() => {
    setToken("");
    setUser(null);
    clearAuthStorage();
  }, []);

  useTabCloseRelogin({
    enabled: FORCE_RELOGIN_ON_TAB_CLOSE,
    ready: true,
    isAuthenticated: Boolean(token),
    onLogout: logout
  });

  useIdleLogout({
    enabled: true,
    isAuthenticated: Boolean(token),
    onLogout: logout
  });

  const refreshSession = useCallback(async () => {
    return {
      ok: Boolean(token),
      authProvider: "legacy",
      user
    };
  }, [token, user]);

  const value = useMemo(
    () => ({
      token,
      user,
      isAuthenticated: Boolean(token),
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
  const [token, setToken] = useState("");
  const [user, setUser] = useState(null);
  const [sessionRefreshing, setSessionRefreshing] = useState(true);
  const { isLoaded, isSignedIn, getToken } = useClerkAuth();
  const { signOut } = useClerk();

  const clearLocalAuth = useCallback(() => {
    setToken("");
    setUser(null);
    clearAuthStorage();
  }, []);

  const getAuthToken = useCallback(
    async ({ forceRefresh = false } = {}) => {
      if (!isLoaded || !isSignedIn) return "";
      const nextToken = (await getToken(forceRefresh ? { skipCache: true } : undefined)) || "";
      if (nextToken) {
        setToken(nextToken);
      }
      return nextToken;
    },
    [getToken, isLoaded, isSignedIn]
  );

  const refreshSession = useCallback(
    async ({ tenantSlug = "" } = {}) => {
      if (!isLoaded || !isSignedIn) {
        clearLocalAuth();
        setSessionRefreshing(false);
        return null;
      }

      const clerkToken = await getAuthToken({ forceRefresh: true });
      if (!clerkToken) {
        clearLocalAuth();
        setSessionRefreshing(false);
        return null;
      }

      setSessionRefreshing(true);
      setToken(clerkToken);

      try {
        const payload = await requestJson("/api/auth/session", {
          token: clerkToken,
          headers: tenantSlug ? { "X-Tenant-Slug": tenantSlug } : {}
        });
        const normalizedUser = normalizeUserShape(payload?.user);
        setUser(normalizedUser);
        writeAuthToStorage(clerkToken, normalizedUser);
        return payload;
      } catch (error) {
        if (error?.status === 401 || error?.status === 403) {
          writeAuthToStorage(clerkToken, null);
          setUser(null);
          return null;
        }
        throw error;
      } finally {
        setSessionRefreshing(false);
      }
    },
    [clearLocalAuth, getAuthToken, isLoaded, isSignedIn]
  );

  useEffect(() => {
    if (!isLoaded) {
      setSessionRefreshing(true);
      return;
    }
    if (!isSignedIn) {
      clearLocalAuth();
      setSessionRefreshing(false);
      return;
    }

    let active = true;
    refreshSession()
      .then(() => {
        if (!active) return;
      })
      .catch(() => {
        if (!active) return;
        clearLocalAuth();
        setSessionRefreshing(false);
      });

    return () => {
      active = false;
    };
  }, [clearLocalAuth, isLoaded, isSignedIn, refreshSession]);

  const login = useCallback(
    (nextToken, nextUser) => {
      if (nextToken) {
        const normalized = normalizeUserShape(nextUser);
        setToken(nextToken);
        setUser(normalized);
        writeAuthToStorage(nextToken, normalized);
        return;
      }
      refreshSession().catch(() => {});
    },
    [refreshSession]
  );

  const logout = useCallback(async () => {
    clearLocalAuth();
    try {
      await signOut();
    } catch {
      // no-op
    }
  }, [clearLocalAuth, signOut]);

  useTabCloseRelogin({
    enabled: FORCE_RELOGIN_ON_TAB_CLOSE,
    ready: Boolean(isLoaded),
    isAuthenticated: Boolean(isSignedIn),
    onLogout: logout
  });

  useIdleLogout({
    enabled: Boolean(isLoaded),
    isAuthenticated: Boolean(isSignedIn),
    onLogout: logout
  });

  const value = useMemo(
    () => ({
      token,
      user,
      isAuthenticated: Boolean(token),
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
