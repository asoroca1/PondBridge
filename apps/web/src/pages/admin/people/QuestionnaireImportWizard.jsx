import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Select } from "@pondbridge/ui";
import { AlertTriangle, ArrowLeft, Check, FileSpreadsheet, Sparkles, Undo2, Upload } from "lucide-react";

/**
 * Turns a camp's questionnaire export into profiles waiting to be claimed.
 *
 * Four steps, and nothing is written until the last one. The director sees which
 * column became which field, then exactly what the import would do — creates,
 * updates, duplicates, failures, and every answer the cleaner rewrote — before
 * committing. A wrong guess costs a dropdown change, not a bad import.
 */

const STEPS = [
  { key: "upload", label: "Upload" },
  { key: "map", label: "Match columns" },
  { key: "preview", label: "Check" },
  { key: "done", label: "Done" }
];

const IGNORE = "__ignore__";

export function badgeFor(proposal) {
  if (!proposal.field) {
    if (proposal.source === "conflict") return { tone: "warn", label: "Duplicate field" };
    if (proposal.source === "ai_low_confidence") return { tone: "muted", label: "Not sure" };
    return { tone: "muted", label: "Not matched" };
  }
  if (proposal.source === "dictionary") return { tone: "ok", label: "Matched" };
  if (proposal.needsReview) return { tone: "warn", label: "Check this" };
  return { tone: "ai", label: "Suggested" };
}

/** Says why the AI tier did not run, in words a director can act on. */
export function aiNote(ai = {}) {
  if (ai.used) return "";
  switch (ai.reason) {
    case "not_configured":
    case "pricing_unavailable":
      return "Automatic matching is switched off for this camp, so anything not recognised is yours to set.";
    case "budget_reached":
      return "This camp has used its AI allowance for the month. Everything below still works, by hand.";
    case "unavailable":
      return "Automatic matching could not be reached just now. Set anything it missed yourself.";
    case "too_many_unreadable_cells":
      return ai.message || "";
    default:
      return "";
  }
}

