import { useEffect, useMemo, useState } from "react";
import { Paperclip } from "lucide-react";
import { API_BASE } from "../../lib/api.js";
import { authHeaders } from "../../lib/helpers.js";

export default function AuthenticatedAttachment({
  media = {},
  kind = "file",
  scope = "conversation",
  resourceId = ""
}) {
  const [resolvedUrl, setResolvedUrl] = useState(() => (media?.key ? "" : String(media?.url || "")));
  const [error, setError] = useState("");
  const accessUrl = useMemo(() => {
    const id = String(resourceId || "").trim();
    const key = String(media?.key || "").trim();
    if (!id || !key) return "";
    const base =
      scope === "forum"
        ? `${API_BASE}/forums/${encodeURIComponent(id)}/attachments/object`
        : `${API_BASE}/conversations/${encodeURIComponent(id)}/attachments/object`;
    return `${base}?key=${encodeURIComponent(key)}`;
  }, [media?.key, resourceId, scope]);

  useEffect(() => {
    if (!accessUrl) {
      setResolvedUrl(String(media?.url || ""));
      setError("");
      return undefined;
    }

    const controller = new AbortController();
    async function resolveAccess() {
      try {
        const response = await fetch(accessUrl, {
          headers: authHeaders(),
          signal: controller.signal
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.downloadUrl) {
          throw new Error(payload?.error?.message || "Attachment is unavailable.");
        }
        setResolvedUrl(payload.downloadUrl);
        setError("");
      } catch (requestError) {
        if (requestError?.name === "AbortError") return;
        setResolvedUrl("");
        setError(requestError?.message || "Attachment is unavailable.");
      }
    }

    void resolveAccess();
    const refreshTimer = window.setInterval(resolveAccess, 8 * 60 * 1000);
    return () => {
      controller.abort();
      window.clearInterval(refreshTimer);
    };
  }, [accessUrl, media?.url]);

  if (error) return <span className="cf-attachment-error" role="status">{error}</span>;
  if (!resolvedUrl) return <span className="cf-attachment-loading" role="status">Preparing attachment…</span>;

  if (kind === "image") {
    return (
      <a href={resolvedUrl} target="_blank" rel="noreferrer">
        <img
          src={resolvedUrl}
          alt={media?.name || "Image attachment"}
          loading="lazy"
          decoding="async"
        />
      </a>
    );
  }

  return (
    <>
      <Paperclip size={16} aria-hidden="true" />
      <a href={resolvedUrl} target="_blank" rel="noreferrer">
        {media?.name || "File attachment"}
      </a>
    </>
  );
}
