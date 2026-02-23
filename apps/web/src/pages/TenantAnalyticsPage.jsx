import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Card, PageShell, SectionTitle } from "@pondbridge/ui";
import { requestJson } from "../lib/http.js";
import { useAuth } from "../context/AuthContext.jsx";

function MetricCard({ label, value, hint = "" }) {
  return (
    <article className="analytics-metric-card">
      <p className="analytics-metric-label">{label}</p>
      <p className="analytics-metric-value">{value}</p>
      {hint ? <p className="muted">{hint}</p> : null}
    </article>
  );
}

function HorizontalBarChart({ title, items = [], emptyText = "No data yet" }) {
  const maxCount = Math.max(1, ...items.map((item) => Number(item.count || 0)));

  return (
    <div className="analytics-chart">
      <h3>{title}</h3>
      {items.length === 0 ? (
        <p className="muted">{emptyText}</p>
      ) : (
        <div className="analytics-bar-list">
          {items.map((item) => (
            <div className="analytics-bar-row" key={`${item.label}-${item.count}`}>
              <div className="analytics-bar-head">
                <span>{item.label}</span>
                <strong>{item.count}</strong>
              </div>
              <div className="analytics-bar-track">
                <span
                  className="analytics-bar-fill"
                  style={{ width: `${Math.max(6, Math.round((item.count / maxCount) * 100))}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TenantAnalyticsPage() {
  const { slug } = useParams();
  const { token } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [payload, setPayload] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    requestJson(`/api/t/${slug}/admin/analytics`, { token })
      .then((response) => {
        if (cancelled) return;
        setPayload(response);
      })
      .catch((requestError) => {
        if (cancelled) return;
        setError(requestError.message);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [slug, token]);

  const analytics = payload?.analytics;
  const summaryCards = useMemo(() => {
    if (!analytics) return [];
    return [
      {
        label: "Total Users",
        value: analytics.totals?.users || 0
      },
      {
        label: "Total Profiles",
        value: analytics.totals?.profiles || 0
      },
      {
        label: "Weekly Active Users",
        value: analytics.engagement?.weeklyActiveUsers || 0,
        hint: "Unique active users in last 7 days"
      },
      {
        label: "Signups (7 Days)",
        value: analytics.engagement?.signupsLast7Days || 0
      },
      {
        label: "Signups (30 Days)",
        value: analytics.engagement?.signupsLast30Days || 0
      },
      {
        label: "Profile Completion",
        value: `${analytics.profileCompletion?.averagePercent || 0}%`,
        hint: `Across ${analytics.profileCompletion?.profileCount || 0} profiles`
      }
    ];
  }, [analytics]);

  if (loading) {
    return (
      <PageShell className="pb-cedar-page">
        <Card>Loading analytics...</Card>
      </PageShell>
    );
  }

  if (error) {
    return (
      <PageShell className="pb-cedar-page">
        <Card>
          <p className="error-text">{error}</p>
          <Link className="link-button secondary" to={`/t/${slug}/admin`}>
            Back to admin
          </Link>
        </Card>
      </PageShell>
    );
  }

  return (
    <PageShell className="pb-cedar-page">
      <Card>
        <h1>Camp Analytics</h1>
        <p className="muted">
          Aggregated metrics only. No raw personal-level events are shown.
        </p>
        <p className="muted">
          Last generated:{" "}
          {analytics?.generatedAt ? new Date(analytics.generatedAt).toLocaleString() : "Unknown"}
        </p>
        <Link className="link-button secondary" to={`/t/${slug}/admin`}>
          Back to admin
        </Link>
      </Card>

      <Card>
        <SectionTitle>Overview</SectionTitle>
        <div className="analytics-metric-grid">
          {summaryCards.map((item) => (
            <MetricCard key={item.label} label={item.label} value={item.value} hint={item.hint} />
          ))}
        </div>
      </Card>

      <Card>
        <SectionTitle>Top Search Terms</SectionTitle>
        <HorizontalBarChart
          title="Directory Searches (30 days)"
          items={analytics?.topSearchTerms || []}
          emptyText="No searchable term data yet."
        />
      </Card>

      <Card>
        <SectionTitle>Geography</SectionTitle>
        <HorizontalBarChart
          title="Profiles by State"
          items={analytics?.geographicDistribution || []}
          emptyText="No location data yet."
        />
      </Card>
    </PageShell>
  );
}
