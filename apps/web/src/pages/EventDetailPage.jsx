import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Badge, Button, Card, PageShell } from "@pondbridge/ui";
import { requestJson } from "../lib/http.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useTenant } from "../context/TenantContext.jsx";
import { tenantRoute } from "../lib/tenantRouting.js";

function formatEventWindow(item = {}) {
  const timezone = String(item?.timezone || "America/New_York");
  const startsAt = item?.startsAt ? new Date(item.startsAt) : null;
  const endsAt = item?.endsAt ? new Date(item.endsAt) : null;
  if (!startsAt || Number.isNaN(startsAt.getTime())) return "Date coming soon";
  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: timezone
  });
  const timeFormatter = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone
  });
  return `${dateFormatter.format(startsAt)} • ${timeFormatter.format(startsAt)}${endsAt && !Number.isNaN(endsAt.getTime()) ? ` - ${timeFormatter.format(endsAt)}` : ""} ${timezone}`;
}

function rsvpTone(status = "") {
  if (status === "attending") return "success";
  if (status === "maybe") return "warning";
  if (status === "not_attending") return "neutral";
  return "neutral";
}

function rsvpLabel(status = "") {
  if (status === "attending") return "Attending";
  if (status === "maybe") return "Maybe";
  if (status === "not_attending") return "Not attending";
  return "No RSVP yet";
}

export default function EventDetailPage() {
  const params = useParams();
  const eventId = params.eventId;
  const { token } = useAuth();
  const { tenant, slug: tenantSlug } = useTenant();
  const slug = params.slug || tenantSlug || "";
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    requestJson(`/api/t/${slug}/events/${eventId}`, { token })
      .then((payload) => {
        if (!cancelled) setItem(payload?.item || null);
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError.message || "Unable to load this event.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId, slug, token]);

  async function updateRsvp(nextStatus) {
    if (!item) return;
    setSaving(true);
    setError("");
    setStatus("");
    try {
      const payload = await requestJson(`/api/t/${slug}/events/${eventId}/rsvp`, {
        method: "PUT",
        token,
        body: { status: nextStatus }
      });
      setItem(payload?.item || null);
      setStatus(`Your RSVP is now ${rsvpLabel(nextStatus).toLowerCase()}.`);
    } catch (saveError) {
      setError(saveError.message || "Could not update your RSVP.");
    } finally {
      setSaving(false);
    }
  }

  const brandPrimary = String(tenant?.config?.branding?.brandPrimary || tenant?.theme?.brandPrimary || "#0d385d");
  const rsvpLocked = Boolean(item?.rsvpClosed || item?.status === "canceled");

  return (
    <PageShell className="pb-cedar-page nav2-page-shell event-detail-shell">
      <div className="event-detail-backlink">
        <Link to={tenantRoute(slug, "/events")}>All events</Link>
      </div>

      {loading ? (
        <Card>
          <p className="muted">Loading event...</p>
        </Card>
      ) : null}

      {error && !item ? (
        <Card>
          <p className="error-text">{error}</p>
        </Card>
      ) : null}

      {item ? (
        <>
          <section className="event-detail-hero" style={{ "--events-brand": brandPrimary }}>
            <div
              className="event-detail-hero-media"
              style={item.coverImageUrl ? { backgroundImage: `linear-gradient(180deg, rgba(10,24,40,0.16), rgba(10,24,40,0.84)), url(${item.coverImageUrl})` } : undefined}
            />
            <div className="event-detail-hero-copy">
              <div className="event-detail-badges">
                <Badge tone={item.status === "canceled" ? "danger" : rsvpTone(item?.myRsvp?.status || "")}>
                  {item.status === "canceled" ? "Canceled" : rsvpLabel(item?.myRsvp?.status || "")}
                </Badge>
                <Badge tone="neutral">{item.counts?.attending || 0} attending</Badge>
              </div>
              <h1>{item.title}</h1>
              <p>{item.summary || "Open for the latest details, RSVP updates, and location info."}</p>
              <div className="event-detail-meta">
                <span>{formatEventWindow(item)}</span>
                <span>{item.locationName || "Location coming soon"}</span>
              </div>
            </div>
          </section>

          <section className="event-detail-grid">
            <article className="event-detail-main">
              <Card>
                <div className="event-detail-section-head">
                  <h2>About this event</h2>
                  <p>{item.locationAddress || "Address details will appear here when they are ready."}</p>
                </div>
                {item.bodyHtml ? (
                  <div className="event-detail-richtext" dangerouslySetInnerHTML={{ __html: item.bodyHtml }} />
                ) : (
                  <p className="muted">More details will be shared here soon.</p>
                )}
              </Card>
            </article>

            <aside className="event-detail-side">
              <Card>
                <div className="event-detail-section-head">
                  <h2>RSVP</h2>
                  <p>{item.rsvpDeadlineAt ? `RSVP by ${new Date(item.rsvpDeadlineAt).toLocaleString()}` : "Respond whenever you’re ready."}</p>
                </div>
                <div className="event-rsvp-stack">
                  {["attending", "maybe", "not_attending"].map((value) => (
                    <Button
                      key={value}
                      type="button"
                      disabled={saving || rsvpLocked}
                      variant={item?.myRsvp?.status === value ? "primary" : "secondary"}
                      onClick={() => updateRsvp(value)}
                    >
                      {value === "attending" ? "Attending" : value === "maybe" ? "Maybe" : "Not attending"}
                    </Button>
                  ))}
                </div>
                {rsvpLocked ? (
                  <p className="muted">
                    {item.status === "canceled"
                      ? "This event has been canceled."
                      : "The RSVP deadline has passed."}
                  </p>
                ) : null}
                {status ? <p className="success-text">{status}</p> : null}
                {error ? <p className="error-text">{error}</p> : null}
              </Card>

              <Card>
                <div className="event-detail-section-head">
                  <h2>Response Snapshot</h2>
                  <p>See how the community is planning.</p>
                </div>
                <div className="event-detail-counts">
                  <div>
                    <strong>{item.counts?.attending || 0}</strong>
                    <span>Attending</span>
                  </div>
                  <div>
                    <strong>{item.counts?.maybe || 0}</strong>
                    <span>Maybe</span>
                  </div>
                  <div>
                    <strong>{item.counts?.notAttending || 0}</strong>
                    <span>Not attending</span>
                  </div>
                </div>
              </Card>
            </aside>
          </section>
        </>
      ) : null}
    </PageShell>
  );
}
