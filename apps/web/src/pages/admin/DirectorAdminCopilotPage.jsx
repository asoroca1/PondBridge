import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Card, Textarea } from "@pondbridge/ui";
import { LoadingSkeleton, PageHeader } from "../../components/admin/AdminUi.jsx";
import useAdminApi from "./useAdminApi.js";
import "./director-admin-copilot.css";

const STARTERS = [
  "What should I prioritize today?",
  "What is blocking this camp from launch?",
  "Explain how member approvals work.",
  "Draft a short welcome announcement for our community."
];

export default function DirectorAdminCopilotPage() {
  const { request } = useAdminApi();
  const answerRef = useRef(null);
  const [capability, setCapability] = useState(null);
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    request("/copilot/capabilities")
      .then((payload) => {
        if (active) setCapability(payload || null);
      })
      .catch((requestError) => {
        if (active) setError(requestError.message || "Director Copilot is unavailable.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [request]);

  async function askCopilot(event) {
    event?.preventDefault();
    if (!question.trim() || asking || !capability?.available) return;
    setAsking(true);
    setError("");
    try {
      const payload = await request("/copilot/ask", {
        method: "POST",
        body: { question }
      });
      setResult(payload || null);
      window.requestAnimationFrame(() => answerRef.current?.focus());
    } catch (requestError) {
      setError(requestError.message || "Director Copilot could not answer. No action was taken.");
    } finally {
      setAsking(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <PageHeader title="Director Copilot" subtitle="Loading the camp-scoped assistant..." />
        <LoadingSkeleton lines={5} />
      </Card>
    );
  }

  if (!capability?.available) {
    return (
      <Card>
        <PageHeader
          title="Director Copilot"
          subtitle="This read-only pilot is not enabled for this camp."
        />
        <div className="director-admin-info-banner">
          <p>
            The assistant stays hidden unless this camp is in an approved pilot cohort and the server-side
            provider is configured. Existing director tools continue to work normally.
          </p>
        </div>
        {error ? <p className="error-text" role="alert">{error}</p> : null}
        <Link to="../dashboard">Return to Overview</Link>
      </Card>
    );
  }

  return (
    <div className="director-admin-stack director-copilot-page">
      <Card>
        <PageHeader
          title="Director Copilot"
          subtitle="Ask about current priorities, launch readiness, admin screens, or request an editable draft."
          className="director-admin-page-head"
        />

        <div className="director-admin-info-banner director-copilot-boundary">
          <strong>Read-only pilot</strong>
          <p>
            Copilot can read aggregate camp status and draft text. It cannot send, approve, publish, change
            billing, update settings, close reports, or delete anything.
          </p>
          <p>
            Your request and the minimum aggregate camp context needed to answer it are processed by OpenAI.
            PondBridge stores audit hashes and usage metadata, not the raw conversation.
          </p>
        </div>

        <div className="director-copilot-starters" aria-label="Suggested questions">
          {STARTERS.map((starter) => (
            <Button
              key={starter}
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setQuestion(starter)}
              disabled={asking}
            >
              {starter}
            </Button>
          ))}
        </div>

        <form className="director-copilot-form" onSubmit={askCopilot}>
          <label htmlFor="director-copilot-question">What do you need help with?</label>
          <Textarea
            id="director-copilot-question"
            rows={6}
            maxLength={2000}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="For example: What should I handle before inviting our first members?"
            aria-describedby="director-copilot-privacy"
          />
          <div className="director-copilot-form-footer">
            <small id="director-copilot-privacy">
              Do not enter passwords, access codes, private contact details, or emergency information.
            </small>
            <Button type="submit" disabled={asking || !question.trim()}>
              {asking ? "Checking PondBridge..." : "Ask Copilot"}
            </Button>
          </div>
        </form>

        {error ? <p className="error-text" role="alert">{error}</p> : null}
      </Card>

      {result ? (
        <Card>
          <section
            ref={answerRef}
            tabIndex={-1}
            className="director-copilot-answer"
            aria-live="polite"
            aria-labelledby="director-copilot-answer-title"
          >
            <h2 id="director-copilot-answer-title">Copilot response</h2>
            <div className="director-copilot-answer-text">{result.answer}</div>
            {Array.isArray(result.links) && result.links.length ? (
              <div className="director-copilot-sources">
                <h3>Verify in PondBridge</h3>
                <ul>
                  {result.links.map((item) => (
                    <li key={item.href}><Link to={item.href}>{item.label}</Link></li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="muted director-copilot-disclaimer">{result.disclaimer}</p>
          </section>
        </Card>
      ) : null}
    </div>
  );
}
