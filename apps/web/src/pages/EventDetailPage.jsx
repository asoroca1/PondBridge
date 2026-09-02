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
  HelpCircle,
  Video,
  ExternalLink,
  GraduationCap,
  ShieldCheck,
  UserRound
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
  if (!startsAt || Number.isNaN(startsAt.getTime())) return { month: "", day: "", pending: true };
  const month = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: timezone }).format(startsAt);
  const day = new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: timezone }).format(startsAt);
  return { month: month.toUpperCase(), day, pending: false };
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

function isSeminar(item = {}) {
  return item?.eventType === "seminar";
}

function meetingProviderLabel(value = "") {
  if (value === "zoom") return "Zoom";
  if (value === "microsoft_teams") return "Microsoft Teams";
  if (value === "google_meet") return "Google Meet";
  return "Online meeting";
}

function audienceLabel(value = "") {
  if (value === "young_alumni") return "Young alumni";
  if (value === "college_applicants") return "College applicants";
  if (value === "career_explorers") return "Career explorers";
  if (value === "students") return "Students";
  if (value === "parents") return "Parents";
  return "All members";
}

function topicCategoryLabel(value = "") {
  if (value === "career") return "Career";
  if (value === "college") return "College";
  if (value === "financial_literacy") return "Financial literacy";
  if (value === "networking") return "Networking";
  if (value === "other") return "Community";
  return "";
}

