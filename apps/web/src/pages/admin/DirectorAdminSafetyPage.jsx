import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Card, Select, Textarea } from "@pondbridge/ui";
import {
  DataTable,
  LoadingSkeleton,
  ModalDialog,
  PageHeader
} from "../../components/admin/AdminUi.jsx";
import useAdminApi from "./useAdminApi.js";

const STATUS_OPTIONS = [
  { value: "active", label: "Needs review" },
  { value: "open", label: "Open" },
  { value: "reviewing", label: "In review" },
  { value: "resolved", label: "Resolved" },
  { value: "dismissed", label: "Dismissed" },
  { value: "all", label: "All reports" }
];

const REASON_LABELS = {
  harassment: "Harassment or bullying",
  spam: "Spam or scams",
  privacy: "Privacy concern",
  impersonation: "Impersonation",
  inappropriate: "Inappropriate content",
  safety: "Immediate safety concern",
  other: "Other"
};

const TARGET_LABELS = {
  member: "Member profile",
  message: "Direct message",
  forum: "Forum",
  forum_post: "Forum post",
  photo: "Photo",
  photo_comment: "Photo comment"
};

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

function reportTargetHref(slug, report) {
  const profileId = String(report?.targetAuthor?.profileId || "").trim();
  if (report?.targetType === "member" && profileId) return `/t/${slug}/profile/${profileId}`;
  if (report?.targetType === "photo" || report?.targetType === "photo_comment") {
    return `/t/${slug}/photo-stream`;
  }
  if (report?.targetType === "forum" || report?.targetType === "forum_post") {
    const forumQuery = report?.targetContextId
      ? `&forum=${encodeURIComponent(report.targetContextId)}`
      : "";
    return `/t/${slug}/chat-rooms?tab=forums${forumQuery}`;
  }
  if (report?.targetType === "message") return "";
  return "";
}

