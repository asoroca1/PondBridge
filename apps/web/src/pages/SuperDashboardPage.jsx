import { useEffect, useState } from "react";
import { Badge, Button, Card, Input, PageShell, Select } from "@pondbridge/ui";
import { requestJson } from "../lib/http.js";
import { useAuth } from "../context/AuthContext.jsx";
import { defaultTenantDomain } from "../lib/domain.js";

const initialForm = {
  name: "",
  slug: "",
  planTier: "base",
  onboardingFeeAmount: 0,
  directorEmail: ""
};

export default function SuperDashboardPage() {
  const { token, user, logout } = useAuth();

  const [summary, setSummary] = useState(null);
  const [camps, setCamps] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [claimLink, setClaimLink] = useState("");

  async function loadData() {
    const [dashboardPayload, campsPayload] = await Promise.all([
      requestJson("/api/super/dashboard", { token }),
      requestJson("/api/super/tenants", { token })
    ]);

    setSummary(dashboardPayload.counts);
    setCamps(campsPayload.items || []);
  }

  useEffect(() => {
    loadData().catch((loadError) => setError(loadError.message));
  }, [token]);

  async function createCamp(event) {
    event.preventDefault();
    setError("");
    setStatus("");
    setClaimLink("");

    try {
      const payload = await requestJson("/api/super/tenants", {
        method: "POST",
        token,
        body: form
      });

      const nextClaimLink = payload.directorClaimLink || payload.directorInvite?.claimUrl || "";
      setClaimLink(nextClaimLink);
      setStatus(
        nextClaimLink
          ? `Created ${payload.tenant.name}. Director claim link is ready.`
          : `Created ${payload.tenant.name}. Add a director email to generate a claim link.`
      );
      setForm(initialForm);
      await loadData();
    } catch (createError) {
      setError(createError.message);
    }
  }

  async function copyClaimLink() {
    if (!claimLink) return;
    try {
      await navigator.clipboard.writeText(claimLink);
      setStatus("Director claim link copied.");
    } catch {
      setError("Could not copy to clipboard. Copy the link manually.");
    }
  }

  async function toggleCamp(camp) {
    const nextStatus = camp.status === "active" ? "inactive" : "active";
    setError("");
    setStatus("");

    try {
      await requestJson(`/api/super/tenants/${camp._id}`, {
        method: "PATCH",
        token,
        body: { status: nextStatus }
      });
      setStatus(`Camp ${camp.slug} is now ${nextStatus}.`);
      await loadData();
    } catch (toggleError) {
      setError(toggleError.message);
    }
  }

  function planLabel(planTier) {
    return planTier === "premium" ? "Premium" : "Base";
  }

  function onboardingLabel(status) {
    if (!status) return "Not started";
    return status
      .replace(/_/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  async function handleLogout() {
    try {
      await requestJson("/api/auth/super/logout", {
        method: "POST",
        token
      });
    } catch {
      // No-op; still clear client-side auth.
    } finally {
      logout();
      window.location.assign("/super/login");
    }
  }

  if (!user?.roles?.includes("super_admin")) {
    return (
      <PageShell className="pb-cedar-page">
        <Card>Super admin access required.</Card>
      </PageShell>
    );
  }

  return (
    <PageShell className="pb-cedar-page super-dashboard-shell">
      <Card className="super-dashboard-hero">
        <div className="super-dashboard-hero-head">
          <div>
            <h1>Super Admin Dashboard</h1>
            <p className="muted">Create camps, issue director claim links, and manage network status.</p>
          </div>
          <Button variant="secondary" onClick={handleLogout}>
            Log out
          </Button>
        </div>

        <div className="super-dashboard-stats">
          <article className="super-dashboard-stat">
            <p className="super-dashboard-stat-label">Camps</p>
            <strong>{summary?.tenants ?? "..."}</strong>
          </article>
          <article className="super-dashboard-stat">
            <p className="super-dashboard-stat-label">Users</p>
            <strong>{summary?.users ?? "..."}</strong>
          </article>
          <article className="super-dashboard-stat">
            <p className="super-dashboard-stat-label">Profiles</p>
            <strong>{summary?.profiles ?? "..."}</strong>
          </article>
        </div>

        {error ? <p className="error-text">{error}</p> : null}
        {status ? <p className="success-text">{status}</p> : null}
        {claimLink ? (
          <div className="super-claim-link-wrap">
            <p className="super-claim-link-label">Director claim link</p>
            <div className="inline-actions">
              <Input readOnly value={claimLink} />
              <Button variant="secondary" onClick={copyClaimLink}>
                Copy claim link
              </Button>
            </div>
          </div>
        ) : null}
      </Card>

      <div className="super-dashboard-grid">
        <Card className="super-create-card">
          <h2>Create Camp</h2>
          <p className="muted">
            This creates the tenant record and optional director invite. Directors complete setup in onboarding.
          </p>
          <form onSubmit={createCamp} className="form-grid super-create-grid">
            <label>
              Camp name
              <Input
                value={form.name}
                placeholder="Camp Cedar"
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              />
            </label>
            <label>
              Camp URL key
              <Input
                value={form.slug}
                placeholder="cedar"
                onChange={(event) => setForm((prev) => ({ ...prev, slug: event.target.value }))}
              />
            </label>
            <label>
              Plan tier
              <Select
                value={form.planTier}
                onChange={(event) => setForm((prev) => ({ ...prev, planTier: event.target.value }))}
              >
                <option value="base">Base</option>
                <option value="premium">Premium</option>
              </Select>
            </label>
            <label>
              Onboarding fee (USD)
              <Input
                type="number"
                min={0}
                step={50}
                value={form.onboardingFeeAmount}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, onboardingFeeAmount: Number(event.target.value || 0) }))
                }
              />
            </label>
            <label className="super-create-full">
              Director email (optional)
              <Input
                type="email"
                placeholder="director@campname.org"
                value={form.directorEmail}
                onChange={(event) => setForm((prev) => ({ ...prev, directorEmail: event.target.value }))}
              />
            </label>

            <div className="inline-actions super-create-actions">
              <Button type="submit">Create camp</Button>
            </div>
          </form>
        </Card>

        <Card className="super-camps-card">
          <div className="super-camps-head">
            <h2>All Camps</h2>
            <Badge tone="neutral">{camps.length} total</Badge>
          </div>

          {camps.length ? (
            <div className="super-camps-list">
              {camps.map((camp) => (
                <article className="super-camp-item" key={camp._id}>
                  <header className="super-camp-item-head">
                    <h3>{camp.name}</h3>
                    <Badge tone={camp.status === "active" ? "success" : "danger"}>
                      {camp.status === "active" ? "Active" : "Disabled"}
                    </Badge>
                  </header>
                  <p className="super-camp-domain">{camp.customDomain || defaultTenantDomain(camp.slug)}</p>
                  <div className="super-camp-meta">
                    <p>
                      <strong>URL key:</strong> {camp.slug}
                    </p>
                    <p>
                      <strong>Plan:</strong> {planLabel(camp.planTier)}
                    </p>
                    <p>
                      <strong>Onboarding:</strong> {onboardingLabel(camp.onboardingStatus)}
                    </p>
                    <p>
                      <strong>Users:</strong> {camp.counts?.users || 0}
                    </p>
                    <p>
                      <strong>Profiles:</strong> {camp.counts?.profiles || 0}
                    </p>
                  </div>
                  <div className="inline-actions">
                    <Button variant="secondary" onClick={() => toggleCamp(camp)}>
                      {camp.status === "active" ? "Disable camp" : "Enable camp"}
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="muted">No camps yet. Create your first one above.</p>
          )}
        </Card>
      </div>
    </PageShell>
  );
}
