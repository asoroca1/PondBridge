// src/components/chat/MessageComposer.jsx
import { useEffect, useRef, useState } from "react";
import { Image as ImageIcon, Paperclip, Send, X } from "lucide-react";

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const ATTACHMENT_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);

const MIME_BY_EXTENSION = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

function attachmentMime(file) {
  const provided = String(file?.type || "").trim().toLowerCase();
  if (provided) return provided;
  const extension = String(file?.name || "").split(".").pop()?.toLowerCase();
  return MIME_BY_EXTENSION[extension] || "";
}

function createClientRequestId() {
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(12);
    globalThis.crypto.getRandomValues(bytes);
    return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`.slice(0, 24).padEnd(24, "0");
}

function draftStorageKey(draftKey = "") {
  const key = String(draftKey || "").trim();
  return key ? `pondbridge:message-draft:${key}` : "";
}

function readDraft(draftKey = "", maxLength = 4000) {
  const key = draftStorageKey(draftKey);
  if (!key) return "";
  try {
    return String(localStorage.getItem(key) || "").slice(0, maxLength);
  } catch {
    return "";
  }
}

function writeDraft(draftKey = "", value = "", maxLength = 4000) {
  const key = draftStorageKey(draftKey);
  if (!key) return;
  try {
    const text = String(value || "").slice(0, maxLength);
    if (text) localStorage.setItem(key, text);
    else localStorage.removeItem(key);
  } catch {
    // Draft persistence is a convenience; storage restrictions must not block messaging.
  }
}

export default function MessageComposer({
  onSend,
  onPresign,
  labelOverride,
  draftKey,
  maxLength = 4000,
  onTypingStart,
  onTypingStop,
}) {
  const [text, setText] = useState(() => readDraft(draftKey, maxLength));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Pending attachment (preview before upload)
  const [attach, setAttach] = useState(
    /** @type {null | { kind: "image"|"file", file: File, mime: string, previewUrl?: string }} */ (null)
  );

  const fileRef = useRef(null);
  const typingTimerRef = useRef(null);
  const typingStopRef = useRef(onTypingStop);
  const textRequestIdRef = useRef("");
  const attachmentRequestIdRef = useRef("");
  typingStopRef.current = onTypingStop;

  // Clean up object URLs
  useEffect(() => {
    return () => {
      if (attach?.previewUrl) URL.revokeObjectURL(attach.previewUrl);
    };
  }, [attach?.previewUrl]);

  useEffect(() => {
    return () => {
      clearTimeout(typingTimerRef.current);
      typingStopRef.current?.();
    };
  }, []);

  function pingTyping() {
    if (onTypingStart) onTypingStart();
    clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      if (onTypingStop) onTypingStop();
    }, 1200);
  }

  function clearTyping() {
    clearTimeout(typingTimerRef.current);
    onTypingStop?.();
  }

  function openPicker(kind) {
    const input = fileRef.current;
    if (!input || busy) return;
    input.accept = kind === "image" ? "image/*" : "*/*";
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return;
      const mime = attachmentMime(f);

      if (f.size > MAX_ATTACHMENT_BYTES) {
        setError("Attachment must be 20 MB or smaller.");
        input.value = "";
        return;
      }
      if (!ATTACHMENT_MIME_TYPES.has(mime) || (kind === "image" && !mime.startsWith("image/"))) {
        setError(
          kind === "image"
            ? "Choose a JPG, PNG, GIF, WebP, HEIC, or HEIF image."
            : "Choose an image, PDF, document, spreadsheet, presentation, text, CSV, or video file."
        );
        input.value = "";
        return;
      }

      // Make/replace preview; don't upload yet
      setAttach((prev) => {
        if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
        const next = {
          kind: kind === "image" ? "image" : "file",
          file: f,
          mime,
          previewUrl: kind === "image" ? URL.createObjectURL(f) : undefined,
        };
        return next;
      });
      attachmentRequestIdRef.current = "";

      input.value = "";
    };
    input.click();
  }

  function removeAttachment() {
    setAttach((prev) => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
    attachmentRequestIdRef.current = "";
  }

  async function uploadAndSendAttachment() {
    if (!attach || busy) return;

    const f = attach.file;
    const kind = attach.kind;

    // 1) Ask server for presign
    const presigned = await onPresign?.(f, { kind, mime: attach.mime });
    if (presigned?.error) {
      throw new Error(presigned.error?.message || presigned.error || "Unable to prepare this attachment.");
    }
    const { uploadUrl, objectUrl, headers, key } = presigned || {};
    if (!uploadUrl || !objectUrl) {
      throw new Error("Missing presign data");
    }

    // 2) PUT to S3 — only send headers if the server returned them
    const init = { method: "PUT", body: f };
    if (headers && typeof headers === "object") {
      init.headers = headers;
    }
    const putRes = await fetch(uploadUrl, init);
    if (!putRes.ok) {
      const errText = await putRes.text().catch(() => "");
      console.error("S3 PUT failed:", putRes.status, errText);
      throw new Error(`S3 upload failed (${putRes.status})`);
    }

    // 3) Send message referencing uploaded object
    const clientRequestId = attachmentRequestIdRef.current || createClientRequestId();
    attachmentRequestIdRef.current = clientRequestId;
    await onSend?.({
      kind,
      clientRequestId,
      media: {
        url: objectUrl,
        key,              // keep for deletion/cleanup
        mime: attach.mime,
        name: f.name,
        size: f.size,
      },
    });
    attachmentRequestIdRef.current = "";

    // 4) Clear local preview
    removeAttachment();
  }

  async function submit() {
    const hasText = !!text.trim();
    const hasAttach = !!attach;
    if ((!hasText && !hasAttach) || busy) return;

    setBusy(true);
    setError("");
    try {
      // If there is an attachment, upload & send it first
      if (hasAttach) {
        await uploadAndSendAttachment();
      }
      // Then send the text (if provided)
      if (hasText) {
        const clientRequestId = textRequestIdRef.current || createClientRequestId();
        textRequestIdRef.current = clientRequestId;
        await onSend?.({ kind: "text", text: text.trim(), clientRequestId });
        textRequestIdRef.current = "";
        setText("");
        writeDraft(draftKey, "", maxLength);
      }
    } catch (e) {
      console.error(e);
      setError(String(e?.message || "Unable to send this message. Please try again."));
    } finally {
      setBusy(false);
      clearTyping();
    }
  }

  const canSend = (!!text.trim() || !!attach) && !busy;

  return (
    <div className="mc-wrap">
      {error ? <div className="mc-error" role="alert">{error}</div> : null}
      <button
        type="button"
        className="mc-icon"
        title="Add image"
        onClick={() => openPicker("image")}
        disabled={busy}
        aria-label="Add image"
      >
        <ImageIcon size={18} />
      </button>

      <button
        type="button"
        className="mc-icon"
        title="Add file"
        onClick={() => openPicker("file")}
        disabled={busy}
        aria-label="Add file"
      >
        <Paperclip size={18} />
      </button>

      {/* Pending attachment preview */}
      {attach && (
        <div className="mc-attach" aria-label="Pending attachment">
          {attach.kind === "image" && attach.previewUrl ? (
            <div className="mc-attach-thumb">
              <img src={attach.previewUrl} alt="Image preview" />
            </div>
          ) : (
            <div className="mc-attach-name" title={attach.file.name}>
              <Paperclip size={14} />
              <span>{attach.file.name}</span>
            </div>
          )}
          <button
            type="button"
            className="mc-attach-remove"
            onClick={removeAttachment}
            title="Remove attachment"
            aria-label="Remove attachment"
            disabled={busy}
          >
            <X size={14} />
          </button>
        </div>
      )}

      <textarea
        className="mc-input"
        placeholder={
          labelOverride ? `Write a ${labelOverride.toLowerCase()}…` : "Write a message…"
        }
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          writeDraft(draftKey, e.target.value, maxLength);
          textRequestIdRef.current = "";
          setError("");
          pingTyping();
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent?.isComposing || e.isComposing) return;
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        onBlur={clearTyping}
        rows={1}
        maxLength={maxLength}
        disabled={busy}
        aria-label={labelOverride ? `Write a ${labelOverride.toLowerCase()}` : "Write a message"}
      />

      {maxLength - text.length <= 500 ? (
        <span className="mc-count" aria-live="polite">{maxLength - text.length} characters left</span>
      ) : null}

      <button
        type="button"
        className="mc-send"
        onClick={submit}
        disabled={!canSend}
        aria-disabled={!canSend}
        aria-label={busy ? "Sending message" : labelOverride || "Send message"}
      >
        <Send size={16} />
        <span>{labelOverride || "Send"}</span>
      </button>

      <input ref={fileRef} type="file" style={{ display: "none" }} tabIndex={-1} aria-hidden="true" />
      {/* Quick inline styles for the preview; you can move into chats.css */}
      <style>{`
        .mc-attach {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          margin: 0 8px;
          padding: 4px;
          border: 1px solid rgba(0,0,0,0.08);
          border-radius: 8px;
          background: rgba(0,0,0,0.03);
        }
        .mc-attach-thumb {
          width: 40px;
          height: 40px;
          border-radius: 6px;
          overflow: hidden;
          flex: 0 0 auto;
        }
        .mc-attach-thumb img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .mc-attach-name {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          max-width: 240px;
          white-space: nowrap;
          text-overflow: ellipsis;
          overflow: hidden;
          font-size: 13px;
        }
        .mc-attach-remove {
          border: none;
          background: transparent;
          cursor: pointer;
          padding: 4px;
          line-height: 0;
          border-radius: 6px;
        }
        .mc-attach-remove:hover {
          background: rgba(0,0,0,0.06);
        }
      `}</style>
    </div>
  );
}
