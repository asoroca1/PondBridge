import { useEffect, useMemo, useState } from "react";
import { Button, Select } from "@pondbridge/ui";

const STARTERS = [
  "Share an important camp community announcement",
  "Invite alumni to an upcoming event",
  "Encourage members to complete their profiles"
];

function money(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return "$0.00";
  if (amount > 0 && amount < 0.01) return "< $0.01";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

export default function DirectorEmailAgentPanel({
  request,
  form,
  targeting,
  recipientPreview,
  onApplyDraft
}) {
  const [capabilities, setCapabilities] = useState(null);
  const [brief, setBrief] = useState("");
  const [goal, setGoal] = useState("announcement");
  const [tone, setTone] = useState("warm");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    let active = true;
    request("/email-agent/capabilities")
      .then((payload) => {
        if (active) setCapabilities(payload);
      })
      .catch(() => {
        if (active) setCapabilities({ available: false, featureEnabled: false });
      });
    return () => { active = false; };
  }, [request]);

  const hasDraft = Boolean(String(form?.subject || "").trim() || String(form?.body || "").trim());
  const usageLabel = useMemo(() => {
    const usage = capabilities?.usage;
    if (!usage) return "Usage ledger unavailable";
    return `${money(usage.estimatedCostUsd)} of ${money(usage.budgetUsd)} used this month`;
  }, [capabilities]);

  async function generateDraft() {
    if (!brief.trim() && !hasDraft) {
      setError("Describe the email you want to create.");
      return;
    }
    setGenerating(true);
    setError("");
    setStatus("");
    try {
      const result = await request("/email-agent/draft", {
        method: "POST",
        body: {
          mode: hasDraft ? "revise" : "create",
          goal,
          tone,
          brief,
          currentSubject: form?.subject || "",
          currentPreheader: form?.preheader || "",
          currentBody: form?.body || "",
          audience: {
            mode: targeting?.mode || "all",
            label: targeting?.label || "",
            count: Number(recipientPreview?.count || 0),
            roles: targeting?.roles || [],
            years: targeting?.years || [],
            segment: targeting?.segment || ""
          }
        }
      });
      onApplyDraft?.({ ...result.draft, aiGenerationId: result.generationId });
      setStatus(`Editable draft inserted. Estimated AI cost: ${money(result?.usage?.estimatedCostUsd)}. Review every field before sending.`);
    } catch (requestError) {
      setError(requestError?.message || "The Communications Agent could not create a draft.");
    } finally {
      setGenerating(false);
    }
  }

  const available = Boolean(capabilities?.available);
  const loading = capabilities === null;

  return (
    <section className="director-email-agent" aria-labelledby="director-email-agent-title">
      <div className="director-email-agent-head">
        <div>
          <div className="director-email-agent-title-row">
            <span className="director-email-agent-mark" aria-hidden="true">AI</span>
            <h2 id="director-email-agent-title">Communications Agent</h2>
            <span className={`director-email-agent-badge ${available ? "is-ready" : ""}`}>
              {loading ? "Checking…" : available ? "Pilot ready" : capabilities?.featureEnabled ? "Setup needed" : "Controlled pilot"}
            </span>
          </div>
          <p>Describe the outcome. PondBridge creates an editable campaign draft; it can never send or schedule for you.</p>
        </div>
        <div className="director-email-agent-usage" title="Provider cost estimate, not the customer price">
          <span>AI usage</span>
          <strong>{loading ? "Loading…" : usageLabel}</strong>
        </div>
      </div>

      <div className="director-email-agent-grid">
        <label className="director-email-agent-brief">
          What should this email accomplish?
          <textarea
            className="pb-textarea"
            value={brief}
            onChange={(event) => {
              setBrief(event.target.value);
              setError("");
            }}
            maxLength={3000}
            rows={4}
            placeholder="Example: Invite alumni to the August reunion. Keep it warm, mention that families are welcome, and ask them to RSVP at https://…"
            disabled={!available || generating}
          />
        </label>
        <div className="director-email-agent-controls">
          <label>
            Goal
            <Select value={goal} onChange={(event) => setGoal(event.target.value)} disabled={!available || generating}>
              <option value="announcement">Announcement</option>
              <option value="event">Event invitation</option>
              <option value="engagement">Member engagement</option>
              <option value="fundraising">Fundraising</option>
              <option value="newsletter">Newsletter</option>
              <option value="general">General update</option>
            </Select>
          </label>
          <label>
            Tone
            <Select value={tone} onChange={(event) => setTone(event.target.value)} disabled={!available || generating}>
              <option value="warm">Warm</option>
              <option value="polished">Polished</option>
              <option value="concise">Concise</option>
              <option value="celebratory">Celebratory</option>
              <option value="urgent">Urgent</option>
            </Select>
          </label>
        </div>
      </div>

      <div className="director-email-agent-starters" aria-label="Campaign starters">
        {STARTERS.map((starter) => (
          <button key={starter} type="button" onClick={() => setBrief(starter)} disabled={!available || generating}>
            {starter}
          </button>
        ))}
      </div>

      {!loading && !available ? (
        <p className="director-email-agent-unavailable">
          {capabilities?.featureEnabled
            ? "The AI provider or durable usage ledger still needs staging setup. The standard editor and readiness checks remain available."
            : "This camp is outside the AI pilot cohort. PondBridge keeps the feature off until its rollout and budget are explicitly approved."}
        </p>
      ) : null}
      <div className="director-email-agent-actions">
        <Button type="button" onClick={generateDraft} disabled={!available || generating || (!brief.trim() && !hasDraft)}>
          {generating ? "Creating editable draft…" : hasDraft ? "Improve current draft" : "Generate editable draft"}
        </Button>
        <small>{capabilities?.dataUse || "AI draft data handling appears here when the pilot is configured."}</small>
      </div>
      {error ? <p className="error-text" role="alert">{error}</p> : null}
      {status ? <p className="success-text" role="status">{status}</p> : null}
    </section>
  );
}
