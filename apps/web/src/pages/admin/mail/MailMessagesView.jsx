import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Input } from "@pondbridge/ui";
import { CalendarClock, FileEdit, Inbox, RefreshCw } from "lucide-react";
import { ModalConfirm } from "../../../components/admin/AdminUi.jsx";

const PAGE_SIZE = 30;

const FOLDER_COPY = {
  drafts: {
    title: "Drafts",
    empty: "No drafts yet.",
    emptyHint: "Anything you start writing is saved here automatically."
  },
  scheduled: {
    title: "Scheduled",
    empty: "Nothing scheduled.",
    emptyHint: "Schedule a message from the composer to see it here."
  },
  sent: {
    title: "Sent",
    empty: "No emails sent yet.",
    emptyHint: "Sent, failed, and canceled broadcasts appear here."
  }
};

function formatDateTime(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function formatPercent(value) {
  if (value == null || value === "") return "—";
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function statusTone(status = "") {
  const key = String(status || "").toLowerCase();
  if (key === "sent") return "success";
  if (key === "scheduled") return "info";
  if (key === "failed") return "danger";
  if (key === "canceled") return "muted";
  return "neutral";
}

function plainPreview(html = "") {
  return String(html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

export default function MailMessagesView({ folder = "sent", request, onEditDraft, onCopyAsNew, onChanged }) {
  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [busy, setBusy] = useState(false);

  const copy = FOLDER_COPY[folder] || FOLDER_COPY.sent;

  const load = useCallback(async (pageNum = 0) => {
    setLoading(true);
    setError("");
    try {
      if (folder === "drafts") {
        const payload = await request("/email/drafts?limit=30");
        setItems(Array.isArray(payload?.items) ? payload.items : []);
        setTotal(Number(payload?.total || 0));
      } else {
        const params = new URLSearchParams({
          limit: String(PAGE_SIZE),
          offset: String(pageNum * PAGE_SIZE)
        });
        if (folder === "scheduled") params.set("status", "scheduled");
        const payload = await request(`/email/history?${params.toString()}`);
        setItems(Array.isArray(payload?.items) ? payload.items : []);
        setTotal(Number(payload?.total || 0));
      }
    } catch (requestError) {
      setError(requestError.message || "Failed to load messages.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [folder, request]);

  useEffect(() => {
    setPage(0);
    setSelectedId("");
  }, [folder]);

  useEffect(() => {
    load(page);
  }, [load, page]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) => String(item.subject || "").toLowerCase().includes(needle));
  }, [items, query]);

  const selected = useMemo(
    () => filtered.find((item) => item.id === selectedId) || null,
    [filtered, selectedId]
  );

  async function cancelScheduled() {
    if (!cancelTarget) return;
    setBusy(true);
    try {
      await request(`/email/scheduled/${cancelTarget.id}`, { method: "DELETE" });
      setCancelTarget(null);
      setSelectedId("");
      await load(page);
      onChanged?.();
    } catch (requestError) {
      setError(requestError.message || "Failed to cancel the scheduled email.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteDraft() {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await request(`/email/draft/${deleteTarget.id}`, { method: "DELETE" });
      setDeleteTarget(null);
      setSelectedId("");
      await load(page);
      onChanged?.();
    } catch (requestError) {
      setError(requestError.message || "Failed to delete the draft.");
    } finally {
      setBusy(false);
    }
  }

  const stats = selected?.stats || {};

  return (
    <div className="pb-mail-messages">
      <div className="pb-mail-list">
        <div className="pb-mail-list-head">
          <h2>{copy.title}</h2>
          <Button type="button" variant="ghost" size="sm" onClick={() => load(page)} aria-label="Refresh">
            <RefreshCw aria-hidden="true" />
          </Button>
        </div>
        <div className="pb-mail-list-search">
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search subjects" />
        </div>

        {error ? <p className="error-text" role="alert">{error}</p> : null}

        <ul className="pb-mail-list-items">
          {loading ? (
            <li className="pb-mail-list-placeholder">Loading…</li>
          ) : !filtered.length ? (
            <li className="pb-mail-list-empty">
              <Inbox aria-hidden="true" />
              <strong>{query ? "No matches." : copy.empty}</strong>
              <span>{query ? "Try a different search." : copy.emptyHint}</span>
            </li>
          ) : (
            filtered.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={item.id === selectedId ? "is-selected" : ""}
                  onClick={() => setSelectedId(item.id)}
                >
                  <span className="pb-mail-list-row">
                    <strong>{item.subject || "(No subject)"}</strong>
                    <small>{formatDateTime(item.sentAt || item.scheduledFor || item.updatedAt || item.createdAt)}</small>
                  </span>
                  <span className="pb-mail-list-snippet">{plainPreview(item.preheader || item.body) || "No content yet"}</span>
                  <span className="pb-mail-list-meta">
                    <span className={`pb-mail-status tone-${statusTone(item.status)}`}>{item.status}</span>
                    {folder === "drafts" ? null : (
                      <small>{Number(item.recipientCount || 0).toLocaleString()} recipients</small>
                    )}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>

        {folder !== "drafts" ? (
          <div className="pb-mail-list-pagination">
            <Button variant="secondary" size="sm" disabled={page === 0 || loading} onClick={() => setPage((value) => value - 1)}>
              Previous
            </Button>
            <span className="muted">
              Page {page + 1}{total > 0 ? ` of ${Math.max(1, Math.ceil(total / PAGE_SIZE))}` : ""}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={loading || items.length < PAGE_SIZE}
              onClick={() => setPage((value) => value + 1)}
            >
              Next
            </Button>
          </div>
        ) : null}
      </div>

      <div className="pb-mail-reading">
        {!selected ? (
          <div className="pb-mail-reading-empty">
            <Inbox aria-hidden="true" />
            <p>Select a message to read it.</p>
          </div>
        ) : (
          <>
            <header className="pb-mail-reading-head">
              <div>
                <h3>{selected.subject || "(No subject)"}</h3>
                <p>
                  <span className={`pb-mail-status tone-${statusTone(selected.status)}`}>{selected.status}</span>
                  <span>{formatDateTime(selected.sentAt || selected.scheduledFor || selected.updatedAt || selected.createdAt)}</span>
                  {folder === "drafts" ? null : <span>{Number(selected.recipientCount || 0).toLocaleString()} recipients</span>}
                </p>
              </div>
              <div className="pb-mail-reading-actions">
                {folder === "drafts" ? (
                  <>
                    <Button type="button" size="sm" onClick={() => onEditDraft?.(selected)}>
                      <FileEdit aria-hidden="true" />
                      Continue editing
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setDeleteTarget(selected)}>
                      Delete
                    </Button>
                  </>
                ) : (
                  <>
                    <Button type="button" variant="secondary" size="sm" onClick={() => onCopyAsNew?.(selected)}>
                      Copy as new
                    </Button>
                    {selected.status === "scheduled" ? (
                      <Button type="button" variant="ghost" size="sm" onClick={() => setCancelTarget(selected)}>
                        <CalendarClock aria-hidden="true" />
                        Cancel send
                      </Button>
                    ) : null}
                  </>
                )}
              </div>
            </header>

            {stats.delivery || stats.webhook ? (
              <div className="pb-mail-reading-stats">
                {stats.delivery ? (
                  <>
                    <div>
                      <strong>
                        {selected.status === "scheduled"
                          ? stats.delivery.acceptedCount ?? "—"
                          : stats.delivery.sentCount ?? "—"}
                      </strong>
                      <small>{selected.status === "scheduled" ? "Scheduled" : "Sent"}</small>
                    </div>
                    <div>
                      <strong>{stats.delivery.failedCount ?? "—"}</strong>
                      <small>Failed</small>
                    </div>
                  </>
                ) : null}
                {stats.webhook?.delivered != null ? (
                  <div><strong>{stats.webhook.delivered}</strong><small>Delivered</small></div>
                ) : null}
                {stats.webhook?.bounced != null ? (
                  <div><strong>{stats.webhook.bounced}</strong><small>Bounced</small></div>
                ) : null}
                {stats.webhook?.openRate != null ? (
                  <div><strong>{formatPercent(stats.webhook.openRate)}</strong><small>Open rate</small></div>
                ) : null}
                {stats.webhook?.clickRate != null ? (
                  <div><strong>{formatPercent(stats.webhook.clickRate)}</strong><small>Click rate</small></div>
                ) : null}
              </div>
            ) : null}

            <div
              className="pb-mail-reading-body"
              dangerouslySetInnerHTML={{ __html: selected.body || "<p>This message has no content yet.</p>" }}
            />
          </>
        )}
      </div>

      <ModalConfirm
        open={Boolean(cancelTarget)}
        title="Cancel this scheduled email?"
        description={cancelTarget ? `“${cancelTarget.subject}” will not be sent. This cannot be undone.` : ""}
        confirmLabel="Cancel send"
        cancelLabel="Keep scheduled"
        tone="danger"
        busy={busy}
        onConfirm={cancelScheduled}
        onCancel={() => setCancelTarget(null)}
      />

      <ModalConfirm
        open={Boolean(deleteTarget)}
        title="Delete this draft?"
        description={deleteTarget ? `“${deleteTarget.subject || "(No subject)"}” will be removed permanently.` : ""}
        confirmLabel="Delete draft"
        cancelLabel="Keep draft"
        tone="danger"
        busy={busy}
        onConfirm={deleteDraft}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
