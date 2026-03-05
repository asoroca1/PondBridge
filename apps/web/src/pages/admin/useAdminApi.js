import { useCallback, useMemo } from "react";
import { useParams } from "react-router-dom";
import { requestBlob, requestJson } from "../../lib/http.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { useTenant } from "../../context/TenantContext.jsx";

export default function useAdminApi() {
  const { slug: paramSlug } = useParams();
  const { slug: tenantSlug, tenant } = useTenant();
  const { token } = useAuth();

  const resolveSlug = useCallback((...values) => {
    for (const value of values) {
      const normalized = String(value || "")
        .trim()
        .toLowerCase();
      if (normalized && normalized !== "undefined" && normalized !== "null") {
        return normalized;
      }
    }
    return "";
  }, []);

  const slug = useMemo(() => {
    const fromStorage =
      typeof window !== "undefined" ? String(localStorage.getItem("pondbridgeTenantSlug") || "") : "";
    return resolveSlug(paramSlug, tenantSlug, tenant?.slug, fromStorage);
  }, [paramSlug, resolveSlug, tenant?.slug, tenantSlug]);

  const request = useCallback(
    (path, options = {}) => {
      if (!slug) {
        throw new Error("Unable to resolve tenant context. Refresh and try again.");
      }
      return requestJson(`/api/t/${slug}/admin${path}`, {
        token,
        ...options
      });
    },
    [slug, token]
  );

  const download = useCallback(
    (path) => {
      if (!slug) {
        throw new Error("Unable to resolve tenant context. Refresh and try again.");
      }
      return requestBlob(`/api/t/${slug}/admin${path}`, {
        token
      });
    },
    [slug, token]
  );

  return { slug, token, request, download };
}
