import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CalendarDays, MapPin, Users, ChevronRight } from "lucide-react";
import { Input, Textarea } from "@pondbridge/ui";
import { requestJson } from "../lib/http.js";
import { uploadTenantImage } from "../lib/imageUploads.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useTenant } from "../context/TenantContext.jsx";
import { tenantRoute } from "../lib/tenantRouting.js";
import CedarPageHeader from "../cedar/components/CedarPageHeader.jsx";
import { useDialogFocus } from "../components/admin/AdminUi.jsx";

const DEFAULT_EVENT_FORM = {
  title: "",
  summary: "",
  bodyHtml: "",
  coverImageUrl: "",
  startsAt: "",
  endsAt: "",
  timezone: "America/New_York",
  locationName: "",
  locationAddress: "",
  rsvpDeadlineAt: ""
};

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

function EventCard({ item, slug, featured = false }) {
  const bd = dateBadge(item);
  const toneClass = rsvpToneClass(item);
  const coverStyle = item.coverImageUrl
    ? {
        backgroundImage: `linear-gradient(180deg, rgba(9,22,37,0.05) 0%, rgba(9,22,37,0.72) 100%), url(${item.coverImageUrl})`
      }
    : undefined;

  return (
    <Link
      to={tenantRoute(slug, `/events/${item.id}`)}
      className={`ev-card ${featured ? "is-featured" : ""}`.trim()}
      aria-label={`Open ${item.title}`}
    >
      <div className="ev-card-cover" style={coverStyle}>
        <div className="ev-date-chip" aria-hidden="true">
          <span className="ev-date-chip-month">{bd.month}</span>
          <span className="ev-date-chip-day">{bd.day}</span>
        </div>
        <span className={`ev-status-chip ${toneClass}`}>{rsvpLabel(item)}</span>
      </div>
      <div className="ev-card-body">
        <p className="ev-card-when">{formatDatePartLong(item)}{formatTimePart(item) ? ` · ${formatTimePart(item)}` : ""}</p>
        <h3 className="ev-card-title">{item.title}</h3>
        {item.summary ? <p className="ev-card-summary">{item.summary}</p> : null}
        <div className="ev-card-meta">
          <span className="ev-meta-item">
            <MapPin size={14} aria-hidden="true" />
            <span>{item.locationName || "Location TBA"}</span>
          </span>
          <span className="ev-meta-item">
            <Users size={14} aria-hidden="true" />
            <span>{item.counts?.attending || 0} going</span>
          </span>
        </div>
        <span className="ev-card-cta">
          {featured ? "Open event" : "View details"}
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
      <div className="ev-row-date" aria-hidden="true">
        <span className="ev-row-date-month">{bd.month}</span>
        <span className="ev-row-date-day">{bd.day}</span>
      </div>
      <div className="ev-row-body">
        <div className="ev-row-head">
          <h3>{item.title}</h3>
          <span className={`ev-status-chip ${toneClass}`}>{rsvpLabel(item)}</span>
        </div>
        <div className="ev-row-meta">
          <span>{formatTimePart(item) || "Time TBA"}</span>
          <span className="ev-row-dot" aria-hidden="true" />
          <span>{item.locationName || "Location TBA"}</span>
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
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createSaving, setCreateSaving] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createStatus, setCreateStatus] = useState("");
  const [coverUploading, setCoverUploading] = useState(false);
  const [coverUploadError, setCoverUploadError] = useState("");
  const [coverInputKey, setCoverInputKey] = useState(0);
  const [eventForm, setEventForm] = useState({ ...DEFAULT_EVENT_FORM });
  const createDialogRef = useDialogFocus(createModalOpen, closeCreateModal);
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

  function openCreateModal() {
    setEventForm({ ...DEFAULT_EVENT_FORM });
    setCreateError("");
    setCreateStatus("");
    setCoverUploadError("");
    setCoverInputKey((value) => value + 1);
    setCreateModalOpen(true);
  }

  function closeCreateModal() {
    if (createSaving) return;
    setCreateModalOpen(false);
    setCreateError("");
    setCoverUploadError("");
  }

  function updateEventField(key, value) {
    setEventForm((current) => ({ ...current, [key]: value }));
  }

  async function handleCoverFileChange(event) {
    const file = event.target.files?.[0] || null;
    if (!file) return;

    setCoverUploading(true);
    setCoverUploadError("");
    try {
      const objectUrl = await uploadTenantImage({
        slug,
        token,
        file,
        scope: "event-cover"
      });
      setEventForm((current) => ({ ...current, coverImageUrl: objectUrl }));
    } catch (uploadError) {
      setCoverUploadError(uploadError.message || "Failed to upload cover image.");
    } finally {
      setCoverUploading(false);
      setCoverInputKey((value) => value + 1);
    }
  }

  function clearCoverImage() {
    setEventForm((current) => ({ ...current, coverImageUrl: "" }));
    setCoverUploadError("");
    setCoverInputKey((value) => value + 1);
  }

  async function createEvent(event) {
    event.preventDefault();
    setCreateSaving(true);
    setCreateError("");
    setCreateStatus("");

    try {
      const response = await requestJson(`/api/t/${slug}/admin/events`, {
        method: "POST",
        token,
        body: {
          title: eventForm.title,
          summary: eventForm.summary,
          bodyHtml: eventForm.bodyHtml,
          coverImageUrl: eventForm.coverImageUrl,
          startsAt: eventForm.startsAt ? new Date(eventForm.startsAt).toISOString() : null,
          endsAt: eventForm.endsAt ? new Date(eventForm.endsAt).toISOString() : null,
          timezone: eventForm.timezone,
          locationName: eventForm.locationName,
          locationAddress: eventForm.locationAddress,
          rsvpDeadlineAt: eventForm.rsvpDeadlineAt ? new Date(eventForm.rsvpDeadlineAt).toISOString() : null
        }
      });
      const createdTitle = String(response?.item?.title || eventForm.title || "Event").trim();
      setCreateStatus(`Draft event "${createdTitle}" created. Publish it when you're ready.`);
      setCreateModalOpen(false);
      setEventForm({ ...DEFAULT_EVENT_FORM });
      await loadEvents();
    } catch (requestError) {
      setCreateError(requestError.message || "Failed to create event.");
    } finally {
      setCreateSaving(false);
    }
  }

  const featured = payload.featured;
  const upcomingCards = useMemo(() => {
    if (!featured) return payload.upcoming;
    return payload.upcoming.filter((item) => item.id !== featured.id);
  }, [featured, payload.upcoming]);

  const goingList = useMemo(() => {
    const src = [...payload.upcoming, ...payload.past];
    return src.filter((item) => item?.myRsvp?.status === "attending" || item?.myRsvp?.status === "maybe");
  }, [payload.upcoming, payload.past]);

  const schemaMissing = /supabase:apply-schema|schema is missing/i.test(error);

  const counts = {
    upcoming: payload.upcoming.length,
    past: payload.past.length,
    going: goingList.length
  };

  const activeList =
    tab === "past" ? payload.past : tab === "going" ? goingList : upcomingCards;

  const showFeaturedBanner = !loading && !error && tab === "upcoming" && featured;

  return (
    <main className="ev-wrap nav2-page-shell">
      <CedarPageHeader
        icon={<CalendarDays size={18} />}
        title="Events"
        subtitle="Gatherings, reunions, and community moments from your camp."
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
              <span className="ev-tab-count">{counts.upcoming}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "going"}
              className={`ev-tab ${tab === "going" ? "is-active" : ""}`}
              onClick={() => setTab("going")}
            >
              My RSVPs
              <span className="ev-tab-count">{counts.going}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "past"}
              className={`ev-tab ${tab === "past" ? "is-active" : ""}`}
              onClick={() => setTab("past")}
            >
              Past
              <span className="ev-tab-count">{counts.past}</span>
            </button>
          </div>
          {canManageEvents ? (
            <button type="button" className="ev-btn ev-btn-primary ev-admin-link" onClick={openCreateModal}>
              Create Event
            </button>
          ) : null}
        </div>
      </CedarPageHeader>

      {createStatus ? <div className="ev-message is-success"><p>{createStatus}</p></div> : null}

      {showFeaturedBanner ? (
        <section className="ev-featured">
          <div
            className="ev-featured-media"
            style={
              featured.coverImageUrl
                ? {
                    backgroundImage: `linear-gradient(100deg, rgba(10,24,40,0.86) 0%, rgba(10,24,40,0.35) 60%, rgba(10,24,40,0.05) 100%), url(${featured.coverImageUrl})`
                  }
                : undefined
            }
          />
          <div className="ev-featured-copy">
            <span className="ev-featured-eyebrow">Featured · Next up</span>
            <h2>{featured.title}</h2>
            <p className="ev-featured-when">
              {formatDatePartLong(featured)}
              {formatTimePart(featured) ? ` · ${formatTimePart(featured)}` : ""}
            </p>
            {featured.summary ? <p className="ev-featured-summary">{featured.summary}</p> : null}
            <div className="ev-featured-meta">
              <span className="ev-meta-item">
                <MapPin size={14} aria-hidden="true" />
                <span>{featured.locationName || "Location TBA"}</span>
              </span>
              <span className="ev-meta-item">
                <Users size={14} aria-hidden="true" />
                <span>{featured.counts?.attending || 0} going</span>
              </span>
              <span className={`ev-status-chip ${rsvpToneClass(featured)}`}>{rsvpLabel(featured)}</span>
            </div>
            <Link className="ev-btn ev-btn-primary" to={tenantRoute(slug, `/events/${featured.id}`)}>
              See event details
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
          {activeList.length === 0 ? (
            <div className="ev-empty">
              <CalendarDays size={32} className="ev-empty-icon" aria-hidden="true" />
              <h3>
                {tab === "past"
                  ? "No past events yet."
                  : tab === "going"
                  ? "You haven’t RSVP’d to anything."
                  : "The calendar is ready for its first event."}
              </h3>
              <p>
                {tab === "past"
                  ? "When events wrap up, they’ll move here so you can revisit the highlights."
                  : tab === "going"
                  ? "Tap into an upcoming event and let your camp know you’re coming."
                  : "Check back soon or reach out to your camp directors if you expected an event here."}
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

      {createModalOpen ? (
        <div className="pb-admin-ui-modal-backdrop ev-create-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="ev-create-title" onClick={closeCreateModal}>
          <div ref={createDialogRef} className="pb-admin-ui-modal director-admin-event-modal ev-create-modal" onClick={(event) => event.stopPropagation()} tabIndex={-1}>
            <div className="ev-create-modal-head">
              <h3 id="ev-create-title">Create Event</h3>
              <p>Create a draft event right here, then publish it when you're ready.</p>
            </div>
            <form className="director-events-form-grid director-admin-event-modal-form ev-create-modal-form" onSubmit={createEvent}>
              <label className="full-width">
                Event title
                <Input
                  value={eventForm.title}
                  onChange={(event) => updateEventField("title", event.target.value)}
                  placeholder="Camp Cedar Alumni Weekend"
                />
              </label>
              <label className="full-width">
                Summary
                <Textarea
                  className="ev-create-modal-summary"
                  rows={4}
                  value={eventForm.summary}
                  onChange={(event) => updateEventField("summary", event.target.value)}
                  placeholder="A short overview for the event card and hero section."
                />
              </label>
              <label className="full-width">
                Event details
                <Textarea
                  className="ev-create-modal-details"
                  rows={6}
                  value={eventForm.bodyHtml}
                  onChange={(event) => updateEventField("bodyHtml", event.target.value)}
                  placeholder="Share the schedule, who should attend, and what to expect."
                />
              </label>
              <div className="full-width ev-cover-field">
                <span>Cover image</span>
                <div className="ev-cover-upload">
                  <Input
                    key={coverInputKey}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                    onChange={handleCoverFileChange}
                  />
                  <div className="ev-cover-upload-actions">
                    <p className="muted">
                      Upload a PNG, JPG, WebP, GIF, or SVG cover image.
                      {coverUploading ? " Uploading..." : ""}
                    </p>
                    {eventForm.coverImageUrl ? (
                      <button type="button" className="ev-btn" onClick={clearCoverImage} disabled={coverUploading}>
                        Remove image
                      </button>
                    ) : null}
                  </div>
                  {coverUploadError ? <p className="error-text">{coverUploadError}</p> : null}
                  {eventForm.coverImageUrl ? (
                    <div className="ev-cover-preview">
                      <img src={eventForm.coverImageUrl} alt="Event cover preview" />
                    </div>
                  ) : null}
                </div>
              </div>
              <label>
                Starts at
                <Input
                  type="datetime-local"
                  value={eventForm.startsAt}
                  onChange={(event) => updateEventField("startsAt", event.target.value)}
                />
              </label>
              <label>
                Ends at
                <Input
                  type="datetime-local"
                  value={eventForm.endsAt}
                  onChange={(event) => updateEventField("endsAt", event.target.value)}
                />
              </label>
              <label>
                Timezone
                <Input
                  value={eventForm.timezone}
                  onChange={(event) => updateEventField("timezone", event.target.value)}
                  placeholder="America/New_York"
                />
              </label>
              <label>
                RSVP deadline
                <Input
                  type="datetime-local"
                  value={eventForm.rsvpDeadlineAt}
                  onChange={(event) => updateEventField("rsvpDeadlineAt", event.target.value)}
                />
              </label>
              <label>
                Location name
                <Input
                  value={eventForm.locationName}
                  onChange={(event) => updateEventField("locationName", event.target.value)}
                  placeholder="Camp Cedar waterfront"
                />
              </label>
              <label>
                Location address
                <Input
                  value={eventForm.locationAddress}
                  onChange={(event) => updateEventField("locationAddress", event.target.value)}
                  placeholder="123 Camp Road, City, State"
                />
              </label>
              {createError ? <p className="error-text">{createError}</p> : null}
              <div className="pb-admin-ui-modal-actions ev-create-modal-actions">
                <button type="button" className="ev-btn" onClick={closeCreateModal} disabled={createSaving}>
                  Cancel
                </button>
                <button type="submit" className="ev-btn ev-btn-primary" disabled={createSaving}>
                  {createSaving ? "Creating..." : "Create Draft"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </main>
  );
}
