import { useMemo, useRef, useState } from "react";
import { parse } from "csv-parse/browser/esm/sync";
import { Button, Input } from "@pondbridge/ui";
import { Mail, Plus, Send, Trash2, Upload, UserPlus } from "lucide-react";
import InviteMessageDialog, { readInviteMessage } from "./InviteMessageDialog.jsx";
import QuestionnaireImportWizard from "./QuestionnaireImportWizard.jsx";
import { nextGridCell } from "../../../lib/gridNavigation.js";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_VISIBLE_ROWS = 5;
const COLUMNS = ["firstName", "lastName", "email"];

function emptyRow() {
  return { firstName: "", lastName: "", email: "" };
}

function padRows(rows = []) {
  const next = [...rows];
  while (next.length < MIN_VISIBLE_ROWS) next.push(emptyRow());
  return next;
}

function isBlankRow(row = {}) {
  return !String(row.firstName || "").trim() &&
    !String(row.lastName || "").trim() &&
    !String(row.email || "").trim();
}

/**
 * Turns pasted or uploaded text into grid rows. CSV and hand entry land in the
 * same shape so an uploaded file gets the same validation and the same
 * server-side review as anything typed by hand.
 */
export function parsePeopleRows(value = "") {
  const records = parse(String(value || ""), {
    bom: true,
    delimiter: [",", "\t"],
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true
  }).filter((record) => record.some((cell) => cell.trim()));
  if (!records.length) return [];

  const aliases = { firstname: "firstName", lastname: "lastName", email: "email", emailaddress: "email" };
  const header = records[0].map((cell) => aliases[cell.toLowerCase().replace(/[\s_-]/g, "")]);
  const hasHeader = header.includes("email");
  if (hasHeader) records.shift();

  // Keep blanks, invalid addresses, and duplicates visible for row validation.
  // Dropping them here loses both the original data and the director's chance
  // to correct it before saving or inviting.
  return records.map((cells) => {
    if (hasHeader) {
      const read = (field) => (cells[header.indexOf(field)] || "").trim();
      return { firstName: read("firstName"), lastName: read("lastName"), email: read("email").toLowerCase() };
    }
    let emailIndex = cells.findIndex((cell) => EMAIL_REGEX.test(cell));
    if (emailIndex < 0) emailIndex = cells.findIndex((cell) => cell.includes("@"));
    if (emailIndex < 0) emailIndex = cells.length === 1 ? 0 : 2;
    const names = cells.filter((_cell, index) => index !== emailIndex);
    return {
      firstName: (names[0] || "").trim(),
      lastName: (names[1] || "").trim(),
      email: (cells[emailIndex] || "").trim().toLowerCase()
    };
  });
}

/**
 * Only the email is required; names are optional so a plain list of addresses
 * still imports. Problems are reported per row rather than as one message for
 * the whole batch.
 */
export function validateRows(rows = []) {
  // Problems are keyed by the row's own index so the grid can look each one up
  // directly rather than searching a filtered copy.
  const problems = new Map();
  const seen = new Map();
  const ready = [];

  rows.forEach((row, index) => {
    if (isBlankRow(row)) return;

    const email = String(row.email || "").trim().toLowerCase();
    if (!email) {
      problems.set(index, "Add an email address.");
      return;
    }
    if (!EMAIL_REGEX.test(email)) {
      problems.set(index, "That email address is not valid.");
      return;
    }
    if (seen.has(email)) {
      problems.set(index, "Duplicate of an earlier row.");
      return;
    }

    seen.set(email, index);
    ready.push({
      firstName: String(row.firstName || "").trim(),
      lastName: String(row.lastName || "").trim(),
      email
    });
  });

  return { ready, problems };
}

