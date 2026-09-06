import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Archive,
  ArrowUpRight,
  Check,
  CheckCircle2,
  CircleDollarSign,
  Eye,
  HeartHandshake,
  Pause,
  PencilLine,
  Plus,
  RotateCcw,
  Sparkles,
  Star,
  Users,
  X
} from "lucide-react";
import { WorkspaceHeader } from "../../components/admin/AdminUi.jsx";
import { useTenant } from "../../context/TenantContext.jsx";
import { tenantRoute } from "../../lib/tenantRouting.js";
import useAdminApi from "./useAdminApi.js";
import "./director-admin-giving.css";

const TABS = [
  ["pending", "Needs review"], ["active", "Active causes"], ["completed", "Completed"], ["donations", "Donations"]
];

function money(cents = 0) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Math.max(0, Number(cents) || 0) / 100);
}

function CauseStatus({ status }) {
  return <span className={`admin-giving-status is-${status}`}>{String(status || "").replaceAll("_", " ")}</span>;
}

function CauseRow({ cause, selected, onSelect }) {
  return (
    <button type="button" className={`admin-giving-cause-row ${selected ? "is-selected" : ""}`} onClick={() => onSelect(cause)}>
      <span className="admin-giving-cause-thumb">{cause.coverImageUrl ? <img src={cause.coverImageUrl} alt="" /> : <HeartHandshake />}</span>
      <span className="admin-giving-cause-copy"><strong>{cause.title}</strong><small>{cause.creatorName} · {cause.origin === "official" ? "Official" : "Alumni-led"}</small></span>
      <span className="admin-giving-cause-progress"><b>{money(cause.amountRaisedCents)}</b><small>{cause.goalAmountCents ? `of ${money(cause.goalAmountCents)}` : "open fund"}</small></span>
      <CauseStatus status={cause.status} />
    </button>
  );
}

