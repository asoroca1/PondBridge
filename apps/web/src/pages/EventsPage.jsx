import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CalendarDays, MapPin, Users, ChevronRight, Video, GraduationCap } from "lucide-react";
import { requestJson } from "../lib/http.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useTenant } from "../context/TenantContext.jsx";
import { tenantRoute } from "../lib/tenantRouting.js";
import CedarPageHeader from "../cedar/components/CedarPageHeader.jsx";

function normalizeRoleSet(value) {
  const rawRoles = Array.isArray(value?.roles)
    ? value.roles
    : value?.roles
      ? [value.roles]
      : value?.role
        ? [value.role]
        : [];

  return new Set(
    rawRoles
      .map((role) => String(role || "").trim().toLowerCase())
      .filter(Boolean)
  );
}

function formatDatePartLong(item = {}) {
  const timezone = String(item?.timezone || "America/New_York");
  const startsAt = item?.startsAt ? new Date(item.startsAt) : null;
  if (!startsAt || Number.isNaN(startsAt.getTime())) return "Date coming soon";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: timezone
  }).format(startsAt);
}

function formatTimePart(item = {}) {
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
  if (!endsAt || Number.isNaN(endsAt.getTime())) return start;

  // An event that runs past midnight ends on a different day, and "9:33 PM – 1:33 AM"
  // does not say so. Name the day when it changes, in the event's own timezone.
  const dayFormatter = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    timeZone: timezone
  });
  const end = timeFormatter.format(endsAt);
  if (dayFormatter.format(startsAt) === dayFormatter.format(endsAt)) {
    return `${start} – ${end}`;
  }
  const endDay = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: timezone
  }).format(endsAt);
  return `${start} – ${end} (${endDay})`;
}

function dateBadge(item = {}) {
  const timezone = String(item?.timezone || "America/New_York");
  const startsAt = item?.startsAt ? new Date(item.startsAt) : null;
  if (!startsAt || Number.isNaN(startsAt.getTime())) return { month: "", day: "", pending: true };
  const month = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: timezone }).format(startsAt);
  const day = new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: timezone }).format(startsAt);
  return { month: month.toUpperCase(), day, pending: false };
}

function DateChip({ badge, className, partClass = "ev-date-chip" }) {
  if (badge.pending) {
    return (
      <div className={`${className} is-pending`} aria-hidden="true">
        <span className="ev-date-chip-pending">Date TBD</span>
      </div>
    );
  }
  return (
    <div className={className} aria-hidden="true">
      <span className={`${partClass}-month`}>{badge.month}</span>
      <span className={`${partClass}-day`}>{badge.day}</span>
    </div>
  );
}

function rsvpLabel(item = {}) {
  if (item.status === "canceled") return "Canceled";
  if (item.myRsvp?.status === "attending") return "You’re going";
  if (item.myRsvp?.status === "maybe") return "You said maybe";
  if (item.myRsvp?.status === "not_attending") return "Not attending";
  return item.phase === "past" ? "Past event" : "RSVP open";
}

function rsvpToneClass(item = {}) {
  if (item.status === "canceled") return "is-danger";
  if (item.myRsvp?.status === "attending") return "is-success";
  if (item.myRsvp?.status === "maybe") return "is-warning";
  if (item.myRsvp?.status === "not_attending") return "is-neutral";
  return "is-open";
}

function isSeminar(item = {}) {
  return item?.eventType === "seminar";
}

function eventNoun(item = {}) {
  return isSeminar(item) ? "info session" : "event";
}

function eventLocationLabel(item = {}) {
  if (item?.deliveryMode === "online") {
    if (item?.meetingProvider === "microsoft_teams") return "Microsoft Teams";
    if (item?.meetingProvider === "google_meet") return "Google Meet";
    if (item?.meetingProvider === "zoom") return "Zoom";
    return "Online";
  }
  if (item?.deliveryMode === "hybrid") {
    return item?.locationName ? `Online + ${item.locationName}` : "Online + in person";
  }
  return item?.locationName || "Location TBA";
}

function EventLocationIcon({ item, size = 14 }) {
  const Icon = item?.deliveryMode === "online" ? Video : MapPin;
  return <Icon size={size} aria-hidden="true" />;
}

