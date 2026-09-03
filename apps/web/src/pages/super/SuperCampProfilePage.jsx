import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Badge, Button, Card, Input, Textarea } from "@pondbridge/ui";
import { useAuth } from "../../context/AuthContext.jsx";
import { requestJson } from "../../lib/http.js";
import { billingPlanShortLabel as billingPlanLabel } from "../../lib/billingPlanCatalog.js";

function roleFromUser(user) {
  const roles = new Set(user?.roles || []);
  if (roles.has("super_admin")) return "super_admin";
  if (roles.has("support_admin")) return "support_admin";
  if (roles.has("finance_admin")) return "finance_admin";
  return "unknown";
}

function canMutate(role) {
  return role === "super_admin";
}

function formatMoney(value = 0) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString([], { dateStyle: "medium" });
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function humanize(value = "") {
  const text = String(value || "").replace(/_/g, " ").trim();
  if (!text) return "—";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function toneForBillingStatus(status = "") {
  const key = String(status || "").toLowerCase();
  if (["active", "comp"].includes(key)) return "success";
  if (key === "trialing") return "info";
  if (["past_due", "canceled"].includes(key)) return "danger";
  return "neutral";
}

function Fact({ label, children }) {
  return (
    <article className="super-camp-profile-fact">
      <span>{label}</span>
      <strong>{children}</strong>
    </article>
  );
}

// The claim link is rebuilt from the camp domain on every load, so it is not
// something the operator can lose. This block just makes that obvious.
export function ClaimLinkRow({ label, value, onCopy, hint = "" }) {
  if (!value) return null;
  return (
    <div className="super-camp-profile-link">
      <p className="super-create-result-label">{label}</p>
      <div className="super-create-result-link-row">
        <Input readOnly value={value} onFocus={(event) => event.target.select()} />
        <div className="super-create-result-actions">
          <Button type="button" variant="secondary" onClick={() => onCopy(value, label)}>
            Copy
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => window.open(value, "_blank", "noopener,noreferrer")}
          >
            Open
          </Button>
        </div>
      </div>
      {hint ? <p className="super-create-result-note">{hint}</p> : null}
    </div>
  );
}

const EMPTY_PROFILE_FORM = {
  directorEmail: "",
  contactName: "",
  contactPhone: "",
  notes: ""
};

