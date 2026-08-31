import { createContext, useContext, useMemo } from "react";
import { AUTH_PROVIDER } from "../lib/authMode.js";

export const AuthContext = createContext(null);
const TAB_LOGIN_INTENT_KEY = "pondbridgeTabLoginIntent";

export function noteTabLoginIntent() {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(TAB_LOGIN_INTENT_KEY, "1");
}

export function PublicAuthProvider({ children }) {
  const value = useMemo(
    () => ({
      token: "",
      user: null,
      isAuthenticated: false,
      isReady: true,
      authProvider: AUTH_PROVIDER,
      authConfigError: "",
      bootstrapError: "",
      clerkLoadTimedOut: false,
      sessionWarningMinutes: 0,
      dismissSessionWarning: () => {},
      login: () => {},
      logout: () => {},
      getAuthToken: async () => "",
      refreshSession: async () => null,
      retryBootstrap: () => {},
      setUser: () => {}
    }),
    []
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
