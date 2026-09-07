import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@pondbridge/ui";
import { CircleUser, ShieldCheck } from "lucide-react";
import { requestJson } from "../lib/http.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useTenant } from "../context/TenantContext.jsx";
import { normalizeTenantRouteForHost, tenantRoute } from "../lib/tenantRouting.js";

/**
 * The gate between an imported profile and the alumni directory.
 *
 * A camp can upload a questionnaire and create an account for someone who has
 * never visited the site. That profile stays invisible to every member until
 * the person it describes signs in and says the information is theirs. This is
 * where they say it — reached both from the emailed link and from an ordinary
 * signup, because the access decision routes them here either way.
 */

/**
 * Label/value pairs for the recognition card, in the order someone would use to
 * place themselves: who you are, then camp, then everything since. Exported so
 * the ordering and the blank-dropping can be tested without a DOM.
 */
export function summaryRows(summary = {}) {
  const rows = [];
  const name = [summary.firstName, summary.lastName].filter(Boolean).join(" ");
  if (name) rows.push(["Name", name]);
  if (summary.roleAtCamp) rows.push(["At camp", summary.roleAtCamp]);
  if (Array.isArray(summary.campYears) && summary.campYears.length) {
    rows.push(["Years", summary.campYears.join("–")]);
  }
  if (summary.cityState) rows.push(["Lives in", summary.cityState]);
  if (summary.highSchool) rows.push(["High school", summary.highSchool]);
  if (Array.isArray(summary.colleges) && summary.colleges.length) {
    rows.push(["College", summary.colleges.join(", ")]);
  }
  if (Array.isArray(summary.currentJobs) && summary.currentJobs.length) {
    rows.push([
      "Work",
      summary.currentJobs
        .map((job) => [job.role, job.company].filter(Boolean).join(" at "))
        .filter(Boolean)
        .join("; ")
    ]);
  }
  if (summary.industry) rows.push(["Industry", summary.industry]);
  return rows.filter(([, value]) => String(value || "").trim());
}

export default function TenantClaimProfilePage() {
  const navigate = useNavigate();
  const params = useParams();
  const { slug: contextSlug = "", tenant } = useTenant();
  const slug = String(params.slug || contextSlug || "").trim().toLowerCase();
  const { token, isReady } = useAuth();

  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [declined, setDeclined] = useState(false);
  const [error, setError] = useState("");

  const campName = String(tenant?.name || "").trim() || "Your camp";

  const goTo = useCallback(
    (path) => navigate(normalizeTenantRouteForHost(slug, path), { replace: true }),
    [navigate, slug]
  );

  useEffect(() => {
    if (!isReady || !slug || !token) return undefined;
    let active = true;

    (async () => {
      try {
        const payload = await requestJson(`/api/t/${slug}/access/decision`, { token });
        if (!active) return;
        const decision = payload?.decision || {};
        // Someone who has already claimed — or who never had a profile waiting —
        // has no business on this page. Send them wherever they actually belong.
        if (decision.state !== "profile_ready_to_claim") {
          goTo(String(decision.nextRoute || tenantRoute(slug, "/home")));
          return;
        }
        setSummary(decision.claimSummary || {});
      } catch (err) {
        if (!active) return;
        setError(String(err?.message || "Could not load the profile waiting for you."));
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [goTo, isReady, slug, token]);

  async function confirm() {
    setBusy("confirm");
    setError("");
    try {
      const payload = await requestJson(`/api/t/${slug}/access/claim/confirm`, {
        method: "POST",
        token,
        body: {}
      });
      // Straight to editing, not the home page: the fastest moment to get a
      // correction is while someone is still looking at the thing to correct.
      goTo(String(payload?.nextRoute || tenantRoute(slug, "/edit-profile")));
    } catch (err) {
      setError(String(err?.message || "Could not confirm your profile. Try again."));
      setBusy("");
    }
  }

  async function decline() {
    setBusy("decline");
    setError("");
    try {
      await requestJson(`/api/t/${slug}/access/claim/decline`, {
        method: "POST",
        token,
        body: {}
      });
      setDeclined(true);
    } catch (err) {
      setError(String(err?.message || "Could not send that to your director. Try again."));
    } finally {
      setBusy("");
    }
  }

  if (loading) {
    return (
      <section className="app-status-shell">
        <div className="app-status-card">
          <p>Looking for your profile...</p>
        </div>
      </section>
    );
  }

  if (declined) {
    return (
      <section className="app-status-shell">
        <div className="app-status-card pb-claim">
          <h1>Thanks — we have told {campName}</h1>
          <p className="pb-claim-lede">
            A director will sort out whose profile that is. Nothing from it has been
            made visible, and nobody else can see it.
          </p>
          <p className="pb-claim-note">
            They will be in touch at the address you signed in with.
          </p>
        </div>
      </section>
    );
  }

  const rows = summaryRows(summary || {});

  return (
    <section className="app-status-shell">
      <div className="app-status-card pb-claim">
        <span className="pb-claim-mark" aria-hidden="true">
          <CircleUser />
        </span>

        <h1>{campName} already started a profile for you</h1>
        <p className="pb-claim-lede">
          It was filled in from the alumni questionnaire. Check it over — nothing here
          is visible to anyone else until you confirm it is yours.
        </p>

        {rows.length ? (
          <dl className="pb-claim-summary">
            {rows.map(([label, value]) => (
              <div className="pb-claim-row" key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="pb-claim-lede">
            The questionnaire did not include much beyond your email address. You can
            fill in the rest yourself once you are in.
          </p>
        )}

        <p className="pb-claim-note">
          <ShieldCheck aria-hidden="true" />
          <span>You can change or delete any of this straight after you confirm.</span>
        </p>

        {error ? <p className="error-text" role="alert">{error}</p> : null}

        <div className="pb-claim-actions">
          <Button onClick={confirm} disabled={Boolean(busy)}>
            {busy === "confirm" ? "Setting up..." : "Yes, this is me"}
          </Button>
          <Button variant="secondary" onClick={decline} disabled={Boolean(busy)}>
            {busy === "decline" ? "Sending..." : "This is not me"}
          </Button>
        </div>
      </div>
    </section>
  );
}
