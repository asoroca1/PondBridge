import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, Image, Send, Sparkles } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { useTenant } from "../context/TenantContext.jsx";
import { requestJson } from "../lib/http.js";
import { resolveCampName } from "../lib/campLabels.js";
import { tenantRoute } from "../lib/tenantRouting.js";
import "./giving-detail.css";

const STEPS = ["Basics", "Story", "Goal & timeline", "Review"];
const CATEGORIES = [
  ["camperships", "Camperships"], ["facilities", "Facilities"], ["traditions", "Traditions"],
  ["programs", "Programs"], ["memorial", "Memorial"], ["other", "Other"]
];
const INITIAL = { title: "", shortDescription: "", description: "", whyItMatters: "", category: "", coverImageUrl: "", goalDollars: "5000", startDate: "", endDate: "", creatorAffiliation: "" };

export default function GivingCreateCausePage() {
  const { token, user } = useAuth();
  const { slug, tenant } = useTenant();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editId = searchParams.get("edit") || "";
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(INITIAL);
  const [loading, setLoading] = useState(Boolean(editId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const campName = resolveCampName(tenant) || "your camp";
  const director = Boolean(user?.roles?.includes("tenant_admin"));

  useEffect(() => {
    if (!editId) return;
    requestJson(`/api/t/${slug}/giving/${editId}`, { token })
      .then(({ item }) => setForm({
        title: item.title || "", shortDescription: item.shortDescription || "", description: item.description || "",
        whyItMatters: item.whyItMatters || "", category: item.category || "", coverImageUrl: item.coverImageUrl || "",
        goalDollars: String((Number(item.goalAmountCents) || 0) / 100), startDate: item.startDate || "", endDate: item.endDate || "",
        creatorAffiliation: item.creatorAffiliation || ""
      }))
      .catch((requestError) => setError(requestError.message || "Could not load your proposal."))
      .finally(() => setLoading(false));
  }, [editId, slug, token]);

  const valid = useMemo(() => {
    if (step === 0) return form.title.trim() && form.shortDescription.trim() && form.category;
    if (step === 1) return form.description.trim().length >= 30;
    if (step === 2) return Number(form.goalDollars) >= 1 && (!form.startDate || !form.endDate || form.endDate >= form.startDate);
    return true;
  }, [form, step]);

  function update(key, value) { setForm((current) => ({ ...current, [key]: value })); setError(""); }
  function next() { if (valid) setStep((current) => Math.min(STEPS.length - 1, current + 1)); else setError("Complete the required fields before continuing."); }

  async function submit() {
    setSaving(true); setError("");
    try {
      const body = {
        title: form.title, shortDescription: form.shortDescription, description: form.description,
        whyItMatters: form.whyItMatters, category: form.category, coverImageUrl: form.coverImageUrl,
        goalAmountCents: Math.round(Number(form.goalDollars) * 100), startDate: form.startDate || null,
        endDate: form.endDate || null, creatorAffiliation: form.creatorAffiliation
      };
      const response = await requestJson(`/api/t/${slug}/giving${editId ? `/${editId}` : "/causes"}`, {
        token, method: editId ? "PATCH" : "POST", body
      });
      navigate(tenantRoute(slug, `/giving/${response.item.id}`), { replace: true, state: { notice: response.message } });
    } catch (requestError) {
      setError(requestError.message || "Could not submit this cause.");
    } finally { setSaving(false); }
  }

  if (loading) return <div className="giving-detail-state">Loading your proposal…</div>;

  return (
    <div className="giving-create-page nav2-page-shell">
      <Link className="giving-detail-back" to={tenantRoute(slug, "/giving")}><ArrowLeft /> Back to giving</Link>
      <header className="giving-create-header"><p className="giving-detail-eyebrow">{director ? "Official camp giving" : "Alumni-led giving"}</p><h1>{editId ? "Revise your cause" : "Create a cause"}</h1><p>Turn an idea for {campName} into a clear, fundable story. {director ? "Official causes publish as soon as you submit them." : "Directors review every alumni proposal before it goes live."}</p></header>
      <ol className="giving-stepper">{STEPS.map((label, index) => <li key={label} className={index === step ? "is-current" : index < step ? "is-complete" : ""}><span>{index < step ? <Check /> : index + 1}</span><b>{label}</b></li>)}</ol>

      <main className="giving-create-card">
        {step === 0 ? <section><p className="giving-detail-eyebrow">Step 1</p><h2>Start with the idea</h2><div className="giving-create-grid"><label className="giving-form-field is-wide"><span>Cause name</span><input maxLength="120" value={form.title} onChange={(e) => update("title", e.target.value)} placeholder="Restore the Council Ring" /></label><label className="giving-form-field is-wide"><span>Short description</span><textarea rows="3" maxLength="220" value={form.shortDescription} onChange={(e) => update("shortDescription", e.target.value)} placeholder="In a sentence or two, what will alumni help make possible?" /></label><label className="giving-form-field"><span>Category</span><select value={form.category} onChange={(e) => update("category", e.target.value)}><option value="">Choose one</option>{CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="giving-form-field"><span>Your camp affiliation <small>Optional</small></span><input maxLength="80" value={form.creatorAffiliation} onChange={(e) => update("creatorAffiliation", e.target.value)} placeholder="Camper ’04, counselor ’10" /></label></div></section> : null}
        {step === 1 ? <section><p className="giving-detail-eyebrow">Step 2</p><h2>Tell the story</h2><label className="giving-form-field"><span>What will this cause accomplish?</span><textarea rows="8" maxLength="6000" value={form.description} onChange={(e) => update("description", e.target.value)} placeholder="Give alumni the context, plan, and intended outcome…" /></label><label className="giving-form-field"><span>Why does it matter? <small>Optional</small></span><textarea rows="5" maxLength="4000" value={form.whyItMatters} onChange={(e) => update("whyItMatters", e.target.value)} placeholder="Connect this project to the experience and community…" /></label><label className="giving-form-field"><span><Image /> Cover image URL <small>Optional</small></span><input type="url" value={form.coverImageUrl} onChange={(e) => update("coverImageUrl", e.target.value)} placeholder="https://…" /></label></section> : null}
        {step === 2 ? <section><p className="giving-detail-eyebrow">Step 3</p><h2>Set a clear target</h2><div className="giving-create-grid"><label className="giving-form-field is-wide"><span>Fundraising goal</span><div className="giving-amount-input"><b>$</b><input inputMode="numeric" value={form.goalDollars} onChange={(e) => update("goalDollars", e.target.value)} /></div></label><label className="giving-form-field"><span>Start date <small>Optional</small></span><input type="date" value={form.startDate} onChange={(e) => update("startDate", e.target.value)} /></label><label className="giving-form-field"><span>End date <small>Optional</small></span><input type="date" value={form.endDate} onChange={(e) => update("endDate", e.target.value)} /></label></div><div className="giving-create-tip"><Sparkles /><div><strong>What happens after you submit?</strong><p>{director ? "The cause publishes immediately with an official camp label. You can connect its donation designation from the director Giving workspace." : "Camp directors can approve the cause, request an edit, or decline it. Approved causes appear in the Giving marketplace with an alumni-led label."}</p></div></div></section> : null}
        {step === 3 ? <section><p className="giving-detail-eyebrow">Final step</p><h2>Review your proposal</h2><div className="giving-review"><span>{CATEGORIES.find(([value]) => value === form.category)?.[1]}</span><h3>{form.title}</h3><p>{form.shortDescription}</p><dl><div><dt>Goal</dt><dd>${Number(form.goalDollars || 0).toLocaleString()}</dd></div><div><dt>Timeline</dt><dd>{form.startDate || "When approved"} — {form.endDate || "Ongoing"}</dd></div></dl><blockquote>{form.description}</blockquote>{form.whyItMatters ? <div className="giving-review-why"><strong>Why it matters</strong><p>{form.whyItMatters}</p></div> : null}</div></section> : null}
        {error ? <p className="giving-inline-error" role="alert">{error}</p> : null}
        <footer className="giving-create-actions"><button type="button" className="is-secondary" onClick={() => step ? setStep(step - 1) : navigate(tenantRoute(slug, "/giving"))}>{step ? "Back" : "Cancel"}</button>{step < STEPS.length - 1 ? <button type="button" onClick={next}>Continue <ArrowRight /></button> : <button type="button" onClick={submit} disabled={saving}><Send /> {saving ? "Submitting…" : editId ? "Resubmit cause" : director ? "Publish official cause" : "Submit for review"}</button>}</footer>
      </main>
    </div>
  );
}