export default function DirectorAdminSafetyPage() {
  const { slug, request } = useAdminApi();
  const [filter, setFilter] = useState("active");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [review, setReview] = useState(null);
  const [reviewStatus, setReviewStatus] = useState("resolved");
  const [resolutionNote, setResolutionNote] = useState("");
  const [saving, setSaving] = useState(false);

  const loadReports = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await request(`/safety/reports?status=${encodeURIComponent(filter)}`);
      setItems(Array.isArray(payload?.items) ? payload.items : []);
    } catch (requestError) {
      setError(requestError.message || "Unable to load safety reports.");
    } finally {
      setLoading(false);
    }
  }, [filter, request]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  const activeCount = useMemo(
    () => items.filter((item) => item.status === "open" || item.status === "reviewing").length,
    [items]
  );

  async function updateReport(report, nextStatus, note = "") {
    setSaving(true);
    setError("");
    setStatus("");
    try {
      await request(`/safety/reports/${encodeURIComponent(report.id)}`, {
        method: "PATCH",
        body: { status: nextStatus, resolutionNote: note }
      });
      setStatus(
        nextStatus === "reviewing"
          ? "Report marked as in review."
          : nextStatus === "open"
          ? "Report reopened."
          : `Report ${nextStatus}.`
      );
      setReview(null);
      setResolutionNote("");
      await loadReports();
    } catch (requestError) {
      setError(requestError.message || "Unable to update the report.");
    } finally {
      setSaving(false);
    }
  }

  async function removeReportedContent(report, note) {
    setSaving(true);
    setError("");
    setStatus("");
    try {
      await request(`/safety/reports/${encodeURIComponent(report.id)}/target`, {
        method: "DELETE",
        body: { resolutionNote: note }
      });
      setStatus("Reported content removed and the report resolved.");
      setReview(null);
      setResolutionNote("");
      await loadReports();
    } catch (requestError) {
      setError(requestError.message || "Unable to remove the reported content.");
    } finally {
      setSaving(false);
    }
  }

  function openCloseDialog(report, nextStatus) {
    setReview(report);
    setReviewStatus(nextStatus);
    setResolutionNote(report?.resolutionNote || "");
    setError("");
    setStatus("");
  }

  return (
    <div className="director-admin-stack">
      <Card>
        <PageHeader
          title="Community Safety"
          subtitle="Review member reports, document decisions, and prioritize immediate safety concerns."
          className="director-admin-page-head"
          actions={
            <Button variant="secondary" onClick={loadReports} disabled={loading}>
              Refresh
            </Button>
          }
        />

        <div className="director-admin-info-banner">
          <p>
            Blocking stops one-to-one contact and hides profiles from the two members. Shared group chats,
            forums, and camp events can still contain both people, so reports may require a director response.
          </p>
        </div>

        <div className="director-admin-filter-row">
          <label>
            Report status
            <Select value={filter} onChange={(event) => setFilter(event.target.value)}>
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Select>
          </label>
          <span className={`director-admin-status-badge tone-${activeCount ? "danger" : "success"}`}>
            {activeCount} needing attention
          </span>
        </div>

        {error ? <p className="error-text" role="alert">{error}</p> : null}
        {status ? <p className="success-text" role="status">{status}</p> : null}

        {loading ? (
          <LoadingSkeleton lines={5} />
        ) : (
          <DataTable className="director-admin-table-wrap" tableClassName="director-admin-table" minWidth={980}>
            <thead>
              <tr>
                <th>Reported</th>
                <th>Reason</th>
                <th>Item</th>
                <th>Reporter</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {!items.length ? (
                <tr><td colSpan={6} className="muted">No reports match this view.</td></tr>
              ) : items.map((report) => {
                const targetHref = reportTargetHref(slug, report);
                return (
                  <tr key={report.id}>
                    <td>{formatDateTime(report.createdAt)}</td>
                    <td>
                      <strong>{REASON_LABELS[report.reason] || "Other"}</strong>
                      {report.details ? <small className="director-admin-member-cell">{report.details}</small> : null}
                    </td>
                    <td>
                      <div className="director-admin-member-cell">
                        <strong>{TARGET_LABELS[report.targetType] || "Content"}</strong>
                        <small>{report.targetPreview}</small>
                        {targetHref && report.targetAvailable ? <Link to={targetHref}>Open context</Link> : null}
                      </div>
                    </td>
                    <td>{report.reporter?.name || "Member"}</td>
                    <td>
                      <span className={`director-admin-status-badge tone-${report.status === "resolved" ? "success" : report.status === "dismissed" ? "neutral" : "warning"}`}>
                        {report.status}
                      </span>
                    </td>
                    <td>
                      <div className="inline-actions">
                        {report.status === "open" ? (
                          <Button variant="secondary" size="sm" onClick={() => updateReport(report, "reviewing")} disabled={saving}>
                            Start review
                          </Button>
                        ) : null}
                        {report.status === "open" || report.status === "reviewing" ? (
                          <>
                            {report.targetAvailable && ["message", "forum_post"].includes(report.targetType) ? (
                              <Button variant="danger" size="sm" onClick={() => openCloseDialog(report, "remove")} disabled={saving}>
                                Remove content
                              </Button>
                            ) : null}
                            <Button size="sm" onClick={() => openCloseDialog(report, "resolved")} disabled={saving}>
                              Resolve
                            </Button>
                            <Button variant="secondary" size="sm" onClick={() => openCloseDialog(report, "dismissed")} disabled={saving}>
                              Dismiss
                            </Button>
                          </>
                        ) : (
                          <Button variant="secondary" size="sm" onClick={() => updateReport(report, "open")} disabled={saving}>
                            Reopen
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
        )}
      </Card>

      <ModalDialog
        open={Boolean(review)}
        title={
          reviewStatus === "remove"
            ? "Remove reported content"
            : reviewStatus === "resolved"
              ? "Resolve safety report"
              : "Dismiss safety report"
        }
        description={
          reviewStatus === "remove"
            ? "This permanently hides the message or forum post for members and records the moderation action."
            : "Document the decision without copying unnecessary sensitive information."
        }
        onClose={saving ? undefined : () => setReview(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setReview(null)} disabled={saving}>Cancel</Button>
            <Button
              variant={reviewStatus === "remove" ? "danger" : "primary"}
              onClick={() =>
                reviewStatus === "remove"
                  ? removeReportedContent(review, resolutionNote)
                  : updateReport(review, reviewStatus, resolutionNote)
              }
              disabled={saving || !resolutionNote.trim()}
            >
              {saving
                ? "Saving..."
                : reviewStatus === "remove"
                  ? "Remove and resolve"
                  : reviewStatus === "resolved"
                    ? "Mark resolved"
                    : "Dismiss report"}
            </Button>
          </>
        }
      >
        <label>
          Resolution note
          <Textarea
            rows={5}
            maxLength={1200}
            value={resolutionNote}
            onChange={(event) => setResolutionNote(event.target.value)}
            placeholder="What was reviewed, what action was taken, and whether follow-up is needed."
          />
        </label>
      </ModalDialog>
    </div>
  );
}
