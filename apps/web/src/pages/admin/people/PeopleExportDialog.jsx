import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Input, Select } from "@pondbridge/ui";
import { ChevronDown, ChevronUp, Download, Search } from "lucide-react";
import { ModalDialog } from "../../../components/admin/AdminUi.jsx";
import { stageMeta } from "./peopleStages.js";

// Two genuinely different exports: the list you are looking at (every stage,
// pipeline columns) and the full member profile record (joined members only,
// the rich profile fields).
const SOURCES = {
  list: {
    key: "list",
    label: "This list",
    fieldsPath: "/people/export/fields",
    previewPath: "/people/export/preview",
    downloadPath: "/people/export.csv",
    suffix: "people"
  },
  profiles: {
    key: "profiles",
    label: "Member profiles",
    fieldsPath: "/export/csv/fields",
    previewPath: "/export/csv/preview",
    downloadPath: "/export/csv",
    suffix: "members"
  }
};

function normalizeSelection(keys = [], allowed = [], fallback = []) {
  const allowedSet = new Set(allowed);
  const seen = new Set();
  const picked = [];
  for (const raw of Array.isArray(keys) ? keys : []) {
    const key = String(raw || "").trim();
    if (!key || !allowedSet.has(key) || seen.has(key)) continue;
    seen.add(key);
    picked.push(key);
  }
  return picked.length ? picked : fallback.filter((key) => allowedSet.has(key));
}

function normalizeColumns(value = []) {
  return (Array.isArray(value) ? value : []).map((column) => (
    typeof column === "string"
      ? { key: column, label: column }
      : { key: String(column?.key || ""), label: String(column?.label || column?.key || "") }
  ));
}