export default function PeopleAddView({ actions, storage, request, download, slug = "", networkName = "", onDone }) {
  // Two ways in, because from a director's side they answer the same question:
  // I have a list of people, get them into the site. They differ only in how
  // much each one carries.
  const [mode, setMode] = useState("list");
  const [rows, setRows] = useState(() => padRows([]));
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [messageOpen, setMessageOpen] = useState(false);
  const [inviteMessage, setInviteMessage] = useState(() => readInviteMessage(slug));
  const fileRef = useRef(null);
  const sheetRef = useRef(null);

  const { ready, problems } = useMemo(() => validateRows(rows), [rows]);
  const canSubmit = ready.length > 0 && problems.size === 0;
  // Saving prospects wants a clean sheet, but a bad row should not block
  // inviting the good ones -- the skipped rows are reported instead.
  const canInvite = ready.length > 0;
  const storageReady = storage?.available !== false;
  const hasCustomMessage = Boolean(inviteMessage.subject || inviteMessage.message);

  function updateCell(index, field, value) {
    setRows((current) => {
      const next = current.map((row, position) => (
        position === index ? { ...row, [field]: value } : row
      ));
      // Keep a spare row at the bottom so typing never runs out of space.
      if (index === next.length - 1 && !isBlankRow(next[index])) next.push(emptyRow());
      return next;
    });
    setError("");
  }

  /**
   * Moves focus between cells the way a spreadsheet does. The arithmetic lives
   * in nextGridCell; this only reads the caret and moves the focus.
   */
  function onCellKeyDown(event, index, field) {
    const { key, currentTarget: input } = event;
    if (event.altKey || event.ctrlKey || event.metaKey) return;

    const target = nextGridCell({
      key,
      row: index,
      column: COLUMNS.indexOf(field),
      rowCount: rows.length,
      columnCount: COLUMNS.length,
      atStart: input.selectionStart === 0 && input.selectionEnd === 0,
      atEnd:
        input.selectionStart === input.value.length &&
        input.selectionEnd === input.value.length
    });
    if (!target) return;

    const cell = sheetRef.current?.querySelector(
      `[data-cell="${target.row}-${COLUMNS[target.column]}"]`
    );
    if (!cell) return;

    event.preventDefault();
    cell.focus();
    // Arriving from the left means the caret was travelling rightward, so it
    // belongs at the start. Everywhere else it belongs at the end, ready to
    // keep typing rather than sitting in front of what is already there.
    const caret = key === "ArrowRight" ? 0 : cell.value.length;
    cell.setSelectionRange(caret, caret);
  }

  function removeRow(index) {
    setRows((current) => padRows(current.filter((_row, position) => position !== index)));
  }

  function readCsv(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let imported;
      try {
        imported = parsePeopleRows(String(reader.result || ""));
      } catch {
        setStatus("");
        setError("That file could not be parsed. Check its CSV formatting and try again.");
        return;
      }
      if (!imported.length) {
        setError("That file did not contain any rows.");
        return;
      }
      setRows((current) => padRows([...current.filter((row) => !isBlankRow(row)), ...imported]));
      setStatus(`Loaded ${imported.length} row${imported.length === 1 ? "" : "s"} from ${file.name}.`);
      setError("");
    };
    reader.onerror = () => setError("That file could not be read.");
    reader.readAsText(file);
    event.target.value = "";
  }

  function onPasteGrid(event, index) {
    const text = event.clipboardData?.getData("text") || "";
    if (!text.includes("\n") && !text.includes("\t")) return;
    event.preventDefault();
    let imported;
    try {
      imported = parsePeopleRows(text);
    } catch {
      setStatus("");
      setError("That text could not be parsed. Check its formatting and try again.");
      return;
    }
    if (!imported.length) return;
    setRows((current) => {
      return padRows([...current.slice(0, index), ...imported, ...current.slice(index + 1)]);
    });
    setStatus(`Pasted ${imported.length} row${imported.length === 1 ? "" : "s"}.`);
  }

  async function saveProspects() {
    if (!canSubmit) {
      setError("Add a valid email address on every row.");
      return;
    }
    const result = await actions.addProspects(ready.map((person) => ({
      ...person,
      source: "director_entry"
    })));
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setRows(padRows([]));
    setError("");
    setStatus(result.message);
    onDone?.();
  }

  async function startInvite() {
    if (!canInvite) {
      setError("Add at least one valid email address.");
      return;
    }
    setError("");
    setStatus("");
    const result = await actions.sendInvitesNow(
      ready.map((person) => ({ ...person, stage: "prospect" })),
      { customSubject: inviteMessage.subject, customMessage: inviteMessage.message }
    );
    if (!result.ok) {
      setError(result.message);
      return;
    }
    const skippedRows = problems.size
      ? ` ${problems.size} row${problems.size === 1 ? "" : "s"} skipped for a bad email address.`
      : "";
    setRows(padRows([]));
    setStatus(`${result.message}${skippedRows}`);
    onDone?.();
  }

  const modeSwitch = (
    <div className="pb-people-add-modes" role="tablist" aria-label="How to add people">
      <button
        type="button"
        role="tab"
        aria-selected={mode === "list"}
        className={mode === "list" ? "is-active" : ""}
        onClick={() => setMode("list")}
      >
        Names and emails
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === "import"}
        className={mode === "import" ? "is-active" : ""}
        onClick={() => setMode("import")}
      >
        Import a questionnaire
      </button>
    </div>
  );

  if (mode === "import") {
    return (
      <>
        {modeSwitch}
        <QuestionnaireImportWizard request={request} download={download} slug={slug} onDone={onDone} />
      </>
    );
  }

  return (
    <div className="pb-people-panel">
      {modeSwitch}
      <header className="pb-people-panel-head pb-people-add-head">
        <div>
          <h2>Add people</h2>
          <p>
            Fill in the sheet or upload a CSV, then either save them as prospects or send
            invitations. Only the email address is required. Saving never emails anyone.
          </p>
        </div>
        <div className="pb-people-add-head-actions">
          <Button type="button" variant="secondary" onClick={() => setMessageOpen(true)}>
            <Mail aria-hidden="true" />
            {hasCustomMessage ? "Edit invite email" : "Write invite email"}
          </Button>
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
        </div>
      </header>

      <div className="pb-people-sheet" role="group" aria-label="People to add" ref={sheetRef}>
        <div className="pb-people-sheet-row pb-people-sheet-header" aria-hidden="true">
          <span>First name</span>
          <span>Last name</span>
          <span>Email <em>required</em></span>
          <span />
        </div>
        {rows.map((row, index) => {
          const problem = problems.get(index);
          return (
            <div
              className={`pb-people-sheet-row${problem ? " has-error" : ""}`}
              key={`row-${index}`}
            >
              <Input
                value={row.firstName}
                data-cell={`${index}-firstName`}
                aria-label={`First name, row ${index + 1}`}
                onChange={(event) => updateCell(index, "firstName", event.target.value)}
                onKeyDown={(event) => onCellKeyDown(event, index, "firstName")}
                onPaste={(event) => onPasteGrid(event, index)}
              />
              <Input
                value={row.lastName}
                data-cell={`${index}-lastName`}
                aria-label={`Last name, row ${index + 1}`}
                onChange={(event) => updateCell(index, "lastName", event.target.value)}
                onKeyDown={(event) => onCellKeyDown(event, index, "lastName")}
                onPaste={(event) => onPasteGrid(event, index)}
              />
              <Input
                value={row.email}
                // A text input, not type="email": email inputs report no caret
                // position and throw on setSelectionRange, so arrow keys could
                // not tell where the caret sat. Addresses are validated per row
                // either way, and inputMode still asks for the email keyboard.
                inputMode="email"
                autoComplete="off"
                data-cell={`${index}-email`}
                aria-label={`Email, row ${index + 1}`}
                aria-invalid={problem ? "true" : undefined}
                onChange={(event) => updateCell(index, "email", event.target.value)}
                onKeyDown={(event) => onCellKeyDown(event, index, "email")}
                onPaste={(event) => onPasteGrid(event, index)}
              />
              <button
                type="button"
                className="pb-people-sheet-remove"
                aria-label={`Remove row ${index + 1}`}
                onClick={() => removeRow(index)}
                disabled={isBlankRow(row)}
              >
                <Trash2 aria-hidden="true" />
              </button>
              {problem ? <p className="pb-people-sheet-error">{problem}</p> : null}
            </div>
          );
        })}
      </div>

      <div className="pb-people-sheet-foot">
        <Button type="button" variant="ghost" onClick={() => setRows((current) => [...current, emptyRow()])}>
          <Plus aria-hidden="true" />
          Add row
        </Button>
        <small className={problems.size ? "error-text" : "muted"}>
          {ready.length} ready
          {problems.size
            ? ` · ${problems.size} ${problems.size === 1 ? "row needs" : "rows need"} attention`
            : ""}
        </small>
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
          onClick={startInvite}
          loading={actions.busy === "invite"}
          disabled={!canInvite}
        >
          <Send aria-hidden="true" />
          Send {ready.length || ""} invitation{ready.length === 1 ? "" : "s"}
        </Button>
      </div>

      <InviteMessageDialog
        open={messageOpen}
        slug={slug}
        networkName={networkName}
        onClose={() => setMessageOpen(false)}
        onSaved={setInviteMessage}
      />
    </div>
  );
}