export default function EventDetailPage() {
  const params = useParams();
  const eventId = params.eventId;
  const { token } = useAuth();
  const { slug: tenantSlug } = useTenant();
  const slug = params.slug || tenantSlug || "";
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [joinError, setJoinError] = useState("");

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
      setJoinError("");
    } catch (saveError) {
      setError(saveError.message || "Could not update your RSVP.");
    } finally {
      setSaving(false);
    }
  }

  async function openSeminarRoom() {
    if (!item?.meetingAccess?.canRequestJoinLink || joining) return;
    setJoining(true);
    setJoinError("");
    const roomWindow = window.open("about:blank", "_blank");
    if (roomWindow) {
      roomWindow.opener = null;
      roomWindow.document.title = `Opening ${meetingProviderLabel(item.meetingProvider)}…`;
    }

    try {
      const payload = await requestJson(`/api/t/${slug}/events/${eventId}/join`, {
        method: "POST",
        token,
        body: {}
      });
      const meetingUrl = String(payload?.meetingUrl || "").trim();
      const parsed = new URL(meetingUrl);
      if (parsed.protocol !== "https:") {
        throw new Error("The meeting room returned an invalid link.");
      }
      if (roomWindow) {
        roomWindow.location.replace(parsed.toString());
      } else {
        window.location.assign(parsed.toString());
      }
    } catch (joinRequestError) {
      if (roomWindow) roomWindow.close();
      setJoinError(joinRequestError.message || "Could not open the info session room.");
    } finally {
      setJoining(false);
    }
  }

  const rsvpLocked = Boolean(item?.rsvpClosed || item?.status === "canceled");
  const seminar = isSeminar(item || {});
  const bd = useMemo(() => dateBadge(item || {}), [item]);
  const noun = seminar ? "info session" : "event";
  const canceled = item?.status === "canceled";
  const scheduled = !bd.pending;
  const viewerIsAttending = item?.myRsvp?.status === "attending";
  const canJoinRoom = Boolean(item?.meetingAccess?.canRequestJoinLink);
  // The room can be closed for two very different reasons. Saying "RSVP Going"
  // to someone who already RSVP'd Going is the bug this distinguishes.
  const roomBlockedReason = canJoinRoom
    ? ""
    : canceled
      ? "canceled"
      : item?.meetingAccess?.isHost || viewerIsAttending
        ? "not_ready"
        : "needs_rsvp";
  const hasBody = Boolean(String(item?.bodyHtml || "").trim());
  const presenters = Array.isArray(item?.presenters) ? item.presenters : [];
  const hasHostCard = presenters.length > 0;
  const leanLayout = Boolean(item) && !hasBody && !hasHostCard;
  const hasMainContent = hasBody || seminar || hasHostCard || Boolean(item?.locationAddress);
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
          <span>All events & info sessions</span>
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
              <div
                className={`ev-detail-date-chip ${bd.pending ? "is-pending" : ""}`.trim()}
                aria-hidden="true"
              >
                {bd.pending ? (
                  <span className="ev-date-chip-pending">Date TBD</span>
                ) : (
                  <>
                    <span className="ev-date-chip-month">{bd.month}</span>
                    <span className="ev-date-chip-day">{bd.day}</span>
                  </>
                )}
              </div>
              <div className="ev-detail-hero-copy">
                {seminar ? (
                  <span className="ev-type-chip is-seminar">
                    <GraduationCap size={12} aria-hidden="true" />
                    Registered-member info session
                  </span>
                ) : null}
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
                    {item.deliveryMode === "online" ? (
                      <Video size={14} aria-hidden="true" />
                    ) : (
                      <MapPin size={14} aria-hidden="true" />
                    )}
                    <span>
                      {item.deliveryMode === "online"
                        ? meetingProviderLabel(item.meetingProvider)
                        : item.deliveryMode === "hybrid"
                          ? `Online + ${item.locationName || "in person"}`
                          : item.locationName || "Location coming soon"}
                    </span>
                  </span>
                </div>
              </div>
            </div>
          </section>

          {!scheduled && !canceled ? (
            <div className="ev-detail-notice">
              <CalendarDays size={18} aria-hidden="true" />
              <div>
                <strong>This {noun} isn’t scheduled yet.</strong>
                <p>
                  {viewerIsAttending
                    ? `You’re on the list — we’ll email you as soon as the date and ${
                        seminar ? "meeting link are" : "location are"
                      } set.`
                    : `RSVP Going and we’ll email you as soon as the date and ${
                        seminar ? "meeting link are" : "location are"
                      } set.`}
                </p>
              </div>
            </div>
          ) : null}

          <section className={`ev-detail-grid ${leanLayout ? "is-lean" : ""}`.trim()}>
            {hasMainContent ? (
            <article className="ev-detail-card ev-detail-main">
              <header className="ev-detail-card-head">
                <h2>
                  {hasBody
                    ? seminar
                      ? "About this info session"
                      : "About this event"
                    : seminar
                      ? "Info session details"
                      : "Event details"}
                </h2>
                {item.locationAddress ? (
                  <p className="ev-detail-card-sub">
                    <MapPin size={13} aria-hidden="true" />
                    <span>{item.locationAddress}</span>
                  </p>
                ) : null}
              </header>
              {hasBody ? (
                <div className="ev-detail-richtext" dangerouslySetInnerHTML={{ __html: item.bodyHtml }} />
              ) : null}
              {seminar ? (
                <div className="ev-seminar-facts">
                  {item.topicTitle ? (
                    <div>
                      <span>Topic</span>
                      <strong>{item.topicTitle}</strong>
                    </div>
                  ) : null}
                  {item.topicCategory ? (
                    <div>
                      <span>Track</span>
                      <strong>{topicCategoryLabel(item.topicCategory)}</strong>
                    </div>
                  ) : null}
                  <div>
                    <span>For</span>
                    <strong>{audienceLabel(item.audience)}</strong>
                  </div>
                  {item.capacity ? (
                    <div>
                      <span>Capacity</span>
                      <strong>{item.capacity} members</strong>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {presenters.length ? (
                <div className="ev-seminar-hosts">
                  <p className="ev-seminar-hosts-label">
                    {seminar
                      ? presenters.length > 1
                        ? "Presented by registered members"
                        : "Presented by a registered member"
                      : presenters.length > 1
                        ? "Hosted by"
                        : "Hosted by"}
                  </p>
                  {presenters.map((person) => (
                    <div className="ev-seminar-host-card" key={person.id}>
                      <div className="ev-seminar-host-avatar" aria-hidden="true">
                        {person.avatarUrl ? <img src={person.avatarUrl} alt="" /> : <UserRound size={20} />}
                      </div>
                      <div>
                        <span>{seminar ? "Presenter" : "Host"}</span>
                        <strong>{person.fullName}</strong>
                        <p>{person.industry || person.roleAtCamp || "Camp community member"}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </article>
            ) : null}

            <aside className="ev-detail-side">
              {seminar && item.meetingAccess ? (
                <article className="ev-detail-card ev-seminar-room-card">
                  <header className="ev-detail-card-head">
                    <div className="ev-seminar-room-title">
                      <span className="ev-seminar-room-icon">
                        <Video size={17} aria-hidden="true" />
                      </span>
                      <div>
                        <h2>Info session room</h2>
                        <p className="ev-detail-card-sub">{meetingProviderLabel(item.meetingProvider)}</p>
                      </div>
                    </div>
                  </header>
                  <div className="ev-seminar-access-note" id="seminar-room-access-note">
                    <ShieldCheck size={16} aria-hidden="true" />
                    <span>
                      PondBridge releases this link only to signed-in registered members who RSVP Going.
                    </span>
                  </div>
                  {canJoinRoom ? (
                    <button
                      type="button"
                      className="ev-btn ev-btn-primary ev-seminar-join-btn"
                      aria-describedby="seminar-room-access-note"
                      disabled={joining}
                      onClick={openSeminarRoom}
                    >
                      {joining
                        ? "Opening room…"
                        : item.meetingAccess.isHost
                          ? "Open host room"
                          : "Join info session"}
                      <ExternalLink size={15} aria-hidden="true" />
                    </button>
                  ) : roomBlockedReason === "needs_rsvp" ? (
                    <p className="ev-detail-muted">
                      RSVP <strong>Going</strong> to unlock the info session room.
                    </p>
                  ) : roomBlockedReason === "not_ready" ? (
                    <p className="ev-detail-muted">
                      You’re registered. The {meetingProviderLabel(item.meetingProvider)} link opens
                      here once directors finish scheduling this info session.
                    </p>
                  ) : null}
                  {joinError ? <p className="ev-detail-error">{joinError}</p> : null}
                </article>
              ) : null}
              <article className="ev-detail-card">
                <header className="ev-detail-card-head">
                  <h2>{seminar ? "Your registration" : "Your RSVP"}</h2>
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
                        aria-pressed={isActive}
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
                  {item.counts?.maybe ? (
                    <div className="ev-detail-count is-maybe">
                      <strong>{item.counts.maybe}</strong>
                      <span>Maybe</span>
                    </div>
                  ) : null}
                  {item.counts?.notAttending ? (
                    <div className="ev-detail-count is-not">
                      <strong>{item.counts.notAttending}</strong>
                      <span>Can’t go</span>
                    </div>
                  ) : null}
                </div>
              </article>
            </aside>
          </section>
        </>
      ) : null}
    </main>
  );
}