function EventCard({ item, slug, featured = false }) {
  const bd = dateBadge(item);
  const toneClass = rsvpToneClass(item);
  const coverStyle = item.coverImageUrl
    ? {
        backgroundImage: `linear-gradient(180deg, rgba(20, 20, 20,0.05) 0%, rgba(20, 20, 20,0.72) 100%), url(${item.coverImageUrl})`
      }
    : undefined;

  return (
    <Link
      to={tenantRoute(slug, `/events/${item.id}`)}
      className={`ev-card ${featured ? "is-featured" : ""}`.trim()}
      aria-label={`Open ${item.title}`}
    >
      <div className="ev-card-cover" style={coverStyle}>
        {!item.coverImageUrl ? (
          <div className={`ev-card-cover-fallback ${isSeminar(item) ? "is-seminar" : ""}`} aria-hidden="true">
            {isSeminar(item) ? <GraduationCap size={30} /> : <CalendarDays size={30} />}
            <span>{isSeminar(item) ? item.topicTitle || "Alumni info session" : "Camp community"}</span>
          </div>
        ) : null}
        <DateChip badge={bd} className="ev-date-chip" />
        <div className="ev-card-cover-chips">
          {isSeminar(item) ? (
            <span className="ev-type-chip is-seminar">
              <GraduationCap size={12} aria-hidden="true" />
              Info session
            </span>
          ) : null}
          <span className={`ev-status-chip ${toneClass}`}>{rsvpLabel(item)}</span>
        </div>
      </div>
      <div className="ev-card-body">
        <p className="ev-card-when">{formatDatePartLong(item)}{formatTimePart(item) ? ` · ${formatTimePart(item)}` : ""}</p>
        <h3 className="ev-card-title">{item.title}</h3>
        {item.summary ? <p className="ev-card-summary">{item.summary}</p> : null}
        <div className="ev-card-meta">
          <span className="ev-meta-item">
            <EventLocationIcon item={item} />
            <span>{eventLocationLabel(item)}</span>
          </span>
          <span className="ev-meta-item">
            <Users size={14} aria-hidden="true" />
            <span>{item.counts?.attending || 0} going</span>
          </span>
        </div>
        <span className="ev-card-cta">
          {featured ? `Open ${eventNoun(item)}` : `View ${eventNoun(item)} details`}
          <ChevronRight size={14} aria-hidden="true" />
        </span>
      </div>
    </Link>
  );
}

function EventRow({ item, slug }) {
  const bd = dateBadge(item);
  const toneClass = rsvpToneClass(item);
  return (
    <Link to={tenantRoute(slug, `/events/${item.id}`)} className="ev-row">
      <DateChip badge={bd} className="ev-row-date" partClass="ev-row-date" />
      <div className="ev-row-body">
        <div className="ev-row-head">
          <h3>{item.title}</h3>
          {isSeminar(item) ? <span className="ev-type-chip is-seminar">Info session</span> : null}
          <span className={`ev-status-chip ${toneClass}`}>{rsvpLabel(item)}</span>
        </div>
        <div className="ev-row-meta">
          <span>{formatTimePart(item) || "Time TBA"}</span>
          <span className="ev-row-dot" aria-hidden="true" />
          <span>{eventLocationLabel(item)}</span>
          <span className="ev-row-dot" aria-hidden="true" />
          <span>{item.counts?.attending || 0} going</span>
        </div>
      </div>
      <ChevronRight size={18} className="ev-row-chev" aria-hidden="true" />
    </Link>
  );
}

function SkeletonCard() {
  return (
    <div className="ev-card ev-card-skel" aria-hidden="true">
      <div className="ev-card-cover ev-skel-shimmer" />
      <div className="ev-card-body">
        <div className="ev-skel-line ev-skel-shimmer" style={{ width: "40%" }} />
        <div className="ev-skel-line ev-skel-shimmer" style={{ width: "85%", height: 18 }} />
        <div className="ev-skel-line ev-skel-shimmer" style={{ width: "65%" }} />
      </div>
    </div>
  );
}

