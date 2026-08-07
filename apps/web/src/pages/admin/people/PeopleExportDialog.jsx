import { useCallback, useEffect, useState } from "react";
import { Button, Input, Select } from "@pondbridge/ui";
import { ChevronDown, ChevronUp, Download } from "lucide-react";
import { ModalDialog } from "../../../components/admin/AdminUi.jsx";

const FALLBACK_FIELDS = [
  { key: "firstName", label: "First name" },
  { key: "lastName", label: "Last name" },
  { key: "email", label: "Email" },
  { key: "roleAtCamp", label: "Role at camp" },
  { key: "cityState", label: "Location" },
  { key: "completionScore", label: "Profile completion" }
];

function normalizeSelection(keys = [], allowed = [], fallback = []) {
  const allowedSet = new Set(allowed);
  const seen = new Set();
  const picked = (Array.isArray(keys) ? keys : [])
    .map((key) => String(key || "").trim())
    .filter((key) => key && allowedSet.has(key) && !seen.has(key) && seen.add(key) !== false);
  return picked.length ? picked : fallback.filter((key) => allowedSet.has(key));
}

/**
 * Field picking, ordering, and a live preview of the first rows — carried over
 * from the members table, with named presets now stored on the tenant so they
 * follow a director between devices instead of living in one browser.
 */
