import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@pondbridge/ui";
import { CalendarPlus } from "lucide-react";
import { ModalConfirm, WorkspaceHeader } from "../../components/admin/AdminUi.jsx";
import { useTenant } from "../../context/TenantContext.jsx";
import { tenantRoute } from "../../lib/tenantRouting.js";
import useAdminApi from "./useAdminApi.js";
import EventComposer from "./events/EventComposer.jsx";
import EventDetailPane from "./events/EventDetailPane.jsx";
import EventTypePicker from "./events/EventTypePicker.jsx";
import EventsAgenda from "./events/EventsAgenda.jsx";
import EventsCalendar from "./events/EventsCalendar.jsx";
import { VIEWS, startOfDay } from "./events/eventUtils.js";
import "./director-admin-events.css";

export default function DirectorAdminEventsPage() {
  const { request } = useAdminApi();
  const { tenant } = useTenant();

  const [view, setView] = useState("calendar");
  const [month, setMonth] = useState(() => new Date());
  const [items, setItems] = useState([]);
  const [moduleEnabled, setModuleEnabled] = useState(true);
  const [platformDisabled, setPlatformDisabled] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const [pickerOpen, setPickerOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerEvent, setComposerEvent] = useState(null);
  const [composerType, setComposerType] = useState("community");
  const [composerDay, setComposerDay] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await request("/events");
      setItems(Array.isArray(payload?.items) ? payload.items : []);
      setModuleEnabled(payload?.moduleEnabled !== false);
      setPlatformDisabled(Boolean(payload?.platformDisabled));
    } catch (requestError) {
      setError(requestError.message || "Could not load events.");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => { loadList(); }, [loadList]);

  // The list payload omits the private meeting link, so the detail pane loads
  // the full record for whichever event is open.
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return undefined;
    }
    let active = true;
    request(`/events/${selectedId}`)
      .then((payload) => { if (active) setDetail(payload?.item || null); })
      .catch(() => { if (active) setDetail(null); });
    return () => { active = false; };
  }, [request, selectedId]);

  const sorted = useMemo(
    () => [...items].sort((a, b) => new Date(a.startsAt || 0) - new Date(b.startsAt || 0)),
    [items]
  );

  const agenda = useMemo(() => {
    const now = startOfDay(new Date());
    if (view === "drafts") return sorted.filter((item) => item.status === "draft");
    if (view === "past") {
      return sorted
        .filter((item) => item.startsAt && new Date(item.startsAt) < now)
        .reverse();
    }
    return sorted.filter((item) => !item.startsAt || new Date(item.startsAt) >= now);
  }, [sorted, view]);

  const counts = useMemo(() => {
    const now = startOfDay(new Date());
    return {
      upcoming: sorted.filter((i) => !i.startsAt || new Date(i.startsAt) >= now).length,
      drafts: sorted.filter((i) => i.status === "draft").length,
      past: sorted.filter((i) => i.startsAt && new Date(i.startsAt) < now).length
    };
  }, [sorted]);

  // Creating always starts with "which kind?" — the two forms differ enough
  // that a dropdown inside one form hid the difference.
  function openCreate(day = null) {
    setComposerEvent(null);
    setComposerDay(day);
    setPickerOpen(true);
  }

  function chooseType(nextType) {
    setPickerOpen(false);
    setComposerType(nextType);
    setComposerEvent(null);
    setComposerOpen(true);
  }

  function openEdit(event) {
    const target = detail || event;
    setComposerEvent(target);
    setComposerType(target?.eventType || "community");
    setComposerDay(null);
    setComposerOpen(true);
  }

  async function saveEvent(payload) {
    setSaving(true);
    setError("");
    try {
      const isEdit = Boolean(composerEvent?.id);
      const response = isEdit
        ? await request(`/events/${composerEvent.id}`, { method: "PATCH", body: payload })
        : await request("/events", { method: "POST", body: payload });
      const saved = response?.item;
      setComposerOpen(false);
      setStatus(isEdit ? "Event updated." : "Event created as a draft.");
      await loadList();
      if (saved?.id) {
        setSelectedId(saved.id);
        setDetail(saved);
        if (saved.startsAt) setMonth(new Date(saved.startsAt));
      }
    } catch (requestError) {
      setError(requestError.message || "Could not save the event.");
    } finally {
      setSaving(false);
    }
  }

  async function runAction(action, event, label) {
    setBusy(action);
    setError("");
    setStatus("");
    try {
      await request(`/events/${event.id}/${action}`, { method: "POST" });
      setStatus(label);
      await loadList();
      const fresh = await request(`/events/${event.id}`).catch(() => null);
      if (fresh?.item) setDetail(fresh.item);
    } catch (requestError) {
      setError(requestError.message || "That action could not be completed.");
    } finally {
      setBusy("");
      setCancelTarget(null);
    }
  }

  async function copyLink(url) {
    try {
      await navigator.clipboard?.writeText(url);
      setStatus("Meeting link copied.");
    } catch {
      setError("Could not copy the link.");
    }
  }

  const memberUrl = detail?.id && tenant?.slug
    ? `${window.location.origin}${tenantRoute(tenant.slug, `/events/${detail.id}`)}`
    : "";

  return (
    <div className="pb-workspace">
      <WorkspaceHeader
        eyebrow="Programming"
        title={"Events & info sessions"} subtitle={"Plan gatherings and online sessions, and see who is coming."} />
      <section className="pb-events">
      <nav className="pb-events-rail" aria-label="Event views">
        <Button type="button" className="pb-events-new-button" onClick={() => openCreate(null)}>
          <CalendarPlus aria-hidden="true" />
          New
        </Button>
        <ul>
          {VIEWS.map((item) => (
            <li key={item.key}>
              <button
                type="button"
                className={view === item.key ? "is-active" : ""}
                onClick={() => setView(item.key)}
              >
                <span>{item.label}</span>
                {item.key !== "calendar" && counts[item.key] > 0 ? (
                  <em>{counts[item.key]}</em>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
        {!moduleEnabled ? (
          <p className="pb-events-rail-note">
            {platformDisabled
              ? "Events are hidden from members across all networks right now."
              : "Members cannot see events until the module is switched on in Features & services."}
          </p>
        ) : null}
      </nav>

      <div className="pb-events-surface">
        {error ? <p className="error-text" role="alert">{error}</p> : null}
        {status ? <p className="success-text" role="status">{status}</p> : null}

        <div className="pb-events-body">
          <div className="pb-events-main">
            {loading ? (
              <p className="muted pb-events-loading">Loading events…</p>
            ) : view === "calendar" ? (
              <EventsCalendar
                month={month}
                onMonthChange={setMonth}
                events={sorted}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onCreateOnDay={openCreate}
              />
            ) : (
              <EventsAgenda
                events={agenda}
                selectedId={selectedId}
                onSelect={setSelectedId}
                emptyLabel={
                  view === "drafts"
                    ? "No drafts. Anything you start appears here until you publish it."
                    : view === "past"
                      ? "Nothing has happened yet."
                      : "Nothing coming up. Create an event to get started."
                }
              />
            )}
          </div>

          <aside className="pb-events-side">
            <EventDetailPane
              event={detail}
              busy={busy}
              memberUrl={memberUrl}
              onEdit={openEdit}
              onPublish={(event) => runAction("publish", event, "Event published to members.")}
              onUnpublish={(event) => runAction("unpublish", event, "Event hidden from members.")}
              onCancel={(event) => setCancelTarget(event)}
              onInvite={() => setStatus("Invites and reminders are sent from the Email workspace.")}
              onCopyLink={copyLink}
            />
          </aside>
        </div>
      </div>

      <EventTypePicker
        open={pickerOpen}
        dayLabel={composerDay ? composerDay.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }) : ""}
        onClose={() => setPickerOpen(false)}
        onChoose={chooseType}
      />

      <EventComposer
        open={composerOpen}
        event={composerEvent}
        type={composerType}
        day={composerDay}
        saving={saving}
        request={request}
        onClose={() => setComposerOpen(false)}
        onSave={saveEvent}
      />

      <ModalConfirm
        open={Boolean(cancelTarget)}
        title={cancelTarget ? `Cancel “${cancelTarget.title}”?` : ""}
        description="Members who RSVP'd will see it as canceled. This cannot be undone."
        confirmLabel="Cancel event"
        cancelLabel="Keep it"
        tone="danger"
        busy={busy === "cancel"}
        onConfirm={() => runAction("cancel", cancelTarget, "Event canceled.")}
        onCancel={() => setCancelTarget(null)}
      />
    </section>
    </div>
  );
}