export default function EventsPage() {
  const params = useParams();
  const { token, user } = useAuth();
  const { slug: tenantSlug } = useTenant();
  const slug = params.slug || tenantSlug || "";
  const [payload, setPayload] = useState({ featured: null, upcoming: [], past: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("upcoming"); // upcoming | past | going
  const [typeFilter, setTypeFilter] = useState("all"); // all | seminar | community
  const roleSet = useMemo(() => normalizeRoleSet(user), [user]);
  const canManageEvents =
    roleSet.has("tenant_admin") || roleSet.has("admin") || roleSet.has("super_admin");

  async function loadEvents() {
    setLoading(true);
    setError("");
    try {
      const next = await requestJson(`/api/t/${slug}/events`, { token });
      setPayload({
        featured: next?.featured || null,
        upcoming: Array.isArray(next?.upcoming) ? next.upcoming : [],
        past: Array.isArray(next?.past) ? next.past : []
      });
    } catch (loadError) {
      setError(loadError.message || "Unable to load events right now.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadEvents().catch(() => {});
  }, [slug, token]);

  const filteredUpcoming = useMemo(
    () => payload.upcoming.filter((item) => typeFilter === "all" || item?.eventType === typeFilter),
    [payload.upcoming, typeFilter]
  );
  const filteredPast = useMemo(
    () => payload.past.filter((item) => typeFilter === "all" || item?.eventType === typeFilter),
    [payload.past, typeFilter]
  );
  // The hero is a recommendation ("NEXT UP"), so it must not promote something nobody
  // can attend. A cancelled event still belongs in the list below with its badge.
  const featured = filteredUpcoming.find((item) => item?.status !== "canceled") || null;
  const upcomingCards = useMemo(() => {
    if (!featured) return filteredUpcoming;
    return filteredUpcoming.filter((item) => item.id !== featured.id);
  }, [featured, filteredUpcoming]);

  const goingList = useMemo(() => {
    const src = [...filteredUpcoming, ...filteredPast];
    return src.filter((item) => item?.myRsvp?.status === "attending" || item?.myRsvp?.status === "maybe");
  }, [filteredUpcoming, filteredPast]);

  const schemaMissing = /supabase:apply-schema|schema is missing/i.test(error);

  const counts = {
    upcoming: filteredUpcoming.length,
    past: filteredPast.length,
    going: goingList.length
  };

  const activeList =
    tab === "past" ? filteredPast : tab === "going" ? goingList : upcomingCards;

  const showFeaturedBanner = !loading && !error && tab === "upcoming" && featured;
  // The artwork panel sits beside the headline, so it only earns a subject line
  // when the topic says something the headline does not already say.
  const featuredSubject = useMemo(() => {
    if (!featured || !isSeminar(featured)) return "";
    const topic = String(featured.topicTitle || "").trim();
    const title = String(featured.title || "").trim();
    if (!topic || topic.toLowerCase() === title.toLowerCase()) return "";
    return topic;
  }, [featured]);

  return (
    <main className="ev-wrap nav2-page-shell">
      <CedarPageHeader
        icon={<CalendarDays size={18} />}
        title="Events & info sessions"
        subtitle="Gather in person, learn from alumni, and join live online sessions."
      >
        <div className="ev-header-actions">
          <div className="ev-header-tools" role="tablist" aria-label="Filter events">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "upcoming"}
              className={`ev-tab ${tab === "upcoming" ? "is-active" : ""}`}
              onClick={() => setTab("upcoming")}
            >
              Upcoming
              {counts.upcoming > 0 ? <span className="ev-tab-count">{counts.upcoming}</span> : null}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "going"}
              className={`ev-tab ${tab === "going" ? "is-active" : ""}`}
              onClick={() => setTab("going")}
            >
              My RSVPs
              {counts.going > 0 ? <span className="ev-tab-count">{counts.going}</span> : null}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "past"}
              className={`ev-tab ${tab === "past" ? "is-active" : ""}`}
              onClick={() => setTab("past")}
            >
              Past
              {counts.past > 0 ? <span className="ev-tab-count">{counts.past}</span> : null}
            </button>
          </div>
          {canManageEvents ? (
            <Link
              className="ev-btn ev-admin-link"
              to={tenantRoute(slug, "/admin/events")}
            >
              Manage schedule
            </Link>
          ) : null}
        </div>
      </CedarPageHeader>

      <div className="ev-type-filter" role="group" aria-label="Show schedule type">
        <button
          type="button"
          aria-pressed={typeFilter === "all"}
          className={typeFilter === "all" ? "is-active" : ""}
          onClick={() => setTypeFilter("all")}
        >
          All
        </button>
        <button
          type="button"
          aria-pressed={typeFilter === "seminar"}
          className={typeFilter === "seminar" ? "is-active" : ""}
          onClick={() => setTypeFilter("seminar")}
        >
          <GraduationCap size={14} aria-hidden="true" />
          Info sessions
        </button>
        <button
          type="button"
          aria-pressed={typeFilter === "community"}
          className={typeFilter === "community" ? "is-active" : ""}
          onClick={() => setTypeFilter("community")}
        >
          <CalendarDays size={14} aria-hidden="true" />
          Events
        </button>
      </div>

      {showFeaturedBanner ? (
        <section className="ev-featured">
          <div
            className={`ev-featured-media ${featured.coverImageUrl ? "has-cover" : ""} ${isSeminar(featured) ? "is-seminar" : ""}`.trim()}
            style={
              featured.coverImageUrl
                ? {
                    backgroundImage: `linear-gradient(100deg, rgba(22, 22, 22,0.86) 0%, rgba(22, 22, 22,0.35) 60%, rgba(22, 22, 22,0.05) 100%), url(${featured.coverImageUrl})`
                  }
                : undefined
            }
          >
            {!featured.coverImageUrl ? (
              <div className="ev-featured-fallback" aria-hidden="true">
                <span className="ev-featured-fallback-icon">
                  {isSeminar(featured) ? <GraduationCap size={42} /> : <CalendarDays size={42} />}
                </span>
                <span>{isSeminar(featured) ? "Alumni-led info session" : "Camp community event"}</span>
                {featuredSubject ? <strong>{featuredSubject}</strong> : null}
              </div>
            ) : null}
          </div>
          <div className="ev-featured-copy">
            <span className="ev-featured-eyebrow">
              {isSeminar(featured) ? "Featured info session · Next up" : "Featured event · Next up"}
            </span>
            <h2>{featured.title}</h2>
            <p className="ev-featured-when">
              {formatDatePartLong(featured)}
              {formatTimePart(featured) ? ` · ${formatTimePart(featured)}` : ""}
            </p>
            {featured.summary ? <p className="ev-featured-summary">{featured.summary}</p> : null}
            <div className="ev-featured-meta">
              <span className="ev-meta-item">
                <EventLocationIcon item={featured} />
                <span>{eventLocationLabel(featured)}</span>
              </span>
              <span className="ev-meta-item">
                <Users size={14} aria-hidden="true" />
                <span>{featured.counts?.attending || 0} going</span>
              </span>
              <span className={`ev-status-chip ${rsvpToneClass(featured)}`}>{rsvpLabel(featured)}</span>
            </div>
            <Link className="ev-btn ev-btn-primary" to={tenantRoute(slug, `/events/${featured.id}`)}>
              See {eventNoun(featured)} details
              <ChevronRight size={16} aria-hidden="true" />
            </Link>
          </div>
        </section>
      ) : null}

      {loading ? (
        <section className="ev-grid" aria-label="Loading events">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </section>
      ) : null}

      {error && !loading ? (
        <div className={`ev-message ${schemaMissing ? "is-warning" : "is-error"}`}>
          <p className="ev-message-eyebrow">{schemaMissing ? "Calendar setup" : "Events unavailable"}</p>
          <h2>{schemaMissing ? "This calendar is still being connected." : "We couldn’t load events just now."}</h2>
          <p>
            {schemaMissing
              ? "The events database is being provisioned for this environment. Directors will be able to create events once that finishes."
              : error}
          </p>
        </div>
      ) : null}

      {!loading && !error ? (
        <section className="ev-list-section">
          {activeList.length === 0 && showFeaturedBanner ? (
            <p className="ev-list-note">
              That’s everything on the calendar right now. More{" "}
              {typeFilter === "seminar" ? "info sessions" : "events"} appear here as your
              directors publish them.
            </p>
          ) : activeList.length === 0 ? (
            <div className="ev-empty">
              <CalendarDays size={32} className="ev-empty-icon" aria-hidden="true" />
              <h3>
                {tab === "past"
                  ? `No past ${typeFilter === "seminar" ? "info sessions" : "events"} yet.`
                  : tab === "going"
                  ? "You haven’t RSVP’d to anything."
                  : typeFilter === "seminar"
                    ? "No upcoming info sessions yet."
                    : "The calendar is ready for its next event."}
              </h3>
              <p>
                {tab === "past"
                  ? "When events wrap up, they’ll move here so you can revisit the highlights."
                  : tab === "going"
                  ? "Open an upcoming event or info session and let your camp know you’re coming."
                  : typeFilter === "seminar"
                    ? "Career, college, and mentorship sessions will appear here when directors publish them."
                    : "Check back soon or reach out to your camp directors if you expected something here."}
              </p>
              {tab !== "upcoming" ? (
                <button type="button" className="ev-btn" onClick={() => setTab("upcoming")}>
                  View upcoming events
                </button>
              ) : null}
            </div>
          ) : tab === "past" ? (
            <div className="ev-rows">
              {activeList.map((item) => (
                <EventRow key={item.id} item={item} slug={slug} />
              ))}
            </div>
          ) : (
            <div className="ev-grid">
              {activeList.map((item) => (
                <EventCard key={item.id} item={item} slug={slug} />
              ))}
            </div>
          )}
        </section>
      ) : null}

    </main>
  );
}
