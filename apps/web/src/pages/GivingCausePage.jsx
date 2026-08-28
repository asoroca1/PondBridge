import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Heart,
  HeartHandshake,
  LockKeyhole,
  Share2,
  Sparkles,
  Users,
  X
} from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { useTenant } from "../context/TenantContext.jsx";
import { requestJson } from "../lib/http.js";
import { resolveCampName } from "../lib/campLabels.js";
import { tenantRoute } from "../lib/tenantRouting.js";
import cedarField from "../cedar/assets/cedar-field.jpeg";
import profileCover from "../cedar/assets/profile-cover.jpg";
import "./giving-detail.css";

const CATEGORY_LABELS = {
  camperships: "Camperships",
  facilities: "Facilities",
  traditions: "Traditions",
  programs: "Programs",
  memorial: "Memorial",
  other: "Community cause"
};

function money(cents = 0) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(Math.max(0, Number(cents) || 0) / 100);
}

function fallbackImage(cause = {}) {
  return ["facilities", "traditions", "memorial"].includes(cause.category) ? profileCover : cedarField;
}

function SupporterRow({ supporter, slug, interactive = true, tabbable = true }) {
  const profileHref = interactive && supporter.donorProfileId && !supporter.anonymous
    ? tenantRoute(slug, `/profile/${supporter.donorProfileId}`)
    : "";

  return (
    <article className={profileHref ? "is-linked" : undefined}>
      {profileHref ? <Link className="giving-supporter-row-link" to={profileHref} tabIndex={tabbable ? undefined : -1} aria-label={`View ${supporter.donorName}’s profile`} /> : null}
      <span>{supporter.donorName.slice(0, 1)}</span>
      <div>
        <strong>{supporter.donorName}</strong>
        <small>{supporter.donorAffiliation || "Camp community"}</small>
        {supporter.donorMessage ? <p>“{supporter.donorMessage}”</p> : null}
      </div>
      <b>{supporter.amountCents == null ? "Gift made" : money(supporter.amountCents)}</b>
    </article>
  );
}

function DonationDialog({ cause, onClose, onDonate, busy, error }) {
  const [amount, setAmount] = useState("50");
  const [displayPreference, setDisplayPreference] = useState("public");
  const [donorMessage, setDonorMessage] = useState("");
  const [showAffiliation, setShowAffiliation] = useState(true);

  return (
    <div className="giving-dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="giving-dialog" role="dialog" aria-modal="true" aria-labelledby="donation-title">
        <button className="giving-dialog-close" type="button" onClick={onClose} aria-label="Close"><X /></button>
        <span className="giving-dialog-icon"><Heart aria-hidden="true" /></span>
        <p className="giving-detail-eyebrow">Secure donation</p>
        <h2 id="donation-title">Support {cause.title}</h2>
        <p>Your preferences follow this gift to the camp’s connected donation provider.</p>

        <label className="giving-form-field">
          <span>Gift amount</span>
          <div className="giving-amount-input"><b>$</b><input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" aria-label="Gift amount in dollars" /></div>
        </label>
        <div className="giving-quick-amounts">
          {[25, 50, 100, 250].map((value) => <button key={value} type="button" onClick={() => setAmount(String(value))}>${value}</button>)}
        </div>
        <fieldset className="giving-display-prefs">
          <legend>How your gift appears</legend>
          <label><input type="radio" name="display" checked={displayPreference === "public"} onChange={() => setDisplayPreference("public")} /> Name and amount</label>
          <label><input type="radio" name="display" checked={displayPreference === "hide_amount"} onChange={() => setDisplayPreference("hide_amount")} /> Hide amount</label>
          <label><input type="radio" name="display" checked={displayPreference === "anonymous"} onChange={() => setDisplayPreference("anonymous")} /> Anonymous</label>
        </fieldset>
        <label className="giving-form-field">
          <span>Message <small>Optional</small></span>
          <textarea rows="3" maxLength="280" value={donorMessage} onChange={(event) => setDonorMessage(event.target.value)} placeholder="Share why this cause matters to you" />
        </label>
        <label className="giving-check"><input type="checkbox" checked={showAffiliation} onChange={(event) => setShowAffiliation(event.target.checked)} /> Show my camp affiliation</label>
        {error ? <p className="giving-inline-error" role="alert">{error}</p> : null}
        <button className="giving-donate-submit" type="button" disabled={busy} onClick={() => onDonate({
          amountCents: Math.round(Number(amount) * 100),
          displayPreference,
          donorMessage,
          showAffiliation
        })}>
          <LockKeyhole aria-hidden="true" /> {busy ? "Connecting…" : `Continue with ${money(Math.round(Number(amount || 0) * 100))}`}
        </button>
      </section>
    </div>
  );
}