export default function DirectorAdminGivingPage() {
  const { request } = useAdminApi();
  const { slug } = useTenant();
  const [payload, setPayload] = useState(null);
  // The tab lives in the URL, as the other workspaces' views do, so back,
  // refresh and a bookmark all return a director to the list they were in.
  // These stay role="tab" buttons rather than links: the group is a tablist,
  // and navigating on click gets the routing without breaking that.
  const navigate = useNavigate();
  const { view: tabParam } = useParams();
  const tab = TABS.some(([key]) => key === tabParam) ? tabParam : "pending";
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [settings, setSettings] = useState({ externalCheckoutUrl: "", charityDesignationId: "" });

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setPayload(await request("/giving")); }
    catch (requestError) { setError(requestError.message || "Could not load the Giving workspace."); }
    finally { setLoading(false); }
  }, [request]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!selected) return;
    setSettings({ externalCheckoutUrl: selected.externalCheckoutUrl || "", charityDesignationId: selected.charityDesignationId || "" });
    setReviewNote(selected.reviewNote || "");
  }, [selected]);

  const items = Array.isArray(payload?.items) ? payload.items : [];
  const visibleItems = useMemo(() => {
    if (tab === "pending") return items.filter((item) => ["pending", "changes_requested", "rejected"].includes(item.status));
    return items.filter((item) => item.status === tab);
  }, [items, tab]);
  const counts = useMemo(() => ({
    pending: items.filter((item) => ["pending", "changes_requested"].includes(item.status)).length,
    active: items.filter((item) => item.status === "active").length,
    completed: items.filter((item) => item.status === "completed").length,
    donations: payload?.donations?.length || 0
  }), [items, payload?.donations?.length]);

  async function action(action, item = selected, label = "Cause updated.") {
    if (!item) return;
    setBusy(action); setError(""); setNotice("");
    try {
      await request(`/giving/${item.id}/${action}`, { method: "POST", body: { reviewNote } });
      setNotice(label); setSelected(null); setReviewNote(""); await load();
    } catch (requestError) { setError(requestError.message || "That action could not be completed."); }
    finally { setBusy(""); }
  }

  async function saveSettings() {
    if (!selected) return;
    setBusy("settings"); setError("");
    try {
      const response = await request(`/giving/${selected.id}`, { method: "PATCH", body: settings });
      setNotice("Donation connection saved."); setSelected(response.item); await load();
    } catch (requestError) { setError(requestError.message || "Could not save donation settings."); }
    finally { setBusy(""); }
  }

  const summary = payload?.summary || {};

  return (
    <div className="director-admin-giving">
      <WorkspaceHeader
        eyebrow="Community giving"
        title="Giving"
        subtitle="Review alumni proposals, manage live causes, and keep every donation provider connection in one place."
        actions={<Link className="admin-giving-primary" to={tenantRoute(slug, "/giving/new")}><Plus /> Create official cause</Link>}
      />

      <section className="admin-giving-metrics">
        <article><span><CircleDollarSign /></span><div><small>Raised across causes</small><strong>{money(summary.amountRaisedCents)}</strong></div></article>
        <article><span><Users /></span><div><small>Community supporters</small><strong>{summary.donorCount || 0}</strong></div></article>
        <article><span><HeartHandshake /></span><div><small>Active causes</small><strong>{summary.activeCauseCount || 0}</strong></div></article>
        <article className={counts.pending ? "is-attention" : ""}><span><Sparkles /></span><div><small>Needs review</small><strong>{counts.pending}</strong></div></article>
      </section>

      {notice ? <p className="admin-giving-notice"><CheckCircle2 /> {notice}</p> : null}
      {error ? <p className="admin-giving-error" role="alert">{error}</p> : null}

      <div className="admin-giving-tabs" role="tablist" aria-label="Giving workspace views">
        {TABS.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? "is-active" : ""} onClick={() => { setSelected(null); navigate(tenantRoute(slug, `/admin/giving/${key}`)); }}>{label}<span>{counts[key]}</span></button>)}
      </div>

      {loading ? <div className="admin-giving-loading">Loading giving activity…</div> : tab === "donations" ? (
        <section className="admin-giving-table-card">
          <header><div><h2>Donation ledger</h2><p>Provider-confirmed gifts are the source of truth for these records.</p></div></header>
          <div className="admin-giving-table-wrap"><table><thead><tr><th>Donor</th><th>Cause</th><th>Amount</th><th>Display</th><th>Completed</th><th>Status</th></tr></thead><tbody>{payload?.donations?.map((donation) => <tr key={donation.id}><td><strong>{donation.donorName || donation.donorEmail || "Supporter"}</strong><small>{donation.donorAffiliation}</small></td><td>{donation.causeTitle}</td><td><strong>{money(donation.amountCents)}</strong></td><td>{donation.displayPreference.replaceAll("_", " ")}</td><td>{donation.completedAt ? new Date(donation.completedAt).toLocaleDateString() : "—"}</td><td><CauseStatus status={donation.status} /></td></tr>)}</tbody></table></div>
        </section>
      ) : (
        <section className="admin-giving-list-card">
          <header><div><h2>{TABS.find(([key]) => key === tab)?.[1]}</h2><p>{tab === "pending" ? "Open a proposal to review its story, goal, and requested timeline." : "Select a cause to update its status or provider settings."}</p></div><span>{visibleItems.length} total</span></header>
          {visibleItems.length ? <div className="admin-giving-list">{visibleItems.map((cause) => <CauseRow key={cause.id} cause={cause} selected={selected?.id === cause.id} onSelect={setSelected} />)}</div> : <div className="admin-giving-empty"><CheckCircle2 /><h3>Nothing here right now.</h3><p>{tab === "pending" ? "All alumni proposals have been reviewed." : "Causes will appear here as their status changes."}</p></div>}
        </section>
      )}

      {selected ? (
        <div className="admin-giving-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
          <aside className="admin-giving-drawer" aria-label={`${selected.title} review panel`}>
            <header><div><CauseStatus status={selected.status} /><h2>{selected.title}</h2><p>{selected.creatorName} · {selected.creatorAffiliation}</p></div><button type="button" onClick={() => setSelected(null)} aria-label="Close"><X /></button></header>
            <div className="admin-giving-drawer-body">
              <p className="admin-giving-kicker">Proposal story</p><p className="admin-giving-summary">{selected.shortDescription}</p><p className="admin-giving-story">{selected.description}</p>
              {selected.whyItMatters ? <div className="admin-giving-why"><strong>Why it matters</strong><p>{selected.whyItMatters}</p></div> : null}
              <dl className="admin-giving-details"><div><dt>Goal</dt><dd>{money(selected.goalAmountCents)}</dd></div><div><dt>Raised</dt><dd>{money(selected.amountRaisedCents)}</dd></div><div><dt>Category</dt><dd>{selected.category}</dd></div><div><dt>Timeline</dt><dd>{selected.startDate || "Approval"} — {selected.endDate || "Ongoing"}</dd></div></dl>

              {selected.status === "pending" ? <section className="admin-giving-review-box"><label>Director note <small>Required for edits or rejection</small><textarea rows="4" value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} placeholder="Give the creator clear, useful feedback…" /></label><div><button type="button" className="is-approve" disabled={busy} onClick={() => action("approve", selected, "Cause approved and published.")}><Check /> Approve</button><button type="button" disabled={busy} onClick={() => action("request-edit", selected, "Edit request sent.")}><PencilLine /> Request edit</button><button type="button" className="is-danger" disabled={busy} onClick={() => action("reject", selected, "Cause rejected.")}><X /> Reject</button></div></section> : null}

              <section className="admin-giving-settings"><p className="admin-giving-kicker">Donation connection</p><label>Secure checkout URL<input type="url" value={settings.externalCheckoutUrl} onChange={(e) => setSettings((current) => ({ ...current, externalCheckoutUrl: e.target.value }))} placeholder="https://donate.example.org/…" /></label><label>Provider designation ID<input value={settings.charityDesignationId} onChange={(e) => setSettings((current) => ({ ...current, charityDesignationId: e.target.value }))} placeholder="fund_…" /></label><button type="button" disabled={busy === "settings"} onClick={saveSettings}>Save connection</button></section>
            </div>
            <footer>
              <Link to={tenantRoute(slug, `/giving/${selected.id}`)}><Eye /> View member page <ArrowUpRight /></Link>
              <div>{selected.status === "active" ? <><button type="button" onClick={() => action("feature", selected, selected.featured ? "Removed from featured causes." : "Cause featured.")}><Star /> {selected.featured ? "Unfeature" : "Feature"}</button><button type="button" onClick={() => action("fundraising", selected)}><Pause /> {selected.fundraisingOpen ? "Pause gifts" : "Open gifts"}</button><button type="button" onClick={() => action("complete", selected, "Cause marked complete.")}><CheckCircle2 /> Complete</button></> : null}{selected.status === "completed" ? <button type="button" onClick={() => action("reopen", selected, "Cause reopened.")}><RotateCcw /> Reopen</button> : null}<button type="button" className="is-danger" onClick={() => action("archive", selected, "Cause archived.")}><Archive /> Archive</button></div>
            </footer>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
