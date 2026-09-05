import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  CheckCircle2,
  HeartHandshake,
  Plus,
  Sparkles,
  Users
} from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { useTenant } from "../context/TenantContext.jsx";
import { requestJson } from "../lib/http.js";
import { resolveCampName } from "../lib/campLabels.js";
import { tenantRoute } from "../lib/tenantRouting.js";
import cedarField from "../cedar/assets/cedar-field.jpeg";
import profileCover from "../cedar/assets/profile-cover.jpg";
import "./giving.css";

const CATEGORY_LABELS = {
  all: "All",
  camperships: "Camperships",
  facilities: "Facilities",
  traditions: "Traditions",
  programs: "Programs",
  memorial: "Memorial",
  other: "Other"
};

function money(cents = 0, { compact = false } = {}) {
  const amount = Math.max(0, Number(cents) || 0) / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
    notation: compact && amount >= 10000 ? "compact" : "standard"
  }).format(amount);
}

function fallbackImage(cause = {}) {
  return ["facilities", "traditions", "memorial"].includes(cause.category)
    ? profileCover
    : cedarField;
}

function CauseBadge({ cause }) {
  if (cause.origin === "official") {
    return (
      <span className="giving-cause-badge is-official">
        <CheckCircle2 aria-hidden="true" /> Official camp cause
      </span>
    );
  }
  return (
    <span className="giving-cause-badge is-alumni">
      <Sparkles aria-hidden="true" /> Alumni-led
    </span>
  );
}

function Progress({ cause, compact = false, campName = "the camp" }) {
  if (cause.isGeneralFund || cause.progressPercent == null) {
    return (
      <div className={`giving-open-fund ${compact ? "is-compact" : ""}`.trim()}>
        <HeartHandshake aria-hidden="true" /> Every gift supports {campName} where it is needed most.
      </div>
    );
  }
  return (
    <div className="giving-progress-block">
      <div className="giving-progress-copy">
        <strong>{money(cause.amountRaisedCents)} raised</strong>
        <span>{cause.progressPercent}% of {money(cause.goalAmountCents)} goal</span>
      </div>
      <div
        className="giving-progress-track"
        role="progressbar"
        aria-label={`${cause.title} fundraising progress`}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={cause.progressPercent}
      >
        <span style={{ width: `${cause.progressPercent}%` }} />
      </div>
    </div>
  );
}

function GeneralFundCard({ cause, slug, campName }) {
  return (
    <article className="giving-general-card">
      <div className="giving-general-image">
        <img src={cause.coverImageUrl || fallbackImage(cause)} alt="" />
        <span>Give where it matters most</span>
      </div>
      <div className="giving-general-copy">
        <CauseBadge cause={cause} />
        <p className="giving-card-kicker">General camp fund</p>
        <h2>{cause.title}</h2>
        <p>{cause.shortDescription}</p>
        <Progress cause={cause} campName={campName} />
        <div className="giving-card-foot">
          <span><Users aria-hidden="true" /> {cause.donorCount} alumni have given</span>
          <Link to={tenantRoute(slug, `/giving/${cause.id}`)}>
            View fund <ArrowRight aria-hidden="true" />
          </Link>
        </div>
      </div>
    </article>
  );
}

function CauseCard({ cause, slug, completed = false }) {
  return (
    <article className={`giving-cause-card ${completed ? "is-completed" : ""}`.trim()}>
      <Link className="giving-cause-image" to={tenantRoute(slug, `/giving/${cause.id}`)} aria-label={`View ${cause.title}`}>
        <img src={cause.coverImageUrl || fallbackImage(cause)} alt="" loading="lazy" decoding="async" />
        <span className={`giving-category-tag is-${cause.category}`}>{CATEGORY_LABELS[cause.category] || "Cause"}</span>
        {completed ? <span className="giving-funded-tag"><CheckCircle2 aria-hidden="true" /> Fully funded</span> : null}
      </Link>
      <div className="giving-cause-body">
        <CauseBadge cause={cause} />
        <h3><Link to={tenantRoute(slug, `/giving/${cause.id}`)}>{cause.title}</Link></h3>
        <p>{cause.shortDescription}</p>
        <Progress cause={cause} compact />
        <div className="giving-card-foot">
          <span><Users aria-hidden="true" /> {cause.donorCount} donors</span>
          <Link to={tenantRoute(slug, `/giving/${cause.id}`)}>
            View cause <ArrowRight aria-hidden="true" />
          </Link>
        </div>
      </div>
    </article>
  );
}

function ProposalStrip({ proposals = [], slug }) {
  if (!proposals.length) return null;
  return (
    <section className="giving-proposals" aria-labelledby="giving-proposals-title">
      <div>
        <p className="giving-section-eyebrow">Your ideas</p>
        <h2 id="giving-proposals-title">Causes you submitted</h2>
      </div>
      <div className="giving-proposal-list">
        {proposals.map((cause) => (
          <Link key={cause.id} to={tenantRoute(slug, `/giving/${cause.id}`)} className="giving-proposal-row">
            <span>
              <strong>{cause.title}</strong>
              <small>{cause.status === "changes_requested" ? "Directors requested an edit" : cause.status === "rejected" ? "Not approved" : "Pending director review"}</small>
            </span>
            <em className={`is-${cause.status}`}>{cause.status.replaceAll("_", " ")}</em>
          </Link>
        ))}
      </div>
    </section>
  );
}

