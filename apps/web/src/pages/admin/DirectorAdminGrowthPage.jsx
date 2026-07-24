import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Button, Card, Input, Select } from "@pondbridge/ui";
import { ModalDialog, PageHeader } from "../../components/admin/AdminUi.jsx";
import useAdminApi from "./useAdminApi.js";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMPTY_ADD_FORM = {
  rows: "",
  tags: "",
  campYears: "",
  notes: ""
};

const LIFECYCLE_LABELS = {
  prospect: "Not invited",
  invited: "Invitation pending",
  invite_expired: "Invite expired",
  joined: "Joined",
  do_not_contact: "On hold"
};

function parseLabels(value = "") {
  return [...new Set(
    String(value || "")
      .split(/[,\n]+/g)
      .map((item) => item.trim())
      .filter(Boolean)
  )];
}

function parseContactRows(value = "") {
  const contacts = [];
  const invalid = [];
  String(value || "")
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line, index) => {
      const parts = line.split(",").map((item) => item.trim()).filter(Boolean);
      const emailIndex = parts.findIndex((item) => EMAIL_REGEX.test(item.toLowerCase()));
      if (emailIndex < 0) {
        invalid.push({ line: index + 1, value: line });
        return;
      }
      contacts.push({
        firstName: emailIndex >= 1 ? parts[0] : "",
        lastName: emailIndex >= 2 ? parts[1] : "",
        email: parts[emailIndex].toLowerCase()
      });
    });
  const unique = new Map();
  contacts.forEach((contact) => unique.set(contact.email, contact));
  return { contacts: [...unique.values()], invalid };
}

