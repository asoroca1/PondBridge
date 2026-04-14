import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Badge, Card, PageShell } from "@pondbridge/ui";
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
    timeZone: timezone
  });
  const timeFormatter = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone
  });

  const startDate = dateFormatter.format(startsAt);
  const startTime = timeFormatter.format(startsAt);
  const endTime = endsAt && !Number.isNaN(endsAt.getTime()) ? timeFormatter.format(endsAt) : "";
  return `${startDate} • ${startTime}${endTime ? ` - ${endTime}` : ""} ${timezone}`;
}

function eventTone(item = {}) {
  if (item.status === "canceled") return "danger";
  if (item.myRsvp?.status === "attending") return "success";
  if (item.myRsvp?.status === "maybe") return "warning";
  return "neutral";
}

function rsvpLabel(item = {}) {
  if (item.status === "canceled") return "Canceled";
  if (item.myRsvp?.status === "attending") return "You’re going";
  if (item.myRsvp?.status === "maybe") return "You’re maybe";
  if (item.myRsvp?.status === "not_attending") return "Not attending";
  return item.phase === "past" ? "Past event" : "RSVP open";
}

function EventCard({ item, slug, featured = false }) {
  return (
    <article className={`events-card ${featured ? "events-card-featured" : ""}`.trim()}>
      <div
        className="events-card-media"
        style={item.coverImageUrl ? { backgroundImage: `linear-gradient(180deg, rgba(9,22,37,0.12), rgba(9,22,37,0.78)), url(${item.coverImageUrl})` } : undefined}
      >
        <Badge tone={eventTone(item)}>{rsvpLabel(item)}</Badge>
        {item.status === "canceled" ? <span className="events-card-pill">Update posted</span> : null}
      </div>
      <div className="events-card-body">
        <p className="events-card-date">{formatEventWindow(item)}</p>
        <h3>{item.title}</h3>
        <p>{item.summary || "Event details are on the way."}</p>
        <div className="events-card-meta">
          <span>{item.locationName || "Location to be announced"}</span>
          <span>{item.counts?.attending || 0} attending</span>
        </div>
        <div className="events-card-actions">
          <Link className="pb-btn pb-btn-secondary" to={tenantRoute(slug, `/events/${item.id}`)}>
            {featured ? "Open Event" : "View Details"}
          </Link>
        </div>
      </div>
    </article>
  );
}

export default function EventsPage() {
  const params = useParams();
  const { token } = useAuth();
  const { tenant, slug: tenantSlug } = useTenant();
  const slug = params.slug || tenantSlug || "";
  const [payload, setPayload] = useState({ featured: null, upcoming: [], past: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    requestJson(`/api/t/${slug}/events`, { token })
      .then((next) => {
        if (cancelled) return;
        setPayload({
          featured: next?.featured || null,
          upcoming: Array.isArray(next?.upcoming) ? next.upcoming : [],
          past: Array.isArray(next?.past) ? next.past : []
        });
      })
      .catch((loadError) => {
        if (cancelled) return;
        setError(loadError.message || "Unable to load events right now.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [slug, token]);

  const featured = payload.featured;
  const upcomingCards = useMemo(() => {
    if (!featured) return payload.upcoming;
    return payload.upcoming.filter((item) => item.id !== featured.id);
  }, [featured, payload.upcoming]);
  const brandPrimary = String(tenant?.config?.branding?.brandPrimary || tenant?.theme?.brandPrimary || "#0d385d");

  return (
    <PageShell className="pb-cedar-page nav2-page-shell events-page-shell">
      <section className="events-hero" style={{ "--events-brand": brandPrimary }}>
        <div className="events-hero-copy">
          <p className="events-kicker">Community Calendar</p>
          <h1>Events</h1>
          <p>Gatherings, reunions, and camp community moments all in one place.</p>
        </div>
        <div className="events-hero-panel">
          <strong>{payload.upcoming.length}</strong>
          <span>Upcoming event{payload.upcoming.length === 1 ? "" : "s"}</span>
        </div>
      </section>

      {loading ? (
        <Card>
          <p className="muted">Loading events...</p>
        </Card>
      ) : null}

      {error ? (
        <Card>
          <p className="error-text">{error}</p>
        </Card>
      ) : null}

      {!loading && !error && featured ? (
        <section className="events-feature-grid">
          <div className="events-feature-copy">
            <p className="events-kicker">Featured Next Up</p>
            <h2>{featured.title}</h2>
            <p>{featured.summary || "Save the date and open the full event for the latest details."}</p>
            <div className="events-feature-details">
              <span>{formatEventWindow(featured)}</span>
              <span>{featured.locationName || "Location coming soon"}</span>
            </div>
            <div className="events-feature-actions">
              <Link className="pb-btn pb-btn-primary" to={tenantRoute(slug, `/events/${featured.id}`)}>
                See Event Details
              </Link>
              <Badge tone={eventTone(featured)}>{rsvpLabel(featured)}</Badge>
            </div>
          </div>
          <EventCard item={featured} slug={slug} featured />
        </section>
      ) : null}

      {!loading && !error ? (
        <section className="events-section">
          <div className="events-section-head">
            <h2>Upcoming</h2>
            <p>Every published event in your network, with your RSVP status right on the card.</p>
          </div>
          {payload.upcoming.length === 0 ? (
            <Card>
              <p className="muted">No upcoming events yet. Directors can publish them from the dashboard.</p>
            </Card>
          ) : upcomingCards.length === 0 ? (
            <Card>
              <p className="muted">The featured event above is the next one on the calendar.</p>
            </Card>
          ) : (
            <div className="events-grid">
              {upcomingCards.map((item) => (
                <EventCard key={item.id} item={item} slug={slug} />
              ))}
            </div>
          )}
        </section>
      ) : null}

      {!loading && !error && payload.past.length > 0 ? (
        <section className="events-section">
          <div className="events-section-head">
            <h2>Past Events</h2>
            <p>Revisit recent gatherings and see how your community has been showing up.</p>
          </div>
          <div className="events-grid">
            {payload.past.map((item) => (
              <EventCard key={item.id} item={item} slug={slug} />
            ))}
          </div>
        </section>
      ) : null}
    </PageShell>
  );
}
