import { useMemo, useRef, useState } from "react";
import { Button, Input, Textarea } from "@pondbridge/ui";
import { Send, Upload, UserPlus } from "lucide-react";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Accepts pasted rows or a CSV and turns them into recipients. Both paths land
 * in the same shape, so an uploaded file gets the same server-side review as a
 * hand-typed list rather than a separate untested code path.
 */
export function parsePeopleRows(value = "") {
  const people = [];
  const invalid = [];
  const seen = new Set();

  String(value || "")
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line, index) => {
      const parts = line.split(/[,\t]/).map((item) => item.trim()).filter(Boolean);
      // Skip a header row rather than reporting it as broken input.
      if (index === 0 && /^(first\s*name|firstname)$/i.test(parts[0] || "")) return;
      const emailIndex = parts.findIndex((item) => EMAIL_REGEX.test(item.toLowerCase()));
      if (emailIndex < 0) {
        invalid.push({ line: index + 1, value: line });
        return;
      }
      const email = parts[emailIndex].toLowerCase();
      if (seen.has(email)) return;
      seen.add(email);
      people.push({
        firstName: emailIndex >= 1 ? parts[0] : "",
        lastName: emailIndex >= 2 ? parts[1] : "",
        email
      });
    });

  return { people, invalid };
}

function parseLabels(value = "") {
  return [...new Set(String(value || "").split(/[,\n]+/g).map((item) => item.trim()).filter(Boolean))];
}

export default function PeopleAddView({ actions, storage, onInvite, onDone }) {
  const [rows, setRows] = useState("");
  const [tags, setTags] = useState("");
  const [campYears, setCampYears] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const fileRef = useRef(null);

  const parsed = useMemo(() => parsePeopleRows(rows), [rows]);
  const canSubmit = parsed.people.length > 0;
  const storageReady = storage?.available !== false;

  function readCsv(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      setRows((current) => (current.trim() ? `${current.trim()}\n${text}` : text));
      setStatus(`Loaded ${file.name}.`);
      setError("");
    };
    reader.onerror = () => setError("That file could not be read.");
    reader.readAsText(file);
    event.target.value = "";
  }

  async function saveProspects() {
    if (!canSubmit) {
      setError("Add at least one row with a valid email address.");
      return;
    }
    const result = await actions.addProspects(parsed.people.map((person) => ({
      ...person,
      tags: parseLabels(tags),
      campYears: parseLabels(campYears),
      notes,
      source: "director_entry"
    })));
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setRows("");
    setTags("");
    setCampYears("");
    setNotes("");
    setError("");
    setStatus(result.message);
    onDone?.();
  }

  return (
    <div className="pb-people-panel">
      <header className="pb-people-panel-head">
        <div>
          <h2>Add people</h2>
          <p>
            Paste a list or drop in a CSV, then either save them as prospects or send invitations.
            Saving never emails anyone.
          </p>
        </div>
      </header>

      <div className="pb-people-add-grid">
        <label className="pb-people-add-rows">
          <span>One person per line — name and email, or just an email</span>
          <Textarea
            value={rows}
            rows={10}
            onChange={(event) => setRows(event.target.value)}
            placeholder={"Ada, Lovelace, ada@example.org\nsomeone@example.org"}
          />
          <small className={parsed.invalid.length ? "error-text" : "muted"}>
            {parsed.people.length} valid email{parsed.people.length === 1 ? "" : "s"}
            {parsed.invalid.length ? ` · ${parsed.invalid.length} row${parsed.invalid.length === 1 ? "" : "s"} without a usable email` : ""}
          </small>
        </label>

        <div className="pb-people-add-side">
          <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()}>
            <Upload aria-hidden="true" />
            Upload CSV
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv,text/plain"
            onChange={readCsv}
            hidden
          />
          <label>
            <span>Tags</span>
            <Input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="Reunion, donor" />
          </label>
          <label>
            <span>Camp years</span>
            <Input value={campYears} onChange={(event) => setCampYears(event.target.value)} placeholder="2008, 2009" />
          </label>
          <label>
            <span>Notes</span>
            <Input value={notes} maxLength={800} onChange={(event) => setNotes(event.target.value)} placeholder="How the camp knows them" />
          </label>
          <small className="muted">Tags, years, and notes apply to everyone saved in this batch.</small>
        </div>
      </div>

      {!storageReady ? (
        <p className="pb-people-warning">
          Pre-member storage is not set up yet, so new prospects cannot be saved. Invitations still work.
        </p>
      ) : null}
      {error ? <p className="error-text" role="alert">{error}</p> : null}
      {status ? <p className="success-text" role="status">{status}</p> : null}

      <div className="pb-people-add-actions">
        <Button
          type="button"
          variant="secondary"
          onClick={saveProspects}
          loading={actions.busy === "prospects"}
          disabled={!canSubmit || !storageReady}
        >
          <UserPlus aria-hidden="true" />
          Save as prospects
        </Button>
        <Button
          type="button"
          onClick={() => onInvite(parsed.people.map((person) => ({ ...person, stage: "prospect" })))}
          disabled={!canSubmit}
        >
          <Send aria-hidden="true" />
          Review and invite {parsed.people.length || ""}
        </Button>
      </div>
    </div>
  );
}