export default function PeopleExportDialog({
  open,
  onClose,
  request,
  download,
  slug,
  stage = "all",
  filters = {},
  selected = [],
  listTotal = 0
}) {
  const [source, setSource] = useState("list");
  const [catalog, setCatalog] = useState([]);
  const [defaults, setDefaults] = useState([]);
  const [selectedFields, setSelectedFields] = useState([]);
  const [fieldQuery, setFieldQuery] = useState("");
  const [presets, setPresets] = useState([]);
  const [presetId, setPresetId] = useState("");
  const [presetName, setPresetName] = useState("");
  const [previewColumns, setPreviewColumns] = useState([]);
  const [previewRows, setPreviewRows] = useState([]);
  const [previewTotal, setPreviewTotal] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const useSelection = selected.length > 0;
  const config = SOURCES[source];

  // The query that decides which rows are in scope — filters, or the explicit
  // selection when the director has picked people.
  const scopeParams = useMemo(() => {
    const params = new URLSearchParams();
    if (source !== "list") return params;
    if (useSelection) {
      params.set("keys", selected.join(","));
      return params;
    }
    params.set("stage", stage);
    if (filters.q) params.set("q", filters.q);
    if (filters.role && filters.role !== "all") params.set("role", filters.role);
    if (filters.year && filters.year !== "all") params.set("year", filters.year);
    return params;
  }, [filters.q, filters.role, filters.year, selected, source, stage, useSelection]);

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    setError("");
    setStatus("");
    Promise.allSettled([request(config.fieldsPath), request("/export/presets")])
      .then(([fieldsResult, presetsResult]) => {
        if (!active) return;
        const fields = fieldsResult.status === "fulfilled" && Array.isArray(fieldsResult.value?.fields)
          ? fieldsResult.value.fields
          : [];
        const allowed = fields.map((field) => String(field.key || "")).filter(Boolean);
        const nextDefaults = normalizeSelection(
          fieldsResult.status === "fulfilled" ? fieldsResult.value?.defaultFields : [],
          allowed,
          allowed.slice(0, 5)
        );
        setCatalog(fields);
        setDefaults(nextDefaults);
        setSelectedFields(nextDefaults);
        const saved = presetsResult.status === "fulfilled" && Array.isArray(presetsResult.value?.presets)
          ? presetsResult.value.presets
          : [];
        setPresets(saved);
        setPresetId("");
      });
    return () => { active = false; };
  }, [config.fieldsPath, open, request]);

  const loadPreview = useCallback(async (fields) => {
    if (!fields.length) {
      setPreviewColumns([]);
      setPreviewRows([]);
      return;
    }
    setPreviewLoading(true);
    try {
      const params = new URLSearchParams(scopeParams);
      params.set("fields", fields.join(","));
      params.set("limit", "5");
      const response = await request(`${config.previewPath}?${params.toString()}`);
      setPreviewColumns(normalizeColumns(response?.columns));
      setPreviewRows(Array.isArray(response?.rows) ? response.rows : []);
      setPreviewTotal(response?.total ?? null);
    } catch {
      setPreviewColumns([]);
      setPreviewRows([]);
      setPreviewTotal(null);
    } finally {
      setPreviewLoading(false);
    }
  }, [config.previewPath, request, scopeParams]);

  useEffect(() => {
    if (!open) return;
    loadPreview(selectedFields);
  }, [loadPreview, open, selectedFields]);

  const visibleCatalog = useMemo(() => {
    const needle = fieldQuery.trim().toLowerCase();
    if (!needle) return catalog;
    return catalog.filter((field) => (
      String(field.label || "").toLowerCase().includes(needle)
      || String(field.key || "").toLowerCase().includes(needle)
    ));
  }, [catalog, fieldQuery]);

  function toggleField(key) {
    setSelectedFields((prev) => {
      if (prev.includes(key)) return prev.length <= 1 ? prev : prev.filter((item) => item !== key);
      return [...prev, key];
    });
  }

  function moveField(key, delta) {
    setSelectedFields((prev) => {
      const index = prev.indexOf(key);
      const next = index + delta;
      if (index < 0 || next < 0 || next >= prev.length) return prev;
      const copy = [...prev];
      const [moved] = copy.splice(index, 1);
      copy.splice(next, 0, moved);
      return copy;
    });
  }

  async function savePresets(nextPresets, message) {
    setBusy(true);
    try {
      const response = await request("/export/presets", { method: "PUT", body: { presets: nextPresets } });
      setPresets(Array.isArray(response?.presets) ? response.presets : nextPresets);
      setError("");
      setStatus(message);
      return true;
    } catch (requestError) {
      setError(requestError.message || "Could not save presets.");
      return false;
    } finally {
      setBusy(false);
    }
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
      fields: selectedFields,
      updatedAt: new Date().toISOString()
    };
    const next = existing
      ? presets.map((item) => (item.id === existing.id ? entry : item))
      : [entry, ...presets].slice(0, 30);
    if (await savePresets(next, `Saved “${name}”.`)) {
      setPresetId(entry.id);
      setPresetName("");
    }
  }

  async function deletePreset() {
    const preset = presets.find((item) => item.id === presetId);
    if (!preset) return;
    if (await savePresets(presets.filter((item) => item.id !== presetId), `Deleted “${preset.name}”.`)) {
      setPresetId("");
    }
  }

  async function downloadCsv() {
    if (!selectedFields.length) {
      setError("Pick at least one column.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const params = new URLSearchParams(scopeParams);
      params.set("fields", selectedFields.join(","));
      const blob = await download(`${config.downloadPath}?${params.toString()}`);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${slug}-${config.suffix}-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
      setStatus("CSV downloaded.");
    } catch (requestError) {
      setError(requestError.message || "Could not export the CSV.");
    } finally {
      setBusy(false);
    }
  }

  const scopeLabel = source === "profiles"
    ? "Every member profile"
    : useSelection
      ? `${selected.length} selected ${selected.length === 1 ? "person" : "people"}`
      : `${stageMeta(stage).label}${filters.q || (filters.role && filters.role !== "all") || (filters.year && filters.year !== "all") ? " (filtered)" : ""}`;
  const rowCount = previewTotal ?? (source === "list" ? listTotal : null);

  return (
    <ModalDialog
      open={open}
      title="Export"
      description="Pick what to export and which columns to include."
      onClose={busy ? undefined : onClose}
      className="director-admin-modal pb-people-export-modal"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="button" onClick={downloadCsv} loading={busy} disabled={!selectedFields.length}>
            <Download aria-hidden="true" />
            Download {rowCount != null ? `${rowCount.toLocaleString()} ${rowCount === 1 ? "row" : "rows"}` : "CSV"}
          </Button>
        </>
      }
    >
      <div className="pb-people-export">
        <div className="pb-people-export-scope" role="radiogroup" aria-label="What to export">
          {Object.values(SOURCES).map((item) => (
            <button
              key={item.key}
              type="button"
              role="radio"
              aria-checked={source === item.key}
              className={source === item.key ? "is-selected" : ""}
              onClick={() => setSource(item.key)}
            >
              <strong>{item.label}</strong>
              <small>
                {item.key === "list"
                  ? "Everyone in view, any stage — pipeline columns"
                  : "Joined members only — full profile fields"}
              </small>
            </button>
          ))}
        </div>

        <p className="pb-people-export-scope-note">
          Exporting <strong>{scopeLabel}</strong>
          {rowCount != null ? ` · ${rowCount.toLocaleString()} ${rowCount === 1 ? "row" : "rows"}` : ""}
        </p>

        <div className="pb-people-export-body">
          <section className="pb-people-export-fields" aria-label="Columns">
            <header>
              <strong>Columns ({selectedFields.length})</strong>
              <div>
                <button type="button" onClick={() => setSelectedFields(catalog.map((field) => field.key))}>All</button>
                <button type="button" onClick={() => setSelectedFields(defaults)}>Reset</button>
              </div>
            </header>
            <label className="pb-people-export-search">
              <Search aria-hidden="true" />
              <Input
                value={fieldQuery}
                onChange={(event) => setFieldQuery(event.target.value)}
                placeholder="Find a column"
                aria-label="Find a column"
              />
            </label>
            <ul>
              {visibleCatalog.map((field) => {
                const index = selectedFields.indexOf(field.key);
                const isOn = index >= 0;
                return (
                  <li key={field.key} className={isOn ? "is-on" : ""}>
                    <label>
                      <input type="checkbox" checked={isOn} onChange={() => toggleField(field.key)} />
                      <span>
                        {field.label || field.key}
                        {isOn ? <em>#{index + 1}</em> : null}
                      </span>
                    </label>
                    {isOn ? (
                      <span className="pb-people-export-order">
                        <button
                          type="button"
                          onClick={() => moveField(field.key, -1)}
                          disabled={index === 0}
                          aria-label={`Move ${field.label} earlier`}
                        >
                          <ChevronUp aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveField(field.key, 1)}
                          disabled={index === selectedFields.length - 1}
                          aria-label={`Move ${field.label} later`}
                        >
                          <ChevronDown aria-hidden="true" />
                        </button>
                      </span>
                    ) : null}
                  </li>
                );
              })}
              {!visibleCatalog.length ? <li className="pb-people-export-none">No matching columns.</li> : null}
            </ul>
          </section>

          <section className="pb-people-export-preview" aria-label="Preview">
            <header><strong>Preview</strong><small>First rows</small></header>
            {previewLoading ? (
              <p className="muted">Loading preview…</p>
            ) : !previewRows.length ? (
              <p className="muted">Nothing matches this scope.</p>
            ) : (
              <div className="pb-people-export-table">
                <table className="director-admin-table">
                  <thead>
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

            <div className="pb-people-export-presets">
              <label>
                <span>Saved presets</span>
                <Select
                  value={presetId}
                  onChange={(event) => {
                    const id = event.target.value;
                    setPresetId(id);
                    const preset = presets.find((item) => item.id === id);
                    if (preset) {
                      setSelectedFields(normalizeSelection(
                        preset.fields,
                        catalog.map((field) => field.key),
                        defaults
                      ));
                    }
                  }}
                >
                  <option value="">{presets.length ? "Choose a preset" : "No presets yet"}</option>
                  {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
                </Select>
              </label>
              <div className="pb-people-export-preset-actions">
                <Input
                  value={presetName}
                  onChange={(event) => setPresetName(event.target.value)}
                  placeholder="Save these columns as…"
                  maxLength={72}
                  aria-label="Preset name"
                />
                <Button type="button" variant="secondary" size="sm" onClick={savePreset} disabled={busy}>Save</Button>
                <Button type="button" variant="ghost" size="sm" onClick={deletePreset} disabled={!presetId || busy}>
                  Delete
                </Button>
              </div>
            </div>
          </section>
        </div>

        {error ? <p className="error-text" role="alert">{error}</p> : null}
        {status ? <p className="success-text" role="status">{status}</p> : null}
      </div>
    </ModalDialog>
  );
}
