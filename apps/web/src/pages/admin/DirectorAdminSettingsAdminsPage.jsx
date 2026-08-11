import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Input } from "@pondbridge/ui";
import { ShieldCheck } from "lucide-react";
import { ModalConfirm } from "../../components/admin/AdminUi.jsx";
import {
  SettingField,
  SettingList,
  SettingListItem,
  SettingStatus
} from "../../components/admin/SettingControls.jsx";
import useAdminApi from "./useAdminApi.js";

function formatDate(value) {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? ""
    : parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
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
  const [promoting, setPromoting] = useState("");
  const [removing, setRemoving] = useState(false);
  const [adminToRemove, setAdminToRemove] = useState(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const loadAdmins = useCallback(async () => {
    setError("");
    try {
      setPayload(await request("/settings/admins"));
    } catch (requestError) {
      setError(requestError.message || "Could not load the admin list.");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => { loadAdmins(); }, [loadAdmins]);

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
        if (active) setResults(Array.isArray(response?.items) ? response.items : []);
      })
      .catch((requestError) => {
        if (!active) return;
        setResults([]);
        setError(requestError.message || "Could not search members.");
      })
      .finally(() => { if (active) setSearching(false); });
    return () => { active = false; };
  }, [debouncedQuery, request]);

  async function grantAdmin(member) {
    if (!member?.userId && !member?.email) return;
    const key = String(member.userId || member.email || "");
    setPromoting(key);
    setStatus("");
    setError("");
    try {
      await request("/settings/admins/grant", {
        method: "POST",
        body: { userId: member.userId, email: member.email }
      });
      setStatus(`${member.fullName || member.email || "They"} can now run this network.`);
      setResults((prev) => prev.map((item) => (
        String(item.userId || "") === String(member.userId || "") ? { ...item, isAdmin: true } : item
      )));
      await loadAdmins();
    } catch (requestError) {
      setError(requestError.message || "Could not grant admin access.");
    } finally {
      setPromoting("");
    }
  }

  async function removeAdmin(userId) {
    setError("");
    setRemoving(true);
    try {
      await request(`/settings/admins/${userId}`, { method: "DELETE" });
      setStatus("Admin access removed. They keep their member account.");
      setAdminToRemove(null);
      await loadAdmins();
    } catch (requestError) {
      setError(requestError.message || "Could not remove that admin.");
    } finally {
      setRemoving(false);
    }
  }

  const admins = Array.isArray(payload?.admins) ? payload.admins : [];
  const pending = Array.isArray(payload?.pendingInvites) ? payload.pendingInvites : [];
  const trimmedQuery = query.trim();

  return (
    <div className="pb-set-stack">
      <SettingStatus
        icon={ShieldCheck}
        tone="on"
        title={
          admins.length === 1
            ? "You are the only admin"
            : `${admins.length} people can run this network`
        }
        detail={
          pending.length
            ? `${pending.length} invitation${pending.length === 1 ? "" : "s"} still waiting to be accepted.`
            : "Anyone listed below has the same dashboard you do."
        }
      />

      {error ? <p className="error-text" role="alert">{error}</p> : null}
      {status ? <p className="success-text" role="status">{status}</p> : null}

      <Card>
        <h2 className="pb-section-title">Who can run this network</h2>
        <p className="muted">
          Admins see everything in this dashboard and can email members, edit profiles, and change settings.
          They cannot remove you.
        </p>

        {loading ? (
          <p className="muted pb-set-empty">Loading…</p>
        ) : (
          <SettingList empty="Nobody else has admin access yet.">
            {admins.map((item) => (
              <SettingListItem
                key={item.id}
                title={item.name || item.email}
                meta={[item.name ? item.email : "", item.addedAt ? `added ${formatDate(item.addedAt)}` : ""]
                  .filter(Boolean)
                  .join(" · ")}
              >
                {item.role === "Director" ? (
                  <Badge tone="neutral">Owner</Badge>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => setAdminToRemove(item)}>Remove</Button>
                )}
              </SettingListItem>
            ))}
          </SettingList>
        )}

        {pending.length ? (
          <>
            <h3 className="pb-section-title pb-set-subhead">Invited, not accepted yet</h3>
            <SettingList>
              {pending.map((item) => (
                <SettingListItem
                  key={item.id || item.email}
                  title={item.email}
                  meta={item.invitedAt ? `invited ${formatDate(item.invitedAt)}` : "invitation sent"}
                >
                  <Badge tone="warning">Pending</Badge>
                </SettingListItem>
              ))}
            </SettingList>
          </>
        ) : null}
      </Card>

      <Card>
        <h2 className="pb-section-title">Add an admin</h2>
        <p className="muted">
          They need to be a member of this network first. Add them under People, then find them here.
        </p>

        <div className="pb-set-form">
          <SettingField label="Find a member">
            <Input
              value={query}
              placeholder="Search by name or email"
              spellCheck={false}
              onChange={(event) => setQuery(event.target.value)}
            />
          </SettingField>

          {searching ? (
            <p className="muted pb-set-empty">Searching…</p>
          ) : trimmedQuery && !results.length ? (
            <p className="muted pb-set-empty">Nobody in this network matches “{trimmedQuery}”.</p>
          ) : results.length ? (
            <SettingList>
              {results.map((item) => {
                const key = String(item.userId || item.email || item.id || "");
                return (
                  <SettingListItem key={key} title={item.fullName || item.email} meta={item.fullName ? item.email : ""}>
                    {item.isAdmin ? (
                      <Badge tone="success">Already an admin</Badge>
                    ) : (
                      <Button size="sm" loading={promoting === key} onClick={() => grantAdmin(item)}>
                        <ShieldCheck aria-hidden="true" />
                        Make admin
                      </Button>
                    )}
                  </SettingListItem>
                );
              })}
            </SettingList>
          ) : null}
        </div>
      </Card>

      <ModalConfirm
        open={Boolean(adminToRemove)}
        title={`Remove admin access for ${adminToRemove?.name || adminToRemove?.email || "this person"}?`}
        description="They lose the dashboard immediately but keep their member account and profile. You can add them back any time."
        confirmLabel="Remove access"
        cancelLabel="Keep it"
        tone="danger"
        busy={removing}
        onCancel={() => setAdminToRemove(null)}
        onConfirm={() => {
          if (adminToRemove?.id) removeAdmin(adminToRemove.id);
        }}
      />
    </div>
  );
}