export default function QuestionnaireImportWizard({ request, download, slug, onDone }) {
  const [step, setStep] = useState("upload");
  const [file, setFile] = useState(null);
  const [fields, setFields] = useState([]);
  const [fieldsError, setFieldsError] = useState("");
  const [fieldsAttempt, setFieldsAttempt] = useState(0);
  const [analysis, setAnalysis] = useState(null);
  const [choices, setChoices] = useState({});
  const [dryRun, setDryRun] = useState(null);
  const [rejectedRewrites, setRejectedRewrites] = useState(() => new Set());
  const [result, setResult] = useState(null);
  const [undone, setUndone] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setFieldsError("");
    request("/import/fields")
      .then((payload) => { if (active) setFields(payload?.fields || []); })
      .catch((err) => { if (active) setFieldsError(err?.message || "Import fields could not be loaded."); });
    return () => { active = false; };
  }, [request, fieldsAttempt]);

  const mapping = useMemo(() => {
    const next = {};
    for (const [column, field] of Object.entries(choices)) {
      if (field && field !== IGNORE) next[column] = field;
    }
    return next;
  }, [choices]);

  const duplicateMapping = Object.values(mapping).length !== new Set(Object.values(mapping)).size;

  const emailMapped = useMemo(() => Object.values(mapping).includes("email"), [mapping]);

  const formDataWith = useCallback((extras = {}) => {
    const form = new FormData();
    form.append("file", file);
    for (const [key, value] of Object.entries(extras)) {
      form.append(key, typeof value === "string" ? value : JSON.stringify(value));
    }
    return form;
  }, [file]);

  async function analyze(nextFile) {
    setBusy("analyze");
    setError("");
    try {
      const form = new FormData();
      form.append("file", nextFile);
      const payload = await request("/import/analyze", { method: "POST", body: form });
      setAnalysis(payload);
      setChoices(Object.fromEntries(
        (payload.proposals || []).map((proposal) => [proposal.column, proposal.field || IGNORE])
      ));
      setFile(nextFile);
      setStep("map");
    } catch (err) {
      setError(String(err?.message || "That file could not be read."));
    } finally {
      setBusy("");
    }
  }

  async function preview() {
    setBusy("preview");
    setError("");
    try {
      const payload = await request("/import/dry-run", {
        method: "POST",
        body: formDataWith({ mapping })
      });
      setDryRun(payload);
      setRejectedRewrites(new Set());
      setStep("preview");
    } catch (err) {
      setError(String(err?.message || "That import could not be checked."));
    } finally {
      setBusy("");
    }
  }

  async function commit() {
    setBusy("commit");
    setError("");
    try {
      const approved = (dryRun?.cleanup?.rewrites || [])
        .filter((rewrite, index) => !rejectedRewrites.has(index))
        .map(({ field, before, after }) => ({ field, before, after }));
      const payload = await request("/import/commit", {
        method: "POST",
        body: formDataWith({ mapping, approvedRewrites: approved })
      });
      setResult(payload);
      setStep("done");
    } catch (err) {
      setError(String(err?.message || "That import could not be completed."));
    } finally {
      setBusy("");
    }
  }

  /**
   * The moment a director realises the upload was wrong is right after seeing the
   * result, so the way out lives here rather than only in an import history.
   */
  async function undo() {
    setBusy("undo");
    setError("");
    try {
      const payload = await request(`/imports/${result.reportId}/undo`, { method: "POST", body: {} });
      setUndone(payload);
    } catch (err) {
      setError(String(err?.message || "That import could not be taken back."));
    } finally {
      setBusy("");
    }
  }

  async function downloadFailures() {
    setBusy("download");
    setError("");
    try {
      const blob = await download(`/imports/${result.reportId}/failures.csv`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${slug}-import-failures.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err?.message || "The skipped rows could not be downloaded. Try again.");
    } finally {
      setBusy("");
    }
  }

  function toggleRewrite(index) {
    setRejectedRewrites((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  const stepIndex = STEPS.findIndex((entry) => entry.key === step);

  return (
    <div className="pb-people-panel pb-qimport">
      <header className="pb-people-panel-head">
        <div>
          <h2>Import a questionnaire</h2>
          <p>
            Upload the answers your alumni sent back. Everyone gets a profile filled in and
            waiting, hidden from the rest of the camp until they sign in and confirm it is
            theirs. Nobody is emailed by this.
          </p>
        </div>
      </header>

      <ol className="pb-qimport-steps">
        {STEPS.map((entry, index) => (
          <li
            key={entry.key}
            className={index < stepIndex ? "is-done" : index === stepIndex ? "is-current" : ""}
          >
            <span className="pb-qimport-step-mark">{index < stepIndex ? <Check aria-hidden="true" /> : index + 1}</span>
            {entry.label}
          </li>
        ))}
      </ol>

      {fieldsError ? <div role="alert" className="pb-qimport-error">
        {fieldsError} <Button variant="ghost" onClick={() => setFieldsAttempt((value) => value + 1)}>Retry loading fields</Button>
      </div> : null}

      {error ? <p className="pb-qimport-error" role="alert">{error}</p> : null}

      {step === "upload" ? (
        <div className="pb-qimport-drop">
          <FileSpreadsheet aria-hidden="true" />
          <h3>Choose the questionnaire file</h3>
          <p>
            A CSV export from whatever you sent the questionnaire with. Any columns are fine —
            the next step is matching them up.
          </p>
          <label className="pb-qimport-file">
            <input
              type="file"
              aria-label="Questionnaire CSV file"
              disabled={Boolean(busy) || !fields.length || Boolean(fieldsError)}
              accept=".csv,text/csv,text/plain"
              onChange={(event) => {
                const chosen = event.target.files?.[0];
                event.target.value = "";
                if (chosen) analyze(chosen);
              }}
            />
            <span className="pb-qimport-file-button">
              <Upload aria-hidden="true" />
              {busy === "analyze" ? "Reading..." : "Choose a file"}
            </span>
          </label>
        </div>
      ) : null}

      {step === "map" && analysis ? (
        <>
          <div className="pb-qimport-summary">
            <strong>{analysis.fileName}</strong>
            <span>{analysis.rowCount} responses, {analysis.headers?.length} columns</span>
            {analysis.ai?.used ? (
              <span className="pb-qimport-ai"><Sparkles aria-hidden="true" /> Matched automatically</span>
            ) : null}
          </div>

          {aiNote(analysis.ai) ? <p className="pb-qimport-note">{aiNote(analysis.ai)}</p> : null}

          <div className="pb-qimport-table-wrap">
            <table className="pb-qimport-table">
              <thead>
                <tr>
                  <th>Column in your file</th>
                  <th>What people answered</th>
                  <th>Goes to</th>
                </tr>
              </thead>
              <tbody>
                {(analysis.proposals || []).map((proposal) => {
                  const badge = badgeFor(proposal);
                  const samples = analysis.samples?.[proposal.column] || [];
                  return (
                    <tr key={proposal.column}>
                      <td>
                        <span className="pb-qimport-col">{proposal.column}</span>
                        <span className={`pb-qimport-badge is-${badge.tone}`}>{badge.label}</span>
                        {proposal.reason ? <span className="pb-qimport-reason">{proposal.reason}</span> : null}
                      </td>
                      <td>
                        {samples.length
                          ? <ul className="pb-qimport-samples">{samples.slice(0, 3).map((value, index) => (
                            <li key={`${proposal.column}-${index}`}>{value}</li>
                          ))}</ul>
                          : <span className="pb-qimport-empty">Nobody answered this</span>}
                      </td>
                      <td>
                        <Select
                          disabled={Boolean(busy)}
                          value={choices[proposal.column] || IGNORE}
                          aria-label={`Field for ${proposal.column}`}
                          onChange={(event) => setChoices((current) => ({
                            ...current,
                            [proposal.column]: event.target.value
                          }))}
                        >
                          <option value={IGNORE}>Do not import</option>
                          {fields.map((field) => (
                            <option key={field.path} value={field.path}>{field.label}</option>
                          ))}
                        </Select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {duplicateMapping ? <p className="pb-qimport-note is-blocking" role="alert">
            Match each profile field to only one column. Set any extra column to Do not import.
          </p> : null}

          {!emailMapped ? (
            <p className="pb-qimport-note is-blocking">
              <AlertTriangle aria-hidden="true" />
              One column has to be the email address. It is how each person later signs in and
              claims their profile.
            </p>
          ) : null}

          <div className="pb-qimport-actions">
            <Button variant="secondary" disabled={Boolean(busy)} onClick={() => { setStep("upload"); setAnalysis(null); }}>
              <ArrowLeft aria-hidden="true" /> Choose another file
            </Button>
            <Button onClick={preview} disabled={!emailMapped || duplicateMapping || Boolean(busy)}>
              {busy === "preview" ? "Checking..." : "Check what this will do"}
            </Button>
          </div>
        </>
      ) : null}

      {step === "preview" && dryRun ? (
        <>
          <div className="pb-qimport-counts">
            <div><strong>{dryRun.createdCount}</strong><span>new profiles</span></div>
            <div><strong>{dryRun.updatedCount}</strong><span>existing people updated</span></div>
            <div><strong>{dryRun.skippedDuplicates}</strong><span>already on file</span></div>
            <div className={dryRun.errorCount ? "is-problem" : ""}>
              <strong>{dryRun.errorCount}</strong><span>rows we cannot use</span>
            </div>
          </div>

          {dryRun.errors?.length ? (
            <details className="pb-qimport-details" open>
              <summary>{dryRun.errors.length} rows will be skipped</summary>
              <ul className="pb-qimport-errors">
                {dryRun.errors.slice(0, 15).map((rowError) => (
                  <li key={rowError.rowNumber}>
                    <strong>Row {rowError.rowNumber}</strong> {rowError.message}
                  </li>
                ))}
              </ul>
              {dryRun.errors.length > 15 ? (
                <p className="pb-qimport-empty">
                  and {dryRun.errors.length - 15} more, all listed in the report afterwards.
                </p>
              ) : null}
            </details>
          ) : null}

          {dryRun.cleanup?.rewrites?.length ? (
            <details className="pb-qimport-details" open>
              <summary>
                {dryRun.cleanup.rewrites.length} answers tidied up so they could be stored
              </summary>
              <p className="pb-qimport-note">
                These were written in a way we could not file. Untick anything that looks wrong
                and it will be left blank instead.
              </p>
              <ul className="pb-qimport-rewrites">
                {dryRun.cleanup.rewrites.map((rewrite, index) => (
                  <li key={`${rewrite.field}-${index}`}>
                    <label>
                      <input
                        type="checkbox"
                        disabled={Boolean(busy)}
                        checked={!rejectedRewrites.has(index)}
                        onChange={() => toggleRewrite(index)}
                      />
                      <span className="pb-qimport-rewrite-body">
                        <span className="pb-qimport-was">{rewrite.before}</span>
                        <span aria-hidden="true">→</span>
                        <span className="pb-qimport-now">{rewrite.after}</span>
                        <span className="pb-qimport-empty">
                          {rewrite.column}
                          {rewrite.occurrences > 1 ? ` · ${rewrite.occurrences} people` : ""}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <div className="pb-qimport-actions">
            <Button variant="secondary" disabled={Boolean(busy)} onClick={() => setStep("map")}>
              <ArrowLeft aria-hidden="true" /> Change the matching
            </Button>
            <Button onClick={commit} disabled={Boolean(busy) || !dryRun.createdCount && !dryRun.updatedCount}>
              {busy === "commit"
                ? "Importing..."
                : `Import ${dryRun.createdCount} ${dryRun.createdCount === 1 ? "person" : "people"}`}
            </Button>
          </div>
        </>
      ) : null}

      {step === "done" && result && !undone ? (
        <div className="pb-qimport-done">
          <span className="pb-qimport-done-mark" aria-hidden="true"><Check /></span>
          <h3>
            {result.createdCount} {result.createdCount === 1 ? "profile is" : "profiles are"} ready
          </h3>
          <p>
            Nobody has been emailed. New profiles stay hidden until each person signs in and
            confirms the profile is theirs. Existing profiles keep their current visibility.
          </p>
          {result.updatedCount ? <p>{result.updatedCount} existing profiles updated.</p> : null}
          {result.errorCount ? (
            <p className="pb-qimport-note">
              {result.errorCount} rows could not be used.{" "}
              <Button variant="ghost" disabled={Boolean(busy)} onClick={downloadFailures}>
                {busy === "download" ? "Downloading..." : "Download the list"}
              </Button>
            </p>
          ) : null}
          <div className="pb-qimport-actions">
            <Button variant="ghost" disabled={Boolean(busy)} onClick={undo} loading={busy === "undo"}>
              <Undo2 aria-hidden="true" />
              Undo this import
            </Button>
            <Button disabled={Boolean(busy)} onClick={() => onDone?.()}>See them in People</Button>
          </div>
        </div>
      ) : null}

      {step === "done" && undone ? (
        <div className="pb-qimport-done">
          <span className="pb-qimport-done-mark" aria-hidden="true"><Undo2 /></span>
          <h3>
            {undone.removedCount} {undone.removedCount === 1 ? "profile" : "profiles"} removed
          </h3>
          {undone.failures?.length ? <div className="pb-qimport-error" role="alert">
            {undone.failures.length} profiles could not be removed. Try undoing this import again.
            <Button variant="ghost" disabled={Boolean(busy)} onClick={undo}>Retry undo</Button>
          </div> : null}
          <p>
            {undone.keptClaimedCount
              ? `${undone.keptClaimedCount} ${undone.keptClaimedCount === 1 ? "person has" : "people have"} already signed in and confirmed their profile, so those accounts are theirs now and were left alone.`
              : undone.failures?.length
                ? "Some profiles remain from this import."
                : "The unclaimed profiles created by this import were removed. Updates to existing profiles are kept."}
          </p>
          <div className="pb-qimport-actions">
            <Button onClick={() => { setStep("upload"); setAnalysis(null); setResult(null); setUndone(null); }}>
              Start again
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
