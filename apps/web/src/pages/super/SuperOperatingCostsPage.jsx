import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Input, Select, Textarea } from "@pondbridge/ui";
import { useAuth } from "../../context/AuthContext.jsx";
import { requestJson } from "../../lib/http.js";
import { ModalConfirm, ModalDialog } from "../../components/admin/AdminUi.jsx";

const EMPTY_FORM = {
  name: "",
  vendor: "",
  category: "infrastructure",
  amount: "",
  currency: "USD",
  billingCycle: "monthly",
  status: "active",
  startedOn: "",
  renewsOn: "",
  url: "",
  notes: ""
};

function formatCents(cents = 0, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(Number(cents || 0) / 100);
}

function formatDate(value) {
  if (!value) return "—";
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function labelFor(options = [], value = "") {
  return options.find((option) => option.value === value)?.label || value || "—";
}

function statusTone(status) {
  if (status === "active") return "success";
  if (status === "paused") return "warning";
  return "neutral";
}

function costToForm(cost) {
  return {
    name: cost.name || "",
    vendor: cost.vendor || "",
    category: cost.category || "infrastructure",
    amount: (Number(cost.amountCents || 0) / 100).toFixed(2),
    currency: cost.currency || "USD",
    billingCycle: cost.billingCycle || "monthly",
    status: cost.status || "active",
    startedOn: cost.startedOn ? String(cost.startedOn).slice(0, 10) : "",
    renewsOn: cost.renewsOn ? String(cost.renewsOn).slice(0, 10) : "",
    url: cost.url || "",
    notes: cost.notes || ""
  };
}

function StatBlock({ label, value, subtext, tone = "neutral" }) {
  return (
    <div className={`super-cost-stat tone-${tone}`}>
      <span className="super-cost-stat-label">{label}</span>
      <strong className="super-cost-stat-value">{value}</strong>
      {subtext ? <small className="super-cost-stat-sub">{subtext}</small> : null}
    </div>
  );
}

export default function SuperOperatingCostsPage() {
  const { token, user } = useAuth();
  const canEdit = Boolean(user?.roles?.includes("super_admin"));

  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [categoryFilter, setCategoryFilter] = useState("");

  const [editing, setEditing] = useState(null); // null | { id?: string }
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  async function loadCosts() {
    try {
      setError("");
      const data = await requestJson("/api/super/finance/costs", { token });
      setPayload(data);
    } catch (loadError) {
      setError(loadError.message || "Could not load operating costs.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!token) return;
    loadCosts();
  }, [token]);

  const options = payload?.options || { categories: [], billingCycles: [], statuses: [] };
  const summary = payload?.summary || null;
  const revenue = payload?.revenue || null;
  const currency = summary?.primaryCurrency || "USD";

  const visibleCosts = useMemo(() => {
    const items = payload?.items || [];
    return items.filter((cost) => {
      if (statusFilter && cost.status !== statusFilter) return false;
      if (categoryFilter && cost.category !== categoryFilter) return false;
      return true;
    });
  }, [payload, statusFilter, categoryFilter]);

  function openCreate() {
    setForm(EMPTY_FORM);
    setFormError("");
    setEditing({});
  }

  function openEdit(cost) {
    setForm(costToForm(cost));
    setFormError("");
    setEditing({ id: cost.id });
  }

  function updateField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setFormError("");

    const body = { ...form, url: form.url.trim(), notes: form.notes.trim() };
    const isEdit = Boolean(editing?.id);

    try {
      await requestJson(isEdit ? `/api/super/finance/costs/${editing.id}` : "/api/super/finance/costs", {
        method: isEdit ? "PATCH" : "POST",
        token,
        body
      });
      setEditing(null);
      await loadCosts();
    } catch (submitError) {
      setFormError(submitError.message || "Could not save this cost.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    try {
      await requestJson(`/api/super/finance/costs/${pendingDelete.id}`, { method: "DELETE", token });
      setPendingDelete(null);
      await loadCosts();
    } catch (deleteError) {
      setError(deleteError.message || "Could not remove this cost.");
    } finally {
      setDeleting(false);
    }
  }

  const maxCategoryMonthly = Math.max(1, ...(summary?.byCategory || []).map((entry) => entry.monthlyCents));

  return (
    <div className="super-panel-stack">
      <Card>
        <div className="super-cost-head">
          <div>
            <h2>Operating costs</h2>
            <p className="muted">
              What PondBridge pays to run. Enter each service and what it bills; every cycle is normalized to a monthly
              run rate so the totals line up.
            </p>
          </div>
          {canEdit ? (
            <Button type="button" onClick={openCreate} disabled={loading}>
              Add a service
            </Button>
          ) : null}
        </div>

        {error ? <p className="error-text">{error}</p> : null}

        {loading ? (
          <p className="muted">Loading operating costs…</p>
        ) : (
          <>
            <div className="super-cost-stats">
              <StatBlock
                label="Monthly run rate"
                value={formatCents(summary?.monthlyCents, currency)}
                subtext={`${summary?.activeCount || 0} active service${summary?.activeCount === 1 ? "" : "s"}`}
              />
              <StatBlock
                label="Annual run rate"
                value={formatCents(summary?.annualCents, currency)}
                subtext="Recurring only"
              />
              <StatBlock
                label="One-time spend"
                value={formatCents(summary?.oneTimeCents, currency)}
                subtext="Not in the run rate"
              />
              <StatBlock
                label="Platform MRR"
                value={formatCents(revenue?.mrrCents, "USD")}
                subtext="From camp billing"
              />
              <StatBlock
                label="Net per month"
                value={revenue?.comparable ? formatCents(revenue.netMonthlyCents, "USD") : "—"}
                subtext={revenue?.comparable ? "MRR minus run rate" : "Costs are not all in USD"}
                tone={revenue?.comparable ? (revenue.netMonthlyCents >= 0 ? "positive" : "negative") : "neutral"}
              />
            </div>

            {summary?.currencies?.length > 1 ? (
              <p className="muted">
                Costs are recorded in more than one currency. Totals above cover {currency} only:{" "}
                {summary.currencies
                  .filter((entry) => entry.currency !== currency)
                  .map((entry) => `${formatCents(entry.monthlyCents, entry.currency)}/mo`)
                  .join(", ")}{" "}
                sits outside them.
              </p>
            ) : null}

            {summary?.byCategory?.length ? (
              <section className="super-cost-breakdown">
                <h3>Monthly run rate by category</h3>
                <ul>
                  {summary.byCategory.map((entry) => (
                    <li key={entry.category}>
                      <span className="super-cost-breakdown-label">{entry.label}</span>
                      <span className="super-cost-breakdown-bar" aria-hidden="true">
                        <i style={{ width: `${Math.round((entry.monthlyCents / maxCategoryMonthly) * 100)}%` }} />
                      </span>
                      <span className="super-cost-breakdown-value">{formatCents(entry.monthlyCents, currency)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <div className="super-filter-grid">
              <label>
                Status
                <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                  <option value="">All</option>
                  {options.statuses.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </label>
              <label>
                Category
                <Select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
                  <option value="">All</option>
                  {options.categories.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </label>
            </div>

            <div className="super-table-wrap">
              <table className="super-data-table">
                <thead>
                  <tr>
                    <th>Service</th>
                    <th>Category</th>
                    <th>Amount</th>
                    <th>Cycle</th>
                    <th>Per month</th>
                    <th>Renews</th>
                    <th>Status</th>
                    {canEdit ? <th>Actions</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {visibleCosts.map((cost) => (
                    <tr key={cost.id}>
                      <td>
                        <strong>{cost.name}</strong>
                        {cost.vendor ? <small className="super-cost-vendor">{cost.vendor}</small> : null}
                        {cost.notes ? <small className="super-cost-note">{cost.notes}</small> : null}
                      </td>
                      <td>{labelFor(options.categories, cost.category)}</td>
                      <td>{formatCents(cost.amountCents, cost.currency)}</td>
                      <td>{labelFor(options.billingCycles, cost.billingCycle)}</td>
                      <td>
                        {cost.billingCycle === "one_time"
                          ? "—"
                          : formatCents(cost.monthlyRunRateCents, cost.currency)}
                      </td>
                      <td>{formatDate(cost.renewsOn)}</td>
                      <td>
                        <Badge tone={statusTone(cost.status)}>{labelFor(options.statuses, cost.status)}</Badge>
                      </td>
                      {canEdit ? (
                        <td>
                          <div className="super-inline-row">
                            <Button type="button" variant="secondary" onClick={() => openEdit(cost)}>
                              Edit
                            </Button>
                            <Button type="button" variant="secondary" onClick={() => setPendingDelete(cost)}>
                              Remove
                            </Button>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                  {!visibleCosts.length ? (
                    <tr>
                      <td colSpan={canEdit ? 8 : 7} className="muted">
                        {payload?.items?.length
                          ? "No services match these filters."
                          : "No services recorded yet. Add your first one to start tracking the run rate."}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      <ModalDialog
        open={Boolean(editing)}
        title={editing?.id ? "Edit service cost" : "Add a service cost"}
        description="Enter what the vendor actually charges and how often. The monthly run rate is derived from it."
        onClose={() => (saving ? null : setEditing(null))}
        className="super-cost-modal"
      >
        <form className="super-cost-form" onSubmit={handleSubmit}>
          {formError ? <p className="error-text">{formError}</p> : null}

          <label>
            Service name
            <Input
              value={form.name}
              onChange={(event) => updateField("name", event.target.value)}
              placeholder="Supabase Pro"
              required
            />
          </label>

          <label>
            Vendor
            <Input
              value={form.vendor}
              onChange={(event) => updateField("vendor", event.target.value)}
              placeholder="Supabase"
            />
          </label>

          <div className="super-cost-form-row">
            <label>
              Amount
              <Input
                value={form.amount}
                onChange={(event) => updateField("amount", event.target.value)}
                placeholder="25.00"
                inputMode="decimal"
                required
              />
            </label>
            <label>
              Currency
              <Input
                value={form.currency}
                onChange={(event) => updateField("currency", event.target.value.toUpperCase())}
                maxLength={3}
              />
            </label>
            <label>
              Billing cycle
              <Select value={form.billingCycle} onChange={(event) => updateField("billingCycle", event.target.value)}>
                {options.billingCycles.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </label>
          </div>

          <div className="super-cost-form-row">
            <label>
              Category
              <Select value={form.category} onChange={(event) => updateField("category", event.target.value)}>
                {options.categories.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </label>
            <label>
              Status
              <Select value={form.status} onChange={(event) => updateField("status", event.target.value)}>
                {options.statuses.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </label>
          </div>

          <div className="super-cost-form-row">
            <label>
              Started on
              <Input type="date" value={form.startedOn} onChange={(event) => updateField("startedOn", event.target.value)} />
            </label>
            <label>
              Next renewal
              <Input type="date" value={form.renewsOn} onChange={(event) => updateField("renewsOn", event.target.value)} />
            </label>
          </div>

          <label>
            Billing page
            <Input
              value={form.url}
              onChange={(event) => updateField("url", event.target.value)}
              placeholder="supabase.com/dashboard/org/billing"
            />
          </label>

          <label>
            Notes
            <Textarea
              value={form.notes}
              onChange={(event) => updateField("notes", event.target.value)}
              rows={3}
              placeholder="What this covers, plan tier, who owns the account."
            />
          </label>

          <div className="pb-admin-ui-modal-actions">
            <Button type="button" variant="secondary" onClick={() => setEditing(null)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : editing?.id ? "Save changes" : "Add service"}
            </Button>
          </div>
        </form>
      </ModalDialog>

      <ModalConfirm
        open={Boolean(pendingDelete)}
        title="Remove this cost?"
        description={
          pendingDelete
            ? `"${pendingDelete.name}" will be deleted from operating costs. To keep the record but stop counting it, set its status to Canceled instead.`
            : ""
        }
        confirmLabel="Remove"
        busy={deleting}
        onConfirm={handleDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