function formatDate(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function tenantAdminHref(slug, href = "/admin") {
  const safeHref = String(href || "/admin");
  return `/t/${slug}${safeHref.startsWith("/") ? safeHref : `/${safeHref}`}`;
}

export default function DirectorAdminGrowthPage() {
  const { slug, request } = useAdminApi();
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [lifecycle, setLifecycle] = useState("all");
  const [addForm, setAddForm] = useState(EMPTY_ADD_FORM);
  const [selectedEmails, setSelectedEmails] = useState([]);
  const [inviteReview, setInviteReview] = useState(null);
  const loadSequenceRef = useRef(0);

  const loadGrowth = useCallback(async ({ quiet = false } = {}) => {
    const loadSequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = loadSequence;
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ q: query, lifecycle, limit: "500" });
      const nextPayload = await request(`/growth?${params.toString()}`);
      if (loadSequence === loadSequenceRef.current) setPayload(nextPayload);
    } catch (requestError) {
      if (loadSequence === loadSequenceRef.current) {
        setError(requestError.message || "Could not load alumni growth data.");
      }
    } finally {
      if (loadSequence === loadSequenceRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [lifecycle, query, request]);

  useEffect(() => {
    const timer = window.setTimeout(() => loadGrowth(), 160);
    return () => window.clearTimeout(timer);
  }, [loadGrowth]);

  const parsedRows = useMemo(() => parseContactRows(addForm.rows), [addForm.rows]);
  const contacts = payload?.contacts?.items || [];
  const selectedContacts = useMemo(() => {
    const selected = new Set(selectedEmails);
    return contacts.filter((contact) => selected.has(contact.email));
  }, [contacts, selectedEmails]);
  const selectableContacts = contacts.filter((contact) =>
    ["prospect", "invite_expired"].includes(contact.lifecycle)
  );
  const maxFunnelCount = Math.max(1, ...(payload?.funnel || []).map((item) => Number(item.count || 0)));

  async function saveContacts(event) {
    event.preventDefault();
    if (!parsedRows.contacts.length) {
      setError("Add at least one valid email address.");
      return;
    }
    setSaving(true);
    setError("");
    setStatus("");
    try {
      const tags = parseLabels(addForm.tags);
      const campYears = parseLabels(addForm.campYears);
      const response = await request("/growth/contacts", {
        method: "POST",
        body: {
          contacts: parsedRows.contacts.map((contact) => ({
            ...contact,
            tags,
            campYears,
            notes: addForm.notes,
            source: "director_entry"
          }))
        }
      });
      setStatus(
        `${response.createdCount || 0} alumni added, ${response.updatedCount || 0} updated` +
          (response.existingMemberCount ? `, ${response.existingMemberCount} already joined.` : ".")
      );
      setAddForm(EMPTY_ADD_FORM);
      await loadGrowth({ quiet: true });
    } catch (requestError) {
      setError(requestError.message || "Could not save alumni contacts.");
    } finally {
      setSaving(false);
    }
  }

  async function updateContact(contact, contactStatus) {
    if (!contact.id) return;
    setError("");
    setStatus("");
    try {
      await request(`/growth/contacts/${encodeURIComponent(contact.id)}`, {
        method: "PATCH",
        body: {
          firstName: contact.firstName,
          lastName: contact.lastName,
          tags: contact.tags,
          campYears: contact.campYears,
          notes: contact.notes,
          contactStatus
        }
      });
      setSelectedEmails((current) => current.filter((email) => email !== contact.email));
      setStatus(contactStatus === "do_not_contact" ? "Contact placed on hold." : "Contact restored.");
      await loadGrowth({ quiet: true });
    } catch (requestError) {
      setError(requestError.message || "Could not update this alumni contact.");
    }
  }

  function toggleContact(email) {
    setSelectedEmails((current) =>
      current.includes(email)
        ? current.filter((item) => item !== email)
        : [...current, email]
    );
  }

  async function reviewInvitations() {
    if (!selectedContacts.length) return;
    setSending(true);
    setError("");
    try {
      const recipients = selectedContacts.map(({ firstName, lastName, email }) => ({
        firstName,
        lastName,
        email
      }));
      const preview = await request("/invites/preview", {
        method: "POST",
        body: { roleToAssign: "user", recipients }
      });
      setInviteReview({ preview, recipients });
    } catch (requestError) {
      setError(requestError.message || "Could not prepare invitation review.");
    } finally {
      setSending(false);
    }
  }

  async function sendReviewedInvitations() {
    if (!inviteReview?.preview?.previewToken) return;
    setSending(true);
    setError("");
    try {
      const response = await request("/invites/send", {
        method: "POST",
        body: {
          roleToAssign: "user",
          recipients: inviteReview.recipients,
          previewToken: inviteReview.preview.previewToken
        }
      });
      setStatus(`${response.sentCount || 0} invitations sent.`);
      setInviteReview(null);
      setSelectedEmails([]);
      await loadGrowth({ quiet: true });
    } catch (requestError) {
      setError(requestError.message || "Could not send reviewed invitations.");
    } finally {
      setSending(false);
    }
  }

  if (loading && !payload) {
    return <Card>Loading alumni growth workspace…</Card>;
  }

  const metrics = payload?.metrics || {};
  return (
    <>
      <Card className="director-growth-hero">
        <PageHeader
          title="Alumni Growth"
          subtitle="Build the complete alumni audience, turn known contacts into members, and keep the community active after they join."
          actions={
            <Button variant="secondary" onClick={() => loadGrowth({ quiet: true })} loading={refreshing}>
              {refreshing ? "Refreshing…" : "Refresh"}
            </Button>
          }
        />
        <div className="director-growth-primary-metrics">
          <article><span>Known alumni</span><strong>{metrics.knownAlumni || 0}</strong></article>
          <article><span>Not joined yet</span><strong>{metrics.notJoined || 0}</strong></article>
          <article><span>Invite conversion</span><strong>{metrics.inviteConversionRate || 0}%</strong></article>
          <article><span>Active this week</span><strong>{metrics.weeklyActiveRate || 0}%</strong></article>
        </div>
      </Card>

      {error ? <p className="error-text" role="alert">{error}</p> : null}
      {status ? <p className="success-text" role="status">{status}</p> : null}
      {!payload?.storage?.available ? (
        <Card className="director-growth-storage-warning">
          <Badge tone="warning">Storage setup required</Badge>
          <div>
            <strong>Growth reporting is available, but new pre-member alumni cannot be saved yet.</strong>
            <p>{payload?.storage?.message || "Apply the communications system schema in staging."}</p>
          </div>
        </Card>
      ) : null}

      <div className="director-growth-grid">
        <Card>
          <h2>Growth funnel</h2>
          <p className="muted">See where alumni are dropping out between identification, invitation, signup, and weekly use.</p>
          <div className="director-growth-funnel">
            {(payload?.funnel || []).map((step) => (
              <div key={step.key}>
                <span>{step.label}</span>
                <div><i aria-hidden="true" style={{ width: `${Math.max(4, (Number(step.count || 0) / maxFunnelCount) * 100)}%` }} /></div>
                <strong>{step.count || 0}</strong>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <h2>Best next actions</h2>
          <p className="muted">Server-derived audiences keep outreach focused and measurable.</p>
          <div className="director-growth-opportunities">
            {(payload?.opportunities || []).map((item) => (
              <Link key={item.key} to={tenantAdminHref(slug, item.href)}>
                <span>{item.label}</span>
                <strong>{item.count || 0}</strong>
              </Link>
            ))}
          </div>
          <div className="director-growth-marketing-summary">
            <div><span>Campaigns sent</span><strong>{payload?.marketing?.campaignsSent || 0}</strong></div>
            <div><span>Requested deliveries</span><strong>{payload?.marketing?.recipientDeliveriesRequested || 0}</strong></div>
            <div><span>Delivery rate</span><strong>{payload?.marketing?.deliveryRate || 0}%</strong></div>
          </div>
        </Card>
      </div>

      <Card>
        <PageHeader
          title="Store alumni before they join"
          subtitle="Saving a contact does not create an account or send an email. Invitations remain a separate reviewed action."
        />
        <form className="director-growth-add-form" onSubmit={saveContacts}>
          <label>
            Alumni rows
            <textarea
              value={addForm.rows}
              onChange={(event) => setAddForm((current) => ({ ...current, rows: event.target.value }))}
              placeholder={"First name, Last name, email@example.com\nemail-only@example.com"}
              rows={6}
              disabled={!payload?.storage?.available}
            />
            <small className={parsedRows.invalid.length ? "error-text" : "muted"}>
              {parsedRows.contacts.length} valid unique email(s)
              {parsedRows.invalid.length ? ` · ${parsedRows.invalid.length} row(s) need a valid email` : ""}
            </small>
          </label>
          <div className="director-growth-add-fields">
            <label>Tags<Input value={addForm.tags} onChange={(event) => setAddForm((current) => ({ ...current, tags: event.target.value }))} placeholder="Reunion, donor, parent" disabled={!payload?.storage?.available} /></label>
            <label>Camp years<Input value={addForm.campYears} onChange={(event) => setAddForm((current) => ({ ...current, campYears: event.target.value }))} placeholder="2008, 2009" disabled={!payload?.storage?.available} /></label>
            <label>Notes<Input value={addForm.notes} maxLength={800} onChange={(event) => setAddForm((current) => ({ ...current, notes: event.target.value }))} placeholder="How the camp knows this person" disabled={!payload?.storage?.available} /></label>
          </div>
          <Button type="submit" loading={saving} disabled={!payload?.storage?.available || !parsedRows.contacts.length || parsedRows.invalid.length > 0}>
            {saving ? "Saving…" : "Save alumni contacts"}
          </Button>
        </form>
      </Card>

      <Card>
        <PageHeader
          title="Alumni pipeline"
          subtitle={`${payload?.contacts?.total || 0} tracked alumni before and after signup.`}
          actions={
            <Button onClick={reviewInvitations} loading={sending} disabled={!selectedContacts.length}>
              Review {selectedContacts.length || ""} invitation{selectedContacts.length === 1 ? "" : "s"}
            </Button>
          }
        />
        <div className="director-growth-filters">
          <Input value={query} onChange={(event) => { setQuery(event.target.value); setSelectedEmails([]); }} placeholder="Search name, email, or tag" />
          <Select value={lifecycle} onChange={(event) => { setLifecycle(event.target.value); setSelectedEmails([]); }}>
            <option value="all">All stages</option>
            <option value="prospect">Not invited</option>
            <option value="invite_expired">Invite expired</option>
            <option value="invited">Invitation pending</option>
            <option value="joined">Joined</option>
            <option value="do_not_contact">On hold</option>
          </Select>
          {selectableContacts.length ? (
            <Button
              variant="secondary"
              onClick={() => setSelectedEmails(
                selectedEmails.length === selectableContacts.length
                  ? []
                  : selectableContacts.map((contact) => contact.email)
              )}
            >
              {selectedEmails.length === selectableContacts.length ? "Clear selection" : "Select invite-ready"}
            </Button>
          ) : null}
        </div>
        <div className="director-growth-contact-list">
          {contacts.length ? contacts.map((contact) => {
            const selectable = ["prospect", "invite_expired"].includes(contact.lifecycle);
            return (
              <article key={contact.email} className={`director-growth-contact lifecycle-${contact.lifecycle}`}>
                <div className="director-growth-contact-check">
                  {selectable ? (
                    <input type="checkbox" checked={selectedEmails.includes(contact.email)} onChange={() => toggleContact(contact.email)} aria-label={`Select ${contact.firstName || contact.email} for invitation`} />
                  ) : <span aria-hidden="true" />}
                </div>
                <div className="director-growth-contact-person">
                  <strong>{[contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.email}</strong>
                  <span>{contact.email}</span>
                  {contact.tags?.length ? <small>{contact.tags.join(" · ")}</small> : null}
                </div>
                <div><Badge tone={contact.lifecycle === "joined" ? "success" : contact.lifecycle === "do_not_contact" ? "warning" : "neutral"}>{LIFECYCLE_LABELS[contact.lifecycle] || contact.lifecycle}</Badge></div>
                <div className="director-growth-contact-history">
                  <span>{contact.inviteCount || 0} invite{contact.inviteCount === 1 ? "" : "s"}</span>
                  <small>{contact.lastInvitedAt ? `Last ${formatDate(contact.lastInvitedAt)}` : "Never invited"}</small>
                </div>
                <div className="director-growth-contact-actions">
                  {contact.id && contact.lifecycle !== "joined" ? (
                    <Button variant="secondary" size="sm" onClick={() => updateContact(contact, contact.lifecycle === "do_not_contact" ? "active" : "do_not_contact")}>
                      {contact.lifecycle === "do_not_contact" ? "Restore" : "Put on hold"}
                    </Button>
                  ) : null}
                </div>
              </article>
            );
          }) : <p className="muted">No alumni match these filters yet.</p>}
        </div>
      </Card>

      <ModalDialog
        open={Boolean(inviteReview)}
        title="Review alumni invitations"
        description="No invitation is sent until you confirm this server-validated audience."
        onClose={sending ? undefined : () => setInviteReview(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setInviteReview(null)} disabled={sending}>Keep reviewing</Button>
            <Button onClick={sendReviewedInvitations} loading={sending} disabled={!inviteReview?.preview?.summary?.readyCount}>
              Send {inviteReview?.preview?.summary?.readyCount || 0} invitations
            </Button>
          </>
        }
      >
        <div className="director-growth-invite-review">
          <p><strong>{inviteReview?.preview?.summary?.readyCount || 0}</strong> ready to invite</p>
          <p>{inviteReview?.preview?.summary?.pendingInviteCount || 0} already have a pending invitation.</p>
          <p>{inviteReview?.preview?.summary?.existingMemberCount || 0} already joined.</p>
          <p>{inviteReview?.preview?.summary?.contactOnHoldCount || 0} are on hold.</p>
          <ul>
            {(inviteReview?.preview?.items || []).slice(0, 10).map((item) => (
              <li key={item.email}>{item.firstName || item.email} — {String(item.status || "unknown").replaceAll("_", " ")}</li>
            ))}
          </ul>
        </div>
      </ModalDialog>
    </>
  );
}
