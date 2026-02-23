import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { clearAuthStorage, readAuthFromStorage, writeAuthToStorage } from "../lib/storage.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const initial = readAuthFromStorage();
  const [token, setToken] = useState(initial.token);
  const [user, setUser] = useState(initial.user);

  useEffect(() => {
    function syncFromStorage() {
      const next = readAuthFromStorage();
      setToken(next.token || "");
      setUser(next.user || null);
    }

    window.addEventListener("storage", syncFromStorage);
    window.addEventListener("pondbridge-auth-updated", syncFromStorage);

    return () => {
      window.removeEventListener("storage", syncFromStorage);
      window.removeEventListener("pondbridge-auth-updated", syncFromStorage);
    };
  }, []);

  const login = (nextToken, nextUser) => {
    setToken(nextToken);
    setUser(nextUser);
    writeAuthToStorage(nextToken, nextUser);
  };

  const logout = () => {
    setToken("");
    setUser(null);
    clearAuthStorage();
  };

  const value = useMemo(
    () => ({
      token,
      user,
      isAuthenticated: Boolean(token),
      login,
      logout,
      setUser
    }),
    [token, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
