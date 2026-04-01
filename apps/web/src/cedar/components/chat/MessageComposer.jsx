// src/components/chat/MessageComposer.jsx
import { useEffect, useRef, useState } from "react";
import { Image as ImageIcon, Paperclip, Send, X } from "lucide-react";

export default function MessageComposer({
  onSend,
  onPresign,
  labelOverride,
  onTypingStart,
  onTypingStop,
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  // Pending attachment (preview before upload)
  const [attach, setAttach] = useState(
    /** @type {null | { kind: "image"|"file", file: File, previewUrl?: string }} */ (null)
  );

  const fileRef = useRef(null);
  const typingTimerRef = useRef(null);

  // Clean up object URLs
  useEffect(() => {
    return () => {
      if (attach?.previewUrl) URL.revokeObjectURL(attach.previewUrl);
    };
  }, [attach?.previewUrl]);

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

      // Make/replace preview; don't upload yet
      setAttach((prev) => {
        if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
        const next = {
          kind: kind === "image" ? "image" : "file",
          file: f,
          previewUrl: kind === "image" ? URL.createObjectURL(f) : undefined,
        };
        return next;
      });

      input.value = "";
    };
    input.click();
  }

  function removeAttachment() {
    setAttach((prev) => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
  }

  async function uploadAndSendAttachment() {
    if (!attach || busy) return;

    const f = attach.file;
    const kind = attach.kind;

    // 1) Ask server for presign
    const presigned = await onPresign?.(f);
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
    await onSend?.({
      kind,
      media: {
        url: objectUrl,
        key,              // keep for deletion/cleanup
        mime: f.type,
        name: f.name,
        size: f.size,
      },
    });

    // 4) Clear local preview
    removeAttachment();
  }

  async function submit() {
    const hasText = !!text.trim();
    const hasAttach = !!attach;
    if ((!hasText && !hasAttach) || busy) return;

    setBusy(true);
    try {
      // If there is an attachment, upload & send it first
      if (hasAttach) {
        await uploadAndSendAttachment();
      }
      // Then send the text (if provided)
      if (hasText) {
        await onSend?.({ kind: "text", text: text.trim() });
        setText("");
      }
    } catch (e) {
      console.error(e);
      // Optionally: alert("Upload failed. Please try again.");
    } finally {
      setBusy(false);
      clearTyping();
    }
  }

  const canSend = (!!text.trim() || !!attach) && !busy;

  return (
    <div className="mc-wrap">
      <button
        className="mc-icon"
        title="Add image"
        onClick={() => openPicker("image")}
        disabled={busy}
        aria-label="Add image"
      >
        <ImageIcon size={18} />
      </button>

      <button
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
          pingTyping();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
            return;
          }
          pingTyping();
        }}
        onBlur={clearTyping}
        rows={1}
        disabled={busy}
      />

      <button
        className="mc-send"
        onClick={submit}
        disabled={!canSend}
        aria-disabled={!canSend}
      >
        <Send size={16} />
        <span>{labelOverride || "Send"}</span>
      </button>

      <input ref={fileRef} type="file" style={{ display: "none" }} />
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