export default function GivingPage() {
  const { token } = useAuth();
  const { slug, tenant } = useTenant();
  const [payload, setPayload] = useState(null);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    requestJson(`/api/t/${slug}/giving`, { token })
      .then((next) => { if (active) setPayload(next); })
      .catch((requestError) => { if (active) setError(requestError.message || "Could not load giving causes."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [slug, token]);

  const activeCauses = Array.isArray(payload?.active) ? payload.active : [];
  const generalFund = activeCauses.find((cause) => cause.isGeneralFund) || null;
  const filtered = useMemo(
    () => activeCauses.filter((cause) => !cause.isGeneralFund && (filter === "all" || cause.category === filter)),
    [activeCauses, filter]
  );
  const summary = payload?.summary || {};
  const campName = resolveCampName(tenant) || "your camp";

  return (
    <div className="giving-page nav2-page-shell">
      <section className="giving-hero">
        <div className="giving-hero-copy">
          <p className="giving-section-eyebrow">Giving at {campName}</p>
          <h1>Support the places and moments that stay with us.</h1>
          <p>Back an official priority, rally alumni around a new idea, or give wherever {campName} needs it most.</p>
          <div className="giving-hero-actions">
            <Link className="giving-primary-action" to={tenantRoute(slug, "/giving/new")}>
              <Plus aria-hidden="true" /> Create a cause
            </Link>
            <a className="giving-text-action" href="#active-causes">Explore causes <ArrowRight aria-hidden="true" /></a>
          </div>
        </div>
        <div className="giving-community-total" aria-label="Community giving total">
          <p>Together, {campName} alumni have raised</p>
          <strong>{money(summary.amountRaisedCents)}</strong>
          <span><Users aria-hidden="true" /> {summary.donorCount || 0} alumni across {summary.activeCauseCount || 0} active causes</span>
        </div>
      </section>

      <main className="giving-main">
        {loading ? (
          <div className="giving-loading" role="status">
            <span /> <span /> <span />
            <p>Gathering {campName} causes…</p>
          </div>
        ) : error ? (
          <div className="giving-error" role="alert">
            <HeartHandshake aria-hidden="true" />
            <div><strong>Giving is taking a moment.</strong><p>{error}</p></div>
          </div>
        ) : (
          <>
            {generalFund ? <GeneralFundCard cause={generalFund} slug={slug} campName={campName} /> : null}

            <ProposalStrip proposals={payload?.myProposals || []} slug={slug} />

            <section id="active-causes" className="giving-section" aria-labelledby="active-causes-title">
              <div className="giving-section-head">
                <div>
                  <p className="giving-section-eyebrow">Choose your impact</p>
                  <h2 id="active-causes-title">Active causes</h2>
                </div>
                {/* The hero counts every active cause; this grid excludes the general fund,
                    which has its own card above. Reporting the grid's length here made one
                    screen say "4 active causes" and "3 causes" a few hundred pixels apart.
                    Count the same set as the hero, and say "N of M" once a filter narrows it. */}
                <span>
                  {filter === "all"
                    ? `${activeCauses.length} ${activeCauses.length === 1 ? "cause" : "causes"}`
                    : `${filtered.length} of ${activeCauses.length}`}
                </span>
              </div>

              <div className="giving-filters" role="group" aria-label="Filter causes by category">
                {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                  <button key={key} type="button" className={filter === key ? "is-active" : ""} onClick={() => setFilter(key)}>
                    {label}
                  </button>
                ))}
              </div>

              {filtered.length ? (
                <div className="giving-cause-grid">
                  {filtered.map((cause) => <CauseCard key={cause.id} cause={cause} slug={slug} />)}
                </div>
              ) : (
                <div className="giving-empty-filter">
                  <HeartHandshake aria-hidden="true" />
                  <h3>No active causes in this category yet.</h3>
                  <p>Have an idea? Alumni can propose a cause for director review.</p>
                  <Link to={tenantRoute(slug, "/giving/new")}>Create a cause</Link>
                </div>
              )}
            </section>

            {payload?.completed?.length ? (
              <section className="giving-section giving-completed" aria-labelledby="completed-causes-title">
                <div className="giving-section-head">
                  <div>
                    <p className="giving-section-eyebrow">What we’ve done together</p>
                    <h2 id="completed-causes-title">Funded by {campName} alumni</h2>
                  </div>
                </div>
                <div className="giving-cause-grid">
                  {payload.completed.map((cause) => <CauseCard key={cause.id} cause={cause} slug={slug} completed />)}
                </div>
              </section>
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}
