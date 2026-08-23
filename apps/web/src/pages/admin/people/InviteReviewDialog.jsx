import { useEffect, useState } from "react";
import { Button } from "@pondbridge/ui";
import { ModalDialog } from "../../../components/admin/AdminUi.jsx";

/**
 * Invitations always pass through a server-validated review: the preview call
 * reports who is genuinely ready, who already has a pending invite, who has
 * joined, and who is on hold. Nothing sends until the director confirms.
 */
export default function InviteReviewDialog({ open, people = [], extras = {}, actions, onClose, onSent }) {
  const [preview, setPreview] = useState(null);
  const [recipients, setRecipients] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !people.length) return undefined;
    let active = true;
    setLoading(true);
    setError("");
    setPreview(null);
    actions.previewInvites(people)
      .then((result) => {
        if (!active) return;
        setPreview(result.preview);
        setRecipients(result.recipients);
      })
      .catch((requestError) => {
        if (active) setError(requestError.message || "Could not prepare the invitation review.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [actions, open, people]);

  const summary = preview?.summary || {};
  const readyCount = Number(summary.readyCount || 0);

  async function send() {
    const result = await actions.sendInvites(recipients, preview?.previewToken || "", extras);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onSent?.(result.message);
    onClose?.();
  }

  return (
    <ModalDialog
      open={open}
      title="Review invitations"
      description="Nothing is sent until you confirm this list."
      onClose={actions.busy ? undefined : onClose}
      className="director-admin-modal director-admin-modal-wide"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={Boolean(actions.busy)}>
            Keep reviewing
          </Button>
          <Button
            type="button"
            onClick={send}
            loading={actions.busy === "invite"}
            disabled={loading || readyCount === 0}
          >
            Send {readyCount} invitation{readyCount === 1 ? "" : "s"}
          </Button>
        </>
      }
    >
      {loading ? <p className="muted">Checking this audience…</p> : null}
      {error ? <p className="error-text" role="alert">{error}</p> : null}

      {preview ? (
        <>
          <div className="pb-people-invite-summary">
            <div className="is-ready"><strong>{readyCount}</strong><span>ready to invite</span></div>
            <div><strong>{summary.pendingInviteCount || 0}</strong><span>already pending</span></div>
            <div><strong>{summary.existingMemberCount || 0}</strong><span>already joined</span></div>
            <div><strong>{summary.contactOnHoldCount || 0}</strong><span>on hold</span></div>
          </div>
          {readyCount === 0 ? (
            <p className="muted">Nobody in this selection can be invited right now.</p>
          ) : null}
          <ul className="pb-people-invite-list">
            {(preview.items || []).slice(0, 12).map((item) => (
              <li key={item.email}>
                <span>{item.firstName || item.email}</span>
                <small>{String(item.status || "unknown").replaceAll("_", " ")}</small>
              </li>
            ))}
          </ul>
          {(preview.items || []).length > 12 ? (
            <p className="muted">…and {preview.items.length - 12} more.</p>
          ) : null}
        </>
      ) : null}
    </ModalDialog>
  );
}
