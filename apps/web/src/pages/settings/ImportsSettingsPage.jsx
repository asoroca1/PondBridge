import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Card, PageShell, SectionTitle } from "@pondbridge/ui";
import { requestJson } from "../../lib/http.js";
import { useAuth } from "../../context/AuthContext.jsx";

export default function ImportsSettingsPage() {
  const { slug } = useParams();
  const { token } = useAuth();
  const [history, setHistory] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    requestJson("/api/tenants/me/import/history", {
      token,
      headers: {
        "X-Tenant-Slug": slug
      }
    })
      .then((payload) => {
        setHistory(payload.items || []);
      })
      .catch((requestError) => {
        setError(requestError.message);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [slug, token]);

  return (
    <PageShell className="pb-cedar-page">
      <Card>
        <SectionTitle>Import History</SectionTitle>
        <div className="inline-actions">
          <Link className="link-button" to={`/t/${slug}/admin/import`}>
            Run New Import
          </Link>
          <Link className="link-button secondary" to={`/t/${slug}/onboarding`}>
            Back to Onboarding
          </Link>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
      </Card>

      <Card>
        <SectionTitle>Recent Imports</SectionTitle>
        {loading ? (
          <p className="muted">Loading import history...</p>
        ) : history.length === 0 ? (
          <p className="muted">No imports have been run yet.</p>
        ) : (
          <div className="import-errors-wrap">
            <table className="import-errors-table">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Created</th>
                  <th>Updated</th>
                  <th>Skipped</th>
                  <th>Errors</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {history.map((item) => (
                  <tr key={item.id}>
                    <td>{item.fileName}</td>
                    <td>{item.summary?.createdCount || 0}</td>
                    <td>{item.summary?.updatedCount || 0}</td>
                    <td>{item.summary?.skippedDuplicates || 0}</td>
                    <td>{item.summary?.errorCount || 0}</td>
                    <td>{new Date(item.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </PageShell>
  );
}
