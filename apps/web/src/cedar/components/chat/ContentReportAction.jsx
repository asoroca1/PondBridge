import { useState } from "react";
import { ModalDialog } from "../../../components/admin/AdminUi.jsx";
import { API_BASE } from "../../lib/api.js";
import { authHeaders } from "../../lib/helpers.js";

function errorMessage(payload, fallback) {
  return payload?.error?.message || payload?.error || payload?.message || fallback;
}

export default function ContentReportAction({ targetType, targetId, label = "Report" }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("harassment");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  async function submit() {
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch(`${API_BASE}/safety/reports`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ targetType, targetId, reason, details })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorMessage(payload, "Unable to submit this report."));
      setStatus(payload?.message || "Report submitted.");
      setDetails("");
      setOpen(false);
    } catch (requestError) {
      setStatus(requestError.message || "Unable to submit this report.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <span>
        <button type="button" className="cf-report-btn" onClick={() => setOpen(true)}>
          {label}
        </button>
        {status ? <span className="cf-report-status" role="status">{status}</span> : null}
      </span>
      <ModalDialog
        open={open}
        title="Report this content"
        description="This report goes to the camp's directors. The author will not be told who submitted it."
        onClose={busy ? undefined : () => setOpen(false)}
        footer={
          <>
            <button type="button" className="link-button secondary" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="link-button is-danger" onClick={submit} disabled={busy}>
              {busy ? "Submitting..." : "Submit report"}
            </button>
          </>
        }
      >
        <div className="cf-report-form">
          <label>
            Reason
            <select value={reason} onChange={(event) => setReason(event.target.value)}>
              <option value="harassment">Harassment or bullying</option>
              <option value="spam">Spam or scams</option>
              <option value="privacy">Privacy concern</option>
              <option value="impersonation">Impersonation</option>
              <option value="inappropriate">Inappropriate content</option>
              <option value="safety">Immediate safety concern</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label>
            Details (optional)
            <textarea
              rows={4}
              maxLength={1200}
              value={details}
              onChange={(event) => setDetails(event.target.value)}
            />
          </label>
        </div>
      </ModalDialog>
    </>
  );
}
