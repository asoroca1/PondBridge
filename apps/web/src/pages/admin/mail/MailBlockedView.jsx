import { useCallback, useEffect, useState } from "react";
import { Button } from "@pondbridge/ui";
import { ShieldCheck } from "lucide-react";

function formatDateTime(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

export default function MailBlockedView({ request }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [liftingId, setLiftingId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await request("/email/suppressions");
      setItems(Array.isArray(payload?.items) ? payload.items : []);
    } catch (requestError) {
      setError(requestError.message || "Failed to load blocked addresses.");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => { load(); }, [load]);

  async function lift(id) {
    setLiftingId(id);
    try {
      await request(`/email/suppressions/${id}/lift`, { method: "PATCH" });
      setItems((prev) => prev.filter((item) => item.id !== id));
    } catch (requestError) {
      setError(requestError.message || "Failed to unblock that address.");
    } finally {
      setLiftingId("");
    }
  }

  return (
    <div className="pb-mail-panel">
      <header className="pb-mail-panel-head">
        <div>
          <h2>Blocked addresses</h2>
          <p>Addresses the email provider stopped delivering to after a bounce or complaint.</p>
        </div>
      </header>

      {error ? <p className="error-text" role="alert">{error}</p> : null}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : !items.length ? (
        <div className="pb-mail-empty-panel">
          <ShieldCheck aria-hidden="true" />
          <strong>Nothing blocked.</strong>
          <p>Every address in your network is currently deliverable.</p>
        </div>
      ) : (
        <div className="director-admin-table-wrap">
          <table className="director-admin-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Reason</th>
                <th>First seen</th>
                <th>Last seen</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.email}</td>
                  <td>{item.reason || item.sourceEventType || "—"}</td>
                  <td>{formatDateTime(item.firstSeenAt)}</td>
                  <td>{formatDateTime(item.lastSeenAt)}</td>
                  <td>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={liftingId === item.id}
                      onClick={() => lift(item.id)}
                    >
                      {liftingId === item.id ? "Unblocking…" : "Unblock"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
