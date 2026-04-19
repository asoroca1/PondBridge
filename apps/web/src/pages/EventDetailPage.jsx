import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  CalendarDays,
  ChevronLeft,
  MapPin,
  Clock,
  Users,
  Check,
  X as XIcon,
  HelpCircle
} from "lucide-react";
import { requestJson } from "../lib/http.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useTenant } from "../context/TenantContext.jsx";
import { tenantRoute } from "../lib/tenantRouting.js";

function formatFullDate(item = {}) {
  const timezone = String(item?.timezone || "America/New_York");
  const startsAt = item?.startsAt ? new Date(item.startsAt) : null;
  if (!startsAt || Number.isNaN(startsAt.getTime())) return "Date coming soon";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: timezone
  }).format(startsAt);
}

function formatTimeRange(item = {}) {
  const timezone = String(item?.timezone || "America/New_York");
  const startsAt = item?.startsAt ? new Date(item.startsAt) : null;
  const endsAt = item?.endsAt ? new Date(item.endsAt) : null;
  if (!startsAt || Number.isNaN(startsAt.getTime())) return "";
  const timeFormatter = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone
  });
  const start = timeFormatter.format(startsAt);
  const end = endsAt && !Number.isNaN(endsAt.getTime()) ? timeFormatter.format(endsAt) : "";
  return end ? `${start} – ${end}` : start;
}

function dateBadge(item = {}) {
  const timezone = String(item?.timezone || "America/New_York");
  const startsAt = item?.startsAt ? new Date(item.startsAt) : null;
  if (!startsAt || Number.isNaN(startsAt.getTime())) return { month: "TBD", day: "--" };
  const month = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: timezone }).format(startsAt);
  const day = new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: timezone }).format(startsAt);
  return { month: month.toUpperCase(), day };
}

function rsvpLabel(status = "") {
  if (status === "attending") return "Attending";
  if (status === "maybe") return "Maybe";
  if (status === "not_attending") return "Not attending";
  return "No RSVP yet";
}

const RSVP_OPTIONS = [
  { value: "attending", label: "Going", Icon: Check },
  { value: "maybe", label: "Maybe", Icon: HelpCircle },
  { value: "not_attending", label: "Can’t go", Icon: XIcon }
];

