import { useEffect, useState } from "react";
import { Button, Input, Textarea } from "@pondbridge/ui";
import { ModalDialog } from "../../../components/admin/AdminUi.jsx";

const STORAGE_PREFIX = "pondbridgeInviteMessage:";

function storageKey(slug = "") {
  return `${STORAGE_PREFIX}${String(slug || "default").trim().toLowerCase()}`;
}

/**
 * The director's reusable invite wording. Kept per camp in local storage so it
 * survives between batches without needing a server round trip; the server
 * still normalizes whatever is sent.
 */
export function readInviteMessage(slug = "") {
  try {
    const raw = window.localStorage.getItem(storageKey(slug));
    if (!raw) return { subject: "", message: "" };
    const parsed = JSON.parse(raw);
    return {
      subject: String(parsed?.subject || ""),
      message: String(parsed?.message || "")
    };
  } catch {
    return { subject: "", message: "" };
  }
}

function writeInviteMessage(slug = "", value = {}) {
  try {
    window.localStorage.setItem(storageKey(slug), JSON.stringify({
      subject: String(value.subject || ""),
      message: String(value.message || "")
    }));
  } catch {
    // A blocked storage write only costs the saved draft, so carry on.
  }
}

export default function InviteMessageDialog({ open, slug = "", networkName = "", onClose, onSaved }) {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!open) return;
    const stored = readInviteMessage(slug);
    setSubject(stored.subject);
    setMessage(stored.message);
  }, [open, slug]);

  function save() {
    const next = { subject: subject.trim(), message: message.trim() };
    writeInviteMessage(slug, next);
    onSaved?.(next);
    onClose?.();
  }

  function reset() {
    setSubject("");
    setMessage("");
    writeInviteMessage(slug, { subject: "", message: "" });
    onSaved?.({ subject: "", message: "" });
  }

  return (
    <ModalDialog
      open={open}
      title="Invite email"
      description="Write the message every invitation uses. Leave it empty for the default wording."
      onClose={onClose}
      className="director-admin-modal director-admin-modal-wide"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={reset}>Reset to default</Button>
          <Button type="button" onClick={save}>Save message</Button>
        </>
      }
    >
      <div className="pb-invite-message-form">
        <label>
          <span>Subject</span>
          <Input
            value={subject}
            maxLength={140}
            onChange={(event) => setSubject(event.target.value)}
            placeholder={`You are invited to ${networkName || "your camp network"}`}
          />
        </label>
        <label>
          <span>Message</span>
          <Textarea
            value={message}
            rows={8}
            maxLength={2000}
            onChange={(event) => setMessage(event.target.value)}
            placeholder={"Hi {{firstName}},\n\nWe're bringing the camp community together online. Join us!"}
          />
        </label>
        <small className="muted">
          Use <code>{"{{firstName}}"}</code>, <code>{"{{lastName}}"}</code> or <code>{"{{networkName}}"}</code> to
          personalise each invitation. The camp logo, colours and sign-up button are added automatically.
        </small>
      </div>
    </ModalDialog>
  );
}
