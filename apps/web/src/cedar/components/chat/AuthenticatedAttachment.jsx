import { useEffect, useMemo, useState } from "react";
import { Paperclip } from "lucide-react";
import { API_BASE } from "../../lib/api.js";
import { authHeaders } from "../../lib/helpers.js";
import StreamVideo from "../StreamVideo.jsx";

function isVideoAttachment(media) {
  return String(media?.mime || "").toLowerCase().startsWith("video/");
}

export default function AuthenticatedAttachment({
  media = {},
  kind = "file",
  scope = "conversation",
  resourceId = "",
  messageId = ""
}) {
  const [resolvedUrl, setResolvedUrl] = useState(() => (media?.key ? "" : String(media?.url || "")));
  const [error, setError] = useState("");
  const [playbackUrl, setPlaybackUrl] = useState("");
  const [playbackState, setPlaybackState] = useState("idle");
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

  // Playback needs a token the API only issues after re-running the same access
  // checks as the download above; the token expires, so it is refreshed well
  // inside its hour.
  useEffect(() => {
    const id = String(resourceId || "").trim();
    const key = String(media?.key || "").trim();
    const owner = String(messageId || "").trim();
    if (!isVideoAttachment(media) || !id || !key || !owner || !media?.streamUid) {
      setPlaybackUrl("");
      setPlaybackState("idle");
      return undefined;
    }

    const controller = new AbortController();
    const base =
      scope === "forum"
        ? `${API_BASE}/forums/${encodeURIComponent(id)}/attachments/stream-token`
        : `${API_BASE}/conversations/${encodeURIComponent(id)}/attachments/stream-token`;
    const ownerParam = scope === "forum" ? "postId" : "messageId";

    async function resolveToken() {
      try {
        const response = await fetch(
          `${base}?key=${encodeURIComponent(key)}&${ownerParam}=${encodeURIComponent(owner)}`,
          { headers: authHeaders(), signal: controller.signal }
        );
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.manifestUrl) {
          // 409 means the encode has not finished; anything else means this
          // clip will never play inline, and the download link stands.
          setPlaybackState(response.status === 409 ? "pending" : "unavailable");
          setPlaybackUrl("");
          return;
        }
        setPlaybackUrl(payload.manifestUrl);
        setPlaybackState("ready");
      } catch (tokenError) {
        if (tokenError?.name === "AbortError") return;
        setPlaybackState("unavailable");
        setPlaybackUrl("");
      }
    }

    void resolveToken();
    const refreshTimer = window.setInterval(resolveToken, 45 * 60 * 1000);
    return () => {
      controller.abort();
      window.clearInterval(refreshTimer);
    };
  }, [media, messageId, resourceId, scope]);

  if (error) return <span className="cf-attachment-error" role="status">{error}</span>;
  if (!resolvedUrl) return <span className="cf-attachment-loading" role="status">Preparing attachment…</span>;

  // A clip plays inline once Stream has re-encoded it. Until then -- and if the
  // encode failed -- it stays the download link it has always been, which works
  // on every platform even when the browser cannot decode the file.
  if (isVideoAttachment(media)) {
    if (playbackUrl) {
      return <StreamVideo className="cf-attachment-video" hlsUrl={playbackUrl} controls />;
    }
    if (playbackState === "pending") {
      return <span className="cf-attachment-loading" role="status">Preparing video…</span>;
    }
  }

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