export default function EventDetailPage() {
  const params = useParams();
  const eventId = params.eventId;
  const { token } = useAuth();
  const { slug: tenantSlug } = useTenant();
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

  const rsvpLocked = Boolean(item?.rsvpClosed || item?.status === "canceled");
  const bd = useMemo(() => dateBadge(item || {}), [item]);
  const coverStyle = item?.coverImageUrl
    ? {
        backgroundImage: `linear-gradient(100deg, rgba(10,24,40,0.82) 0%, rgba(10,24,40,0.35) 55%, rgba(10,24,40,0.05) 100%), url(${item.coverImageUrl})`
      }
    : undefined;

  return (
    <main className="ev-wrap ev-detail-wrap nav2-page-shell">
      <div className="ev-detail-backlink">
        <Link to={tenantRoute(slug, "/events")}>
          <ChevronLeft size={16} aria-hidden="true" />
          <span>All events</span>
        </Link>
      </div>

      {loading ? (
        <div className="ev-detail-skel">
          <div className="ev-detail-hero ev-skel-shimmer" />
          <div className="ev-detail-grid">
            <div className="ev-detail-card ev-skel-shimmer" style={{ minHeight: 200 }} />
            <div className="ev-detail-card ev-skel-shimmer" style={{ minHeight: 200 }} />
          </div>
        </div>
      ) : null}

      {error && !item && !loading ? (
        <div className="ev-message is-error">
          <p className="ev-message-eyebrow">Events unavailable</p>
          <h2>We couldn’t load this event.</h2>
          <p>{error}</p>
        </div>
      ) : null}

      {item ? (
        <>
          <section className="ev-detail-hero" style={coverStyle}>
            <div className="ev-detail-hero-inner">
              <div className="ev-detail-date-chip" aria-hidden="true">
                <span className="ev-date-chip-month">{bd.month}</span>
                <span className="ev-date-chip-day">{bd.day}</span>
              </div>
              <div className="ev-detail-hero-copy">
                {item.status === "canceled" ? (
                  <span className="ev-status-chip is-danger">Canceled</span>
                ) : item.myRsvp?.status === "attending" ? (
                  <span className="ev-status-chip is-success">You’re going</span>
                ) : (
                  <span className="ev-status-chip is-open">RSVP open</span>
                )}
                <h1>{item.title}</h1>
                {item.summary ? <p className="ev-detail-hero-summary">{item.summary}</p> : null}
                <div className="ev-detail-hero-meta">
                  <span className="ev-meta-item">
                    <CalendarDays size={14} aria-hidden="true" />
                    <span>{formatFullDate(item)}</span>
                  </span>
                  {formatTimeRange(item) ? (
                    <span className="ev-meta-item">
                      <Clock size={14} aria-hidden="true" />
                      <span>{formatTimeRange(item)}</span>
                    </span>
                  ) : null}
                  <span className="ev-meta-item">
                    <MapPin size={14} aria-hidden="true" />
                    <span>{item.locationName || "Location coming soon"}</span>
                  </span>
                </div>
              </div>
            </div>
          </section>

          <section className="ev-detail-grid">
            <article className="ev-detail-card ev-detail-main">
              <header className="ev-detail-card-head">
                <h2>About this event</h2>
                {item.locationAddress ? (
                  <p className="ev-detail-card-sub">
                    <MapPin size={13} aria-hidden="true" />
                    <span>{item.locationAddress}</span>
                  </p>
                ) : null}
              </header>
              {item.bodyHtml ? (
                <div className="ev-detail-richtext" dangerouslySetInnerHTML={{ __html: item.bodyHtml }} />
              ) : (
                <p className="ev-detail-muted">More details will be shared here soon.</p>
              )}
            </article>

            <aside className="ev-detail-side">
              <article className="ev-detail-card">
                <header className="ev-detail-card-head">
                  <h2>Your RSVP</h2>
                  <p className="ev-detail-card-sub">
                    {item.rsvpDeadlineAt
                      ? `Respond by ${new Date(item.rsvpDeadlineAt).toLocaleString()}`
                      : "Respond whenever you’re ready."}
                  </p>
                </header>
                <div className="ev-rsvp-stack">
                  {RSVP_OPTIONS.map(({ value, label, Icon }) => {
                    const isActive = item?.myRsvp?.status === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        disabled={saving || rsvpLocked}
                        className={`ev-rsvp-btn ${isActive ? `is-active is-${value.replace("_", "-")}` : ""}`}
                        onClick={() => updateRsvp(value)}
                      >
                        <Icon size={15} aria-hidden="true" />
                        <span>{label}</span>
                      </button>
                    );
                  })}
                </div>
                {rsvpLocked ? (
                  <p className="ev-detail-muted ev-detail-locked">
                    {item.status === "canceled"
                      ? "This event has been canceled."
                      : "The RSVP deadline has passed."}
                  </p>
                ) : null}
                {status ? <p className="ev-detail-success">{status}</p> : null}
                {error && item ? <p className="ev-detail-error">{error}</p> : null}
              </article>

              <article className="ev-detail-card">
                <header className="ev-detail-card-head">
                  <h2>Who’s coming</h2>
                  <p className="ev-detail-card-sub">
                    <Users size={13} aria-hidden="true" />
                    <span>See how the community is planning.</span>
                  </p>
                </header>
                <div className="ev-detail-counts">
                  <div className="ev-detail-count is-attending">
                    <strong>{item.counts?.attending || 0}</strong>
                    <span>Going</span>
                  </div>
                  <div className="ev-detail-count is-maybe">
                    <strong>{item.counts?.maybe || 0}</strong>
                    <span>Maybe</span>
                  </div>
                  <div className="ev-detail-count is-not">
                    <strong>{item.counts?.notAttending || 0}</strong>
                    <span>Can’t go</span>
                  </div>
                </div>
              </article>
            </aside>
          </section>
        </>
      ) : null}
    </main>
  );
}
