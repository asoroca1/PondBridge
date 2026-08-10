import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Input } from "@pondbridge/ui";
import { ModalConfirm } from "../../components/admin/AdminUi.jsx";
import useAdminApi from "./useAdminApi.js";

function formatDate(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleDateString();
}

function useDebouncedValue(value, delayMs = 220) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), Math.max(0, Number(delayMs) || 0));
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);
  return debounced;
}

export default function DirectorAdminSettingsAdminsPage() {
  const { request } = useAdminApi();
  const [payload, setPayload] = useState({ admins: [], pendingInvites: [] });
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 220);
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [promotingUserId, setPromotingUserId] = useState("");
  const [removing, setRemoving] = useState(false);
  const [adminToRemove, setAdminToRemove] = useState(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const loadAdmins = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await request("/settings/admins");
      setPayload(response);
    } catch (requestError) {
      setError(requestError.message || "Failed to load admin list.");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    loadAdmins();
  }, [loadAdmins]);

  useEffect(() => {
    const term = String(debouncedQuery || "").trim();
    if (!term) {
      setResults([]);
      setSearching(false);
      return undefined;
    }
    let active = true;
    setSearching(true);
    request(`/settings/admins/search?q=${encodeURIComponent(term)}&limit=8`)
      .then((response) => {
        if (!active) return;
        setResults(Array.isArray(response?.items) ? response.items : []);
      })
      .catch((requestError) => {
        if (!active) return;
        setResults([]);
        setError(requestError.message || "Failed to search members.");
      })
      .finally(() => {
        if (active) setSearching(false);
      });

    return () => {
      active = false;
    };
  }, [debouncedQuery, request]);

  async function grantAdmin(member) {
    if (!member?.userId && !member?.email) return;
    setPromotingUserId(String(member.userId || member.email || ""));
    setStatus("");
    setError("");
    try {
      await request("/settings/admins/grant", {
        method: "POST",
        body: {
          userId: member.userId,
          email: member.email
        }
      });
      setStatus(`${member.fullName || member.email || "Member"} now has admin access.`);
      setResults((prev) =>
        prev.map((item) =>
          String(item.userId || "") === String(member.userId || "")
            ? { ...item, isAdmin: true }
            : item
        )
      );
      await loadAdmins();
    } catch (requestError) {
      setError(requestError.message || "Failed to grant admin access.");
    } finally {
      setPromotingUserId("");
    }
  }

  async function removeAdmin(userId) {
    setError("");
    setRemoving(true);
    try {
      await request(`/settings/admins/${userId}`, { method: "DELETE" });
      setAdminToRemove(null);
      await loadAdmins();
    } catch (requestError) {
      setError(requestError.message || "Failed to remove admin.");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <Card>
      {error ? <p className="error-text">{error}</p> : null}
      {status ? <p className="success-text">{status}</p> : null}
      <div className="director-admin-table-wrap">
        <table className="director-admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Added</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="muted">
                  Loading admins...
                </td>
              </tr>
            ) : (
              payload.admins.map((item) => (
                <tr key={item.id}>
                  <td>{item.name || "-"}</td>
                  <td>{item.email}</td>
                  <td>{item.role}</td>
                  <td>{formatDate(item.addedAt)}</td>
                  <td>
                    {item.role === "Director" ? (
                      <span className="muted">Protected</span>
                    ) : (
                      <button
                        type="button"
                        className="director-admin-inline-link"
                        onClick={() => setAdminToRemove(item)}
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="director-admin-admin-search">
        <h3 className="pb-section-title">Add Admin</h3>
        <p className="muted">Search any member in this network and grant admin access.</p>
        <Input
          value={query}
          placeholder="Search by name or email"
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="director-admin-admin-search-results">
          {searching ? <p className="muted">Searching members...</p> : null}
          {!searching && query.trim() && results.length === 0 ? (
            <p className="muted">No matching members found.</p>
          ) : null}
          {!searching && results.length > 0 ? (
            <ul className="director-admin-simple-list">
              {results.map((item) => {
                const rowKey = String(item.userId || item.email || item.id || "");
                const alreadyAdmin = Boolean(item.isAdmin);
                const busy = promotingUserId === rowKey;
                return (
                  <li key={rowKey}>
                    <div className="director-admin-search-item-main">
                      <strong>{item.fullName || "-"}</strong>
                      <span>{item.email || "-"}</span>
                    </div>
                    {alreadyAdmin ? (
                      <Badge tone="success">Admin</Badge>
                    ) : (
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => grantAdmin(item)}
                      >
                        {busy ? "Adding..." : "Make Admin"}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      </div>

      <ModalConfirm
        open={Boolean(adminToRemove)}
        title="Remove Admin Access?"
        description={`This will revoke director-level access for ${adminToRemove?.email || "this user"}.`}
        confirmLabel="Remove Admin"
        cancelLabel="Cancel"
        busy={removing}
        onCancel={() => setAdminToRemove(null)}
        onConfirm={() => {
          if (!adminToRemove?.id) return;
          removeAdmin(adminToRemove.id);
        }}
      />
    </Card>
  );
}
