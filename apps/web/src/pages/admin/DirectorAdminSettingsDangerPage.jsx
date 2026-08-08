import { useCallback, useEffect, useState } from "react";
import { Button, Card, Input, Textarea } from "@pondbridge/ui";
import { PauseCircle, PlayCircle, TriangleAlert } from "lucide-react";
import { ModalConfirm } from "../../components/admin/AdminUi.jsx";
import useAdminApi from "./useAdminApi.js";
import "./director-admin-danger.css";

function formatWhen(value) {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? ""
    : parsed.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function DirectorAdminSettingsDangerPage() {
  const { request } = useAdminApi();
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [pauseOpen, setPauseOpen] = useState(false);
  const [deleteNote, setDeleteNote] = useState("");
  const [confirmName, setConfirmName] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      setPayload(await request("/settings"));
    } catch (requestError) {
      setError(requestError.message || "Could not load these settings.");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => { load(); }, [load]);

  async function togglePause(paused) {
    setBusy("pause");
    setError("");
    setStatus("");
    try {
      await request("/settings/pause", { method: "POST", body: { paused } });
      setStatus(paused ? "Network paused. Members cannot log in." : "Network resumed. Members can log in again.");
      await load();
    } catch (requestError) {
      setError(requestError.message || "Could not change the network status.");
    } finally {
      setBusy("");
      setPauseOpen(false);
    }
  }

  async function requestDeletion(event) {
    event.preventDefault();
    setBusy("delete");
    setError("");
    setStatus("");
    try {
      await request("/settings/delete-request", { method: "POST", body: { note: deleteNote } });
      setStatus("Deletion requested. PondBridge will follow up within 24 hours.");
      setDeleteNote("");
      setConfirmName("");
      await load();
    } catch (requestError) {
      setError(requestError.message || "Could not submit the deletion request.");
    } finally {
      setBusy("");
    }
  }

  if (loading && !payload) return <Card><p className="muted">Loading…</p></Card>;

  const networkName = String(payload?.tenant?.name || "").trim();
  const isPaused = payload?.tenant?.status === "inactive";
  const pendingDeletion = payload?.deletionRequest?.status === "requested";
  // Typing the name is the only thing standing between a click and losing a
  // network, so the button stays inert until it matches exactly.
  const nameMatches = confirmName.trim().toLowerCase() === networkName.toLowerCase() && Boolean(networkName);

  return (
    <div className="pb-danger">
      {isPaused ? (
        <div className="pb-danger-banner" role="status">
          <PauseCircle aria-hidden="true" />
          <div>
            <strong>This network is paused.</strong>
            <span>Members cannot log in. Everything is preserved — resume whenever you are ready.</span>
          </div>
        </div>
      ) : null}

      {error ? <p className="error-text" role="alert">{error}</p> : null}
      {status ? <p className="success-text" role="status">{status}</p> : null}

      <Card>
        <h2 className="pb-section-title">{isPaused ? "Resume this network" : "Pause this network"}</h2>
        <p className="pb-danger-copy">
          {isPaused
            ? "Members will be able to log in again immediately. Nothing was lost while paused."
            : "Members are signed out and cannot log in until you resume. Profiles, photos, and history are all kept, and you can undo this at any time."}
        </p>
        <Button
          type="button"
          variant="secondary"
          onClick={() => (isPaused ? togglePause(false) : setPauseOpen(true))}
          loading={busy === "pause"}
        >
          {isPaused ? <PlayCircle aria-hidden="true" /> : <PauseCircle aria-hidden="true" />}
          {isPaused ? "Resume network" : "Pause network"}
        </Button>
      </Card>

      <Card className="pb-danger-delete">
        <h2 className="pb-section-title">Delete this network</h2>

        {pendingDeletion ? (
          <div className="pb-danger-pending">
            <TriangleAlert aria-hidden="true" />
            <div>
              <strong>Deletion already requested</strong>
              <span>
                Submitted {formatWhen(payload.deletionRequest.requestedAt)}. PondBridge will contact you before
                anything is removed. Reply to that thread to cancel.
              </span>
            </div>
          </div>
        ) : (
          <>
            <p className="pb-danger-copy">
              This removes every member, profile, photo, message, and event in{" "}
              <strong>{networkName || "this network"}</strong>. It cannot be undone by you or by us once it completes.
            </p>
            <p className="pb-danger-copy">
              Requesting deletion does not delete anything straight away — PondBridge confirms with you first and
              holds a safety window. If you only need members to stop having access, pause instead.
            </p>

            <form onSubmit={requestDeletion} className="pb-danger-form">
              <label>
                <span>Type <strong>{networkName}</strong> to confirm</span>
                <Input
                  value={confirmName}
                  onChange={(event) => setConfirmName(event.target.value)}
                  placeholder={networkName}
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={confirmName.length > 0 && !nameMatches}
                />
              </label>
              <label>
                <span>Why are you deleting it? <small>optional, helps us help you</small></span>
                <Textarea
                  value={deleteNote}
                  rows={2}
                  onChange={(event) => setDeleteNote(event.target.value)}
                  placeholder="Moving to another platform, camp closed, duplicate network…"
                />
              </label>
              <Button type="submit" variant="danger" disabled={!nameMatches} loading={busy === "delete"}>
                Request deletion
              </Button>
            </form>
          </>
        )}
      </Card>

      <ModalConfirm
        open={pauseOpen}
        title="Pause this network?"
        description="Every member is signed out and nobody can log in until you resume. Nothing is deleted."
        confirmLabel="Pause network"
        cancelLabel="Keep it running"
        tone="danger"
        busy={busy === "pause"}
        onConfirm={() => togglePause(true)}
        onCancel={() => setPauseOpen(false)}
      />
    </div>
  );
}