export default function PeopleExportDialog({ open, onClose, request, download, slug }) {
  const [catalog, setCatalog] = useState(FALLBACK_FIELDS);
  const [defaults, setDefaults] = useState(FALLBACK_FIELDS.map((field) => field.key));
  const [selected, setSelected] = useState(FALLBACK_FIELDS.map((field) => field.key));
  const [presets, setPresets] = useState([]);
  const [presetId, setPresetId] = useState("");
  const [presetName, setPresetName] = useState("");
  const [previewColumns, setPreviewColumns] = useState([]);
  const [previewRows, setPreviewRows] = useState([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    Promise.allSettled([request("/export/csv/fields"), request("/export/presets")])
      .then(([fieldsResult, presetsResult]) => {
        if (!active) return;
        const fields = fieldsResult.status === "fulfilled" && Array.isArray(fieldsResult.value?.fields)
          && fieldsResult.value.fields.length
          ? fieldsResult.value.fields
          : FALLBACK_FIELDS;
        const allowed = fields.map((field) => String(field.key || "").trim()).filter(Boolean);
        const nextDefaults = normalizeSelection(
          fieldsResult.status === "fulfilled" ? fieldsResult.value?.defaultFields : [],
          allowed,
          FALLBACK_FIELDS.map((field) => field.key)
        );
        setCatalog(fields);
        setDefaults(nextDefaults);
        setSelected(nextDefaults);
        const savedPresets = presetsResult.status === "fulfilled" && Array.isArray(presetsResult.value?.presets)
          ? presetsResult.value.presets
          : [];
        setPresets(savedPresets);
        setPresetId(savedPresets[0]?.id || "");
      });
    return () => { active = false; };
  }, [open, request]);

  const loadPreview = useCallback(async (fields) => {
    if (!fields.length) {
      setPreviewColumns([]);
      setPreviewRows([]);
      return;
    }
    setPreviewLoading(true);
    try {
      const params = new URLSearchParams({ fields: fields.join(","), limit: "5" });
      const response = await request(`/export/csv/preview?${params.toString()}`);
      // Accept either { key, label } objects or bare keys so a shape change
      // cannot take the dialog down again.
      setPreviewColumns((Array.isArray(response?.columns) ? response.columns : []).map((column) => (
        typeof column === "string"
          ? { key: column, label: column }
          : { key: String(column?.key || ""), label: String(column?.label || column?.key || "") }
      )));
      setPreviewRows(Array.isArray(response?.rows) ? response.rows : []);
    } catch {
      setPreviewColumns([]);
      setPreviewRows([]);
    } finally {
      setPreviewLoading(false);
    }
  }, [request]);

  useEffect(() => {
    if (!open) return;
    loadPreview(selected);
  }, [loadPreview, open, selected]);

  function toggleField(key) {
    setSelected((prev) => {
      if (prev.includes(key)) return prev.length <= 1 ? prev : prev.filter((item) => item !== key);
      return [...prev, key];
    });
  }

  function moveField(key, delta) {
    setSelected((prev) => {
      const index = prev.indexOf(key);
      const next = index + delta;
      if (index < 0 || next < 0 || next >= prev.length) return prev;
      const copy = [...prev];
      const [moved] = copy.splice(index, 1);
      copy.splice(next, 0, moved);
      return copy;
    });
  }

  async function savePreset() {
    const name = presetName.trim().slice(0, 72);
    if (!name) {
      setError("Name the preset before saving.");
      return;
    }
    const existing = presets.find((item) => item.name.trim().toLowerCase() === name.toLowerCase());
    const entry = {
      id: existing?.id || `export_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      fields: selected,
      updatedAt: new Date().toISOString()
    };
    const next = existing
      ? presets.map((item) => (item.id === existing.id ? entry : item))
      : [entry, ...presets].slice(0, 30);
    setBusy(true);
    try {
      const response = await request("/export/presets", { method: "PUT", body: { presets: next } });
      setPresets(Array.isArray(response?.presets) ? response.presets : next);
      setPresetId(entry.id);
      setPresetName("");
      setError("");
      setStatus(`Saved “${name}”.`);
    } catch (requestError) {
      setError(requestError.message || "Could not save the preset.");
    } finally {
      setBusy(false);
    }
  }

  async function deletePreset() {
    const preset = presets.find((item) => item.id === presetId);
    if (!preset) return;
    setBusy(true);
    try {
      const next = presets.filter((item) => item.id !== presetId);
      const response = await request("/export/presets", { method: "PUT", body: { presets: next } });
      const saved = Array.isArray(response?.presets) ? response.presets : next;
      setPresets(saved);
      setPresetId(saved[0]?.id || "");
      setStatus(`Deleted “${preset.name}”.`);
    } catch (requestError) {
      setError(requestError.message || "Could not delete the preset.");
    } finally {
      setBusy(false);
    }
  }

  async function downloadCsv() {
    if (!selected.length) {
      setError("Pick at least one field.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const blob = await download(`/export/csv?fields=${encodeURIComponent(selected.join(","))}`);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${slug}-members.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
      setStatus("CSV downloaded.");
    } catch (requestError) {
      setError(requestError.message || "Could not export the CSV.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalDialog
      open={open}
      title="Export members"
      description="Choose the columns and their order, then download."
      onClose={busy ? undefined : onClose}
      className="director-admin-modal director-admin-modal-wide"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="button" onClick={downloadCsv} loading={busy} disabled={!selected.length}>
            <Download aria-hidden="true" />
            Download CSV
          </Button>
        </>
      }
    >
      <div className="pb-people-export">
        <div className="pb-people-export-presets">
          <label className="director-admin-dialog-field">
            Saved presets
            <Select
              value={presetId}
              onChange={(event) => {
                const id = event.target.value;
                setPresetId(id);
                const preset = presets.find((item) => item.id === id);
                if (preset) {
                  const allowed = catalog.map((field) => field.key);
                  setSelected(normalizeSelection(preset.fields, allowed, defaults));
                }
              }}
              disabled={!presets.length}
            >
              {presets.length ? null : <option value="">No presets yet</option>}
              {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
            </Select>
          </label>
          <Button type="button" variant="ghost" size="sm" onClick={deletePreset} disabled={!presetId || busy}>
            Delete
          </Button>
          <label className="director-admin-dialog-field">
            Save current as
            <Input
              value={presetName}
              onChange={(event) => setPresetName(event.target.value)}
              placeholder="Reunion mailing list"
              maxLength={72}
            />
          </label>
          <Button type="button" variant="secondary" size="sm" onClick={savePreset} disabled={busy}>Save</Button>
        </div>

        <div className="pb-people-export-fields">
          <strong>Columns</strong>
          <ul>
            {catalog.map((field) => {
              const index = selected.indexOf(field.key);
              const isOn = index >= 0;
              return (
                <li key={field.key} className={isOn ? "is-on" : ""}>
                  <label>
                    <input type="checkbox" checked={isOn} onChange={() => toggleField(field.key)} />
                    <span>
                      {field.label || field.key}
                      {field.description ? <small>{field.description}</small> : null}
                    </span>
                  </label>
                  {isOn ? (
                    <span className="pb-people-export-order">
                      <button type="button" onClick={() => moveField(field.key, -1)} disabled={index === 0} aria-label={`Move ${field.label} earlier`}>
                        <ChevronUp aria-hidden="true" />
                      </button>
                      <button type="button" onClick={() => moveField(field.key, 1)} disabled={index === selected.length - 1} aria-label={`Move ${field.label} later`}>
                        <ChevronDown aria-hidden="true" />
                      </button>
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="pb-people-export-preview">
          <strong>Preview</strong>
          {previewLoading ? (
            <p className="muted">Loading preview…</p>
          ) : !previewRows.length ? (
            <p className="muted">No rows to preview.</p>
          ) : (
            <div className="director-admin-table-wrap">
              <table className="director-admin-table">
                <thead>
                  {/* The preview endpoint returns columns as { key, label } objects. */}
                  <tr>{previewColumns.map((column) => <th key={column.key}>{column.label}</th>)}</tr>
                </thead>
                <tbody>
                  {previewRows.map((row, index) => (
                    <tr key={index}>
                      {previewColumns.map((column) => (
                        <td key={column.key}>{String(row?.[column.key] ?? "")}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {error ? <p className="error-text" role="alert">{error}</p> : null}
        {status ? <p className="success-text" role="status">{status}</p> : null}
      </div>
    </ModalDialog>
  );
}