export default function SuperCampProfilePage() {
  const { tenantId } = useParams();
  const { token, user, getAuthToken } = useAuth();
  const role = roleFromUser(user);
  const editable = canMutate(role);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [form, setForm] = useState(EMPTY_PROFILE_FORM);
  const [savedForm, setSavedForm] = useState(EMPTY_PROFILE_FORM);
  const [saving, setSaving] = useState(false);
  const [busyAction, setBusyAction] = useState("");

  const loadCamp = useCallback(async () => {
    if (!token || !tenantId) return;
    try {
      setError("");
      const payload = await requestJson(`/api/super/tenants/${encodeURIComponent(tenantId)}`, {
        token,
        getToken: () => getAuthToken()
      });
      setData(payload);
      const profile = payload?.campProfile || {};
      const nextForm = {
        directorEmail: profile.directorEmail || "",
        contactName: profile.contactName || "",
        contactPhone: profile.contactPhone || "",
        notes: profile.notes || ""
      };
      setForm(nextForm);
      setSavedForm(nextForm);
    } catch (loadError) {
      setError(loadError.message || "Could not load this camp.");
    } finally {
      setLoading(false);
    }
  }, [getAuthToken, tenantId, token]);

  useEffect(() => {
    setLoading(true);
    loadCamp();
  }, [loadCamp]);

  const tenant = data?.tenant || null;
  const claim = data?.directorClaim || {};
  const dirty = useMemo(
    () => Object.keys(EMPTY_PROFILE_FORM).some((key) => form[key] !== savedForm[key]),
    [form, savedForm]
  );

  async function copyLink(value, label) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setStatus(`${label} copied.`);
    } catch {
      setError("Could not copy to the clipboard. Select the link and copy it manually.");
    }
  }

  async function saveProfile(event) {
    event.preventDefault();
    if (!editable || saving) return;
    setSaving(true);
    setError("");
    setStatus("");
    try {
      const payload = await requestJson(`/api/super/tenants/${encodeURIComponent(tenantId)}`, {
        method: "PATCH",
        token,
        getToken: () => getAuthToken(),
        body: form
      });
      const profile = payload?.campProfile || form;
      const nextForm = {
        directorEmail: profile.directorEmail || "",
        contactName: profile.contactName || "",
        contactPhone: profile.contactPhone || "",
        notes: profile.notes || ""
      };
      setForm(nextForm);
      setSavedForm(nextForm);
      setData((prev) => (prev ? { ...prev, campProfile: profile } : prev));
      setStatus("Client record saved.");
    } catch (saveError) {
      setError(saveError.message || "Could not save the client record.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus() {
    if (!tenant || !editable || busyAction) return;
    const nextStatus = tenant.status === "active" ? "inactive" : "active";
    setBusyAction("status");
    setError("");
    setStatus("");
    try {
      await requestJson(`/api/super/tenants/${encodeURIComponent(tenantId)}`, {
        method: "PATCH",
        token,
        getToken: () => getAuthToken(),
        body: { status: nextStatus }
      });
      setStatus(`${tenant.name} is now ${nextStatus}.`);
      await loadCamp();
    } catch (toggleError) {
      setError(toggleError.message || "Could not update camp status.");
    } finally {
      setBusyAction("");
    }
  }

  async function provisionDomain() {
    if (!tenant || !editable || busyAction) return;
    setBusyAction("domain");
    setError("");
    setStatus("");
    try {
      const payload = await requestJson(
        `/api/super/tenants/${encodeURIComponent(tenantId)}/provision-domain`,
        { method: "POST", token, getToken: () => getAuthToken(), body: {} }
      );
      setStatus(`Domain provisioned: ${payload?.domain || tenant.customDomain || ""}.`);
      await loadCamp();
    } catch (provisionError) {
      setError(provisionError.message || "Could not provision the camp domain.");
    } finally {
      setBusyAction("");
    }
  }

  if (loading) {
    return (
      <div className="super-panel-stack">
        <Card>
          <p className="muted">Loading camp profile...</p>
        </Card>
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="super-panel-stack">
        <Card>
          <h2 className="pb-section-title">{error ? "Could not load this camp" : "Camp not found"}</h2>
          <p className="muted">{error || "This camp record is no longer available."}</p>
          <p>
            <Link to="/super/tenants">Back to all camps</Link>
          </p>
        </Card>
      </div>
    );
  }

  const counts = tenant.counts || {};
  const billing = data?.billing || {};
  const onboarding = data?.onboarding || {};
  const network = data?.network || {};
  const profile = data?.campProfile || {};

  return (
    <div className="super-panel-stack super-camp-profile">
      <Card className="super-camp-profile-header-card">
        <p className="super-camp-profile-breadcrumb">
          <Link to="/super/tenants">All camps</Link>
        </p>
        <div className="super-camp-profile-header">
          <div>
            <h1>{tenant.name}</h1>
            <p className="super-camp-profile-subtitle">
              {network.domain || tenant.customDomain || tenant.slug}
            </p>
          </div>
          <div className="super-camp-profile-header-badges">
            {tenant.isDemo ? <Badge tone="warning">Demo camp</Badge> : null}
            <Badge tone={tenant.status === "active" ? "success" : "neutral"}>{humanize(tenant.status)}</Badge>
            <Badge tone="info">{billingPlanLabel(tenant.billingPlan)}</Badge>
            <Badge tone={toneForBillingStatus(billing.status)}>
              {`Billing: ${humanize(billing.status)}`}
            </Badge>
          </div>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        {status ? <p className="success-text">{status}</p> : null}
        <div className="super-camp-profile-actions">
          {network.appUrl ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => window.open(network.appUrl, "_blank", "noopener,noreferrer")}
            >
              Open camp site
            </Button>
          ) : null}
          <Button type="button" variant="secondary" onClick={toggleStatus} disabled={!editable || Boolean(busyAction)}>
            {busyAction === "status" ? "Saving..." : tenant.status === "active" ? "Disable camp" : "Enable camp"}
          </Button>
          <Button type="button" variant="secondary" onClick={provisionDomain} disabled={!editable || Boolean(busyAction)}>
            {busyAction === "domain" ? "Provisioning..." : "Provision domain"}
          </Button>
          {!editable ? <small className="muted">View only role</small> : null}
        </div>
      </Card>

      <Card className="super-camp-profile-claim-card">
        <h2 className="pb-section-title">Director claim link</h2>
        <p className="muted">
          This link is rebuilt from the camp domain every time you open this page, so it cannot be
          lost. Send it to the director who is setting the camp up.
        </p>
        <ClaimLinkRow label="Director claim link" value={claim.liveUrl} onCopy={copyLink} />
        {claim.fallbackPath ? (
          <p className="super-create-result-note">
            Fallback while the camp domain is still activating: <code>{claim.fallbackPath}</code>
          </p>
        ) : null}
        {claim.capturedIsStale ? (
          <ClaimLinkRow
            label="Link shared when this camp was created"
            value={claim.capturedUrl}
            onCopy={copyLink}
            hint="The camp domain changed since this link was handed out. Anyone still holding it should use the link above instead."
          />
        ) : null}
      </Card>

      <Card className="super-camp-profile-facts-card">
        <h2 className="pb-section-title">At a glance</h2>
        <div className="super-camp-profile-fact-grid">
          <Fact label="Slug">{tenant.slug}</Fact>
          <Fact label="Domain">{network.domain || "—"}</Fact>
          <Fact label="Members">{counts.members || 0}</Fact>
          <Fact label="Directors">{counts.directors || 0}</Fact>
          <Fact label="Onboarding">{onboarding.stage || humanize(onboarding.status)}</Fact>
          <Fact label="Current step">{onboarding.stepLabel || "—"}</Fact>
          <Fact label="Created">{formatDate(tenant.createdAt)}</Fact>
        </div>
      </Card>

      <Card className="super-camp-profile-record-card">
        <h2 className="pb-section-title">Client record</h2>
        <p className="muted">
          Internal to the PondBridge team — nothing here is shown to the camp. Editing needs a super
          admin session.
        </p>
        <form className="super-form-grid" onSubmit={saveProfile}>
          <label>
            Director contact email
            <Input
              type="email"
              value={form.directorEmail}
              disabled={!editable}
              onChange={(event) => setForm((prev) => ({ ...prev, directorEmail: event.target.value }))}
            />
          </label>
          <label>
            Main contact name
            <Input
              value={form.contactName}
              disabled={!editable}
              onChange={(event) => setForm((prev) => ({ ...prev, contactName: event.target.value }))}
            />
          </label>
          <label>
            Contact phone
            <Input
              value={form.contactPhone}
              disabled={!editable}
              onChange={(event) => setForm((prev) => ({ ...prev, contactPhone: event.target.value }))}
            />
          </label>
          <label className="full-width">
            Notes
            <Textarea
              rows={6}
              value={form.notes}
              disabled={!editable}
              placeholder="Renewal dates, who to call, what they asked for last."
              onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
            />
          </label>
          <div className="super-form-actions full-width">
            <Button type="submit" disabled={!editable || saving || !dirty}>
              {saving ? "Saving..." : "Save client record"}
            </Button>
            {profile.updatedAt ? (
              <small className="muted">Last edited {formatDateTime(profile.updatedAt)}</small>
            ) : null}
          </div>
        </form>
      </Card>

      <Card className="super-camp-profile-billing-card">
        <h2 className="pb-section-title">Billing</h2>
        <div className="super-camp-profile-fact-grid">
          <Fact label="Plan">{billingPlanLabel(billing.billingPlan)}</Fact>
          <Fact label="Annual">{formatMoney(billing.annualAmount)}</Fact>
          <Fact label="Status">{humanize(billing.status)}</Fact>
          <Fact label="Card">{billing.paymentMethodLabel || "—"}</Fact>
          <Fact label="Onboarding fee">
            {billing.onboardingFeeAmount
              ? `${formatMoney(billing.onboardingFeeAmount)} · ${billing.onboardingFeePaid ? "paid" : "unpaid"}`
              : "None"}
          </Fact>
          <Fact label="Next renewal">{formatDate(billing.currentPeriodEnd)}</Fact>
        </div>
        <p className="super-create-result-note">
          <Link to={`/super/billing/tenants?search=${encodeURIComponent(tenant.slug)}`}>
            Open this camp in billing
          </Link>
        </p>
      </Card>

      <Card className="super-camp-profile-directors-card">
        <h2 className="pb-section-title">Directors</h2>
        {data?.directors?.length ? (
          <div className="super-table-wrap">
            <table className="super-data-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Last sign-in</th>
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {data.directors.map((director) => (
                  <tr key={director.id}>
                    <td>{director.email}</td>
                    <td>{humanize(director.status)}</td>
                    <td>{formatDateTime(director.lastLoginAt)}</td>
                    <td>{formatDate(director.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">
            No director has claimed this camp yet. Send the claim link above — the first verified
            signup on the camp domain becomes the director.
          </p>
        )}
      </Card>

      <Card className="super-camp-profile-activity-card">
        <h2 className="pb-section-title">Recent admin activity</h2>
        {data?.activity?.length ? (
          <ul className="super-camp-profile-activity">
            {data.activity.map((entry) => (
              <li key={entry.id}>
                <span>{humanize(entry.event)}</span>
                <small>{formatDateTime(entry.createdAt)}</small>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Nothing recorded for this camp yet.</p>
        )}
      </Card>
    </div>
  );
}
