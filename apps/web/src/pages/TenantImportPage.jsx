import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button, Card, Input, PageShell, SectionTitle } from "@pondbridge/ui";
import { requestBlob, requestJson } from "../lib/http.js";
import { useAuth } from "../context/AuthContext.jsx";

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function isCsvFile(file) {
  if (!file) return false;
  return file.type.includes("csv") || file.name.toLowerCase().endsWith(".csv");
}

export default function TenantImportPage() {
  const { slug } = useParams();
  const { token } = useAuth();
  const fileInputRef = useRef(null);

  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [enableFuzzyMatch, setEnableFuzzyMatch] = useState(false);
  const [fuzzyDistance, setFuzzyDistance] = useState(1);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [result, setResult] = useState(null);

  function onPickFile(file) {
    if (!file) return;
    if (!isCsvFile(file)) {
      setError("Please upload a CSV file.");
      return;
    }

    setError("");
    setStatus("");
    setSelectedFile(file);
  }

  function onDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);

    const file = event.dataTransfer?.files?.[0];
    onPickFile(file);
  }

  async function runImport() {
    if (!selectedFile) {
      setError("Select a CSV file first.");
      return;
    }

    setUploading(true);
    setError("");
    setStatus("");

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("enableFuzzyMatch", String(enableFuzzyMatch));
      formData.append("fuzzyDistance", String(fuzzyDistance));

      const payload = await requestJson("/api/tenants/me/import-csv", {
        method: "POST",
        token,
        headers: {
          "X-Tenant-Slug": slug
        },
        body: formData
      });

      const summary = payload.importSummary || payload.report || null;
      setResult(
        summary
          ? {
              ...summary,
              hasFailureCsv: Boolean(summary.hasFailureCsv || summary.failureCsvDownloadPath)
            }
          : null
      );
      setStatus("Import finished.");
    } catch (runError) {
      setError(runError.message);
    } finally {
      setUploading(false);
    }
  }

  async function downloadFailures() {
    if (!result?.failureCsvDownloadPath) return;

    try {
      const blob = await requestBlob(result.failureCsvDownloadPath, { token });
      downloadBlob(blob, `${slug}-import-failures.csv`);
    } catch (downloadError) {
      setError(downloadError.message);
    }
  }

  return (
    <PageShell className="pb-cedar-page">
      <Card>
        <h1>CSV Import</h1>
        <p className="muted">Upload alumni rows safely with duplicate detection and row-level errors.</p>
        <p className="muted">
          Expected columns: <code>firstName,lastName,email,phone,cityState,roleAtCamp,gradYear</code>
        </p>

        <div
          className={`dropzone ${dragActive ? "active" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            setDragActive(false);
          }}
          onDrop={onDrop}
        >
          <p>{selectedFile ? `Selected: ${selectedFile.name}` : "Drag and drop a CSV file here"}</p>
          <div className="inline-actions">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                fileInputRef.current?.click();
              }}
            >
              Choose file
            </Button>
            <Button type="button" onClick={runImport} disabled={uploading || !selectedFile}>
              {uploading ? "Importing..." : "Run import"}
            </Button>
            <Link className="link-button secondary" to={`/t/${slug}/admin`}>
              Back to admin
            </Link>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => onPickFile(event.target.files?.[0] || null)}
            style={{ display: "none" }}
          />
        </div>

        <div className="inline-actions">
          <label className="inline-check">
            <input
              type="checkbox"
              checked={enableFuzzyMatch}
              onChange={(event) => setEnableFuzzyMatch(event.target.checked)}
            />
            Enable fuzzy name duplicate check
          </label>
          <label>
            Fuzzy distance (0-4)
            <Input
              type="number"
              min="0"
              max="4"
              value={fuzzyDistance}
              onChange={(event) => setFuzzyDistance(Number(event.target.value || 1))}
              disabled={!enableFuzzyMatch}
            />
          </label>
        </div>

        {error ? <p className="error-text">{error}</p> : null}
        {status ? <p className="success-text">{status}</p> : null}
      </Card>

      {result ? (
        <Card>
          <SectionTitle>Import Results</SectionTitle>
          <div className="import-results-grid">
            <p>
              <strong>Rows read:</strong> {result.rowsRead}
            </p>
            <p>
              <strong>Created:</strong> {result.createdCount}
            </p>
            <p>
              <strong>Updated:</strong> {result.updatedCount}
            </p>
            <p>
              <strong>Skipped duplicates:</strong> {result.skippedDuplicates}
            </p>
            <p>
              <strong>Errors:</strong> {result.errorCount}
            </p>
          </div>

          {result.hasFailureCsv ? (
            <Button type="button" variant="secondary" onClick={downloadFailures}>
              Download failures CSV
            </Button>
          ) : null}

          {Array.isArray(result.errors) && result.errors.length > 0 ? (
            <div className="import-errors-wrap">
              <table className="import-errors-table">
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Code</th>
                    <th>Message</th>
                  </tr>
                </thead>
                <tbody>
                  {result.errors.slice(0, 100).map((item, index) => (
                    <tr key={`${item.rowNumber || item.row || index}-${item.code || item.reason || "error"}`}>
                      <td>{item.rowNumber ?? item.row ?? "-"}</td>
                      <td>{item.code || "ERROR"}</td>
                      <td>{item.message || item.reason || "Unknown row error"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.errors.length > 100 ? (
                <p className="muted">Showing first 100 errors. Download failures CSV for the full list.</p>
              ) : null}
            </div>
          ) : (
            <p className="success-text">No row errors found.</p>
          )}
        </Card>
      ) : null}
    </PageShell>
  );
}
