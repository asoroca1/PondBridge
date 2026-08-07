import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Button, Card } from "@pondbridge/ui";
import { PageHeader } from "../../components/admin/AdminUi.jsx";
import useAdminApi from "./useAdminApi.js";

function tenantAdminHref(slug, href = "/admin") {
  const safeHref = String(href || "/admin");
  return `/t/${slug}${safeHref.startsWith("/") ? safeHref : `/${safeHref}`}`;
}

/**
 * Read-only view of how alumni move from "known" to "active member". Acting on
 * any of it — adding people, inviting, approving — happens in the People
 * workspace, so there is one list to learn instead of two.
 */
export default function DirectorAdminGrowthPage() {
  const { slug, request } = useAdminApi();
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const loadSequenceRef = useRef(0);

  const loadGrowth = useCallback(async ({ quiet = false } = {}) => {
    const sequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = sequence;
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      // Only the aggregates are needed here; the contact list lives in People.
      const next = await request("/growth?limit=1");
      if (sequence === loadSequenceRef.current) setPayload(next);
    } catch (requestError) {
      if (sequence === loadSequenceRef.current) {
        setError(requestError.message || "Could not load alumni growth data.");
      }
    } finally {
      if (sequence === loadSequenceRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [request]);

  useEffect(() => { loadGrowth(); }, [loadGrowth]);

  if (loading && !payload) return <Card>Loading alumni growth…</Card>;

  const metrics = payload?.metrics || {};
  const funnel = payload?.funnel || [];
  const maxFunnelCount = Math.max(1, ...funnel.map((item) => Number(item.count || 0)));

  return (
    <>
      <Card className="director-growth-hero">
        <PageHeader
          title="Alumni growth"
          subtitle="Where alumni drop off between being known, invited, joining, and staying active."
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

      {payload && payload.storage?.available === false ? (
        <Card className="director-growth-storage-warning">
          <Badge tone="warning">Storage setup required</Badge>
          <div>
            <strong>Reporting works, but new pre-member alumni cannot be saved yet.</strong>
            <p>{payload.storage?.message || "Apply the communications system schema in staging."}</p>
          </div>
        </Card>
      ) : null}

      <div className="director-growth-grid">
        <Card>
          <h2>Growth funnel</h2>
          <p className="muted">Each step is the number of alumni who reached it.</p>
          <div className="director-growth-funnel">
            {funnel.map((step) => (
              <div key={step.key}>
                <span>{step.label}</span>
                <div>
                  <i
                    aria-hidden="true"
                    style={{ width: `${Math.max(4, (Number(step.count || 0) / maxFunnelCount) * 100)}%` }}
                  />
                </div>
                <strong>{step.count || 0}</strong>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <h2>Best next actions</h2>
          <p className="muted">Server-derived audiences that are worth outreach right now.</p>
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

      <Card className="director-growth-handoff">
        <h2>Work the pipeline</h2>
        <p className="muted">
          Adding alumni, sending invitations, and reviewing requests all happen in the People
          workspace, where every stage shares one list.
        </p>
        <div className="director-growth-handoff-links">
          <Link className="link-button" to={tenantAdminHref(slug, "/admin/people/prospect")}>
            Prospects{metrics.neverInvited ? ` (${metrics.neverInvited})` : ""}
          </Link>
          <Link className="link-button secondary" to={tenantAdminHref(slug, "/admin/people/expired")}>
            Expired invites{metrics.expiredInvites ? ` (${metrics.expiredInvites})` : ""}
          </Link>
          <Link className="link-button secondary" to={tenantAdminHref(slug, "/admin/people/add")}>
            Add people
          </Link>
        </div>
      </Card>
    </>
  );
}