export default function GivingCausePage() {
  const { causeId } = useParams();
  const { token } = useAuth();
  const { slug, tenant } = useTenant();
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const [shareStatus, setShareStatus] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    requestJson(`/api/t/${slug}/giving/${causeId}`, { token })
      .then((next) => { if (active) setPayload(next); })
      .catch((requestError) => { if (active) setError(requestError.message || "Could not load this cause."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [causeId, slug, token]);

  const cause = payload?.item || null;
  const campName = resolveCampName(tenant) || "your camp";
  const supporters = Array.isArray(payload?.recentSupporters) ? payload.recentSupporters : [];
  const updates = Array.isArray(payload?.updates) ? payload.updates : [];
  const dateLabel = useMemo(() => {
    if (!cause?.endDate) return "Ongoing cause";
    return `Giving through ${new Date(`${cause.endDate}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;
  }, [cause?.endDate]);

  async function donate(preferences) {
    setCheckoutBusy(true);
    setCheckoutError("");
    try {
      const response = await requestJson(`/api/t/${slug}/giving/${cause.id}/checkout`, {
        token,
        method: "POST",
        body: preferences
      });
      window.location.assign(response.checkoutUrl);
    } catch (requestError) {
      setCheckoutError(requestError.message || "Secure giving is not available right now.");
    } finally {
      setCheckoutBusy(false);
    }
  }

  async function share() {
    try {
      if (navigator.share) await navigator.share({ title: cause.title, text: cause.shortDescription, url: window.location.href });
      else await navigator.clipboard.writeText(window.location.href);
      setShareStatus(navigator.share ? "Shared" : "Link copied");
    } catch {
      setShareStatus("");
    }
  }

  if (loading) return <div className="giving-detail-state">Loading cause…</div>;
  if (error || !cause) return <div className="giving-detail-state"><HeartHandshake /><h1>Cause unavailable</h1><p>{error}</p><Link to={tenantRoute(slug, "/giving")}>Back to giving</Link></div>;

  const proposalOnly = !["active", "completed"].includes(cause.status);

  return (
    <div className="giving-detail-page nav2-page-shell">
      <Link className="giving-detail-back" to={tenantRoute(slug, "/giving")}><ArrowLeft /> All causes</Link>
      <header className="giving-detail-hero">
        <img src={cause.coverImageUrl || fallbackImage(cause)} alt="" />
        <div className="giving-detail-hero-shade" />
        <div className="giving-detail-hero-copy">
          <div className="giving-detail-badges">
            <span>{CATEGORY_LABELS[cause.category]}</span>
            <span>{cause.origin === "official" ? <CheckCircle2 /> : <Sparkles />}{cause.origin === "official" ? `Official ${campName} cause` : "Alumni-led cause"}</span>
          </div>
          <h1>{cause.title}</h1>
          <p>{cause.shortDescription}</p>
        </div>
      </header>

      <main className="giving-detail-layout">
        <article className="giving-story">
          <section className="giving-story-card">
            {proposalOnly ? (
              <div className={`giving-proposal-note is-${cause.status}`}>
                <strong>{cause.status === "changes_requested" ? "Directors requested changes" : cause.status === "rejected" ? "This proposal was not approved" : "Awaiting director review"}</strong>
                {cause.reviewNote ? <p>{cause.reviewNote}</p> : null}
                {cause.status === "changes_requested" ? <Link to={tenantRoute(slug, `/giving/new?edit=${cause.id}`)}>Revise proposal</Link> : null}
              </div>
            ) : null}
            <p className="giving-detail-eyebrow">The story</p>
            <h2>What this cause will make possible</h2>
            <p className="giving-story-lead">{cause.description}</p>
            {cause.whyItMatters ? <section className="giving-why"><HeartHandshake /><div><h3>Why it matters</h3><p>{cause.whyItMatters}</p></div></section> : null}
          </section>

          {updates.length ? (
            <section className="giving-updates">
              <p className="giving-detail-eyebrow">From the cause team</p>
              <h2>Updates</h2>
              {updates.map((update) => <article key={update.id}><span>{new Date(update.publishedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span><h3>{update.title}</h3><p>{update.body}</p></article>)}
            </section>
          ) : null}

          {!proposalOnly ? (
            <section className="giving-supporters">
              <div><p className="giving-detail-eyebrow">Donor wall</p><h2>Recent supporters</h2></div>
              {supporters.length ? (
                <div className={`giving-supporter-marquee${supporters.length > 2 ? " is-scrolling" : ""}`}>
                  <div className="giving-supporter-track">
                    <div className="giving-supporter-set">
                      {supporters.map((supporter) => <SupporterRow key={supporter.id} supporter={supporter} slug={slug} />)}
                    </div>
                    {supporters.length > 2 ? (
                      <div className="giving-supporter-set" aria-hidden="true">
                        {supporters.map((supporter) => <SupporterRow key={`repeat-${supporter.id}`} supporter={supporter} slug={slug} tabbable={false} />)}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : <p className="giving-no-supporters">Be the first alum to show support here.</p>}
            </section>
          ) : null}
        </article>

        <aside className="giving-donation-card">
          <div className="giving-donation-total"><strong>{money(cause.amountRaisedCents)}</strong><span>{cause.isGeneralFund ? "raised by the community" : `of ${money(cause.goalAmountCents)} goal`}</span></div>
          {!cause.isGeneralFund ? <div className="giving-detail-progress"><span style={{ width: `${cause.progressPercent}%` }} /></div> : null}
          <div className="giving-donation-meta"><span><Users /> {cause.donorCount} supporters</span><span><CalendarDays /> {dateLabel}</span></div>
          {!proposalOnly && cause.fundraisingOpen ? <button type="button" onClick={() => { setCheckoutError(""); setDialogOpen(true); }}><Heart /> Donate to this cause</button> : null}
          {cause.status === "completed" ? <p className="giving-funded-message"><CheckCircle2 /> This cause is complete. Thank you, alumni.</p> : null}
          <button className="giving-share-button" type="button" onClick={share}><Share2 /> {shareStatus || "Share this cause"}</button>
          <div className="giving-creator"><small>Created by</small><strong>{cause.creatorName}</strong><span>{cause.creatorAffiliation}</span></div>
        </aside>
      </main>
      {dialogOpen ? <DonationDialog cause={cause} onClose={() => setDialogOpen(false)} onDonate={donate} busy={checkoutBusy} error={checkoutError} /> : null}
    </div>
  );
}
