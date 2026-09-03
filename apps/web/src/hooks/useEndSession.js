import { useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { requestJson } from "../lib/http.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useTenant } from "../context/TenantContext.jsx";
import { isNativeApp } from "../lib/nativeApp.js";
import { pathWithCamp } from "./useMemberNav.js";

/**
 * Ending the session is offered from both the header dropdown and the sidebar,
 * so the API call, the local auth clear and the landing route all live here
 * rather than being copied into whichever nav happens to be on screen.
 */
export function useEndSession({ onBeforeNavigate } = {}) {
  const params = useParams();
  const { slug: contextSlug, tenant } = useTenant();
  const slug = params.slug || contextSlug || "cedar";
  const { token, logout } = useAuth();
  const navigate = useNavigate();

  const nativeApp = isNativeApp();
  const demoAccessEnabled = Boolean(tenant?.accessSettings?.demoAccessEnabled);
  const rememberedTenantSlug =
    typeof window !== "undefined"
      ? String(localStorage.getItem("pondbridgeTenantSlug") || "").trim().toLowerCase()
      : "";
  const loggedOutLandingPath = nativeApp
    ? pathWithCamp(rememberedTenantSlug || slug, "/login")
    : pathWithCamp(slug, demoAccessEnabled ? "/" : "/login");

  return useCallback(
    async function endSession({ forgetCamp = false } = {}) {
      const raceTimeout = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
      try {
        // Race against a timeout so logout doesn't hang when the API is
        // unreachable (CORS / network failure, especially on Safari).
        await Promise.race([
          requestJson(`/api/t/${slug}/auth/logout`, { method: "POST", token }),
          raceTimeout(2200)
        ]);
      } catch {
        // No-op: clear local auth regardless.
      } finally {
        onBeforeNavigate?.();
        logout();
        if (forgetCamp && typeof window !== "undefined") {
          try {
            window.localStorage.removeItem("pondbridgeTenantSlug");
          } catch {
            // Ignore storage failures and still return to the app entry route.
          }
        }
        navigate(forgetCamp ? "/" : loggedOutLandingPath, { replace: true });
      }
    },
    [slug, token, logout, navigate, loggedOutLandingPath, onBeforeNavigate]
  );
}
