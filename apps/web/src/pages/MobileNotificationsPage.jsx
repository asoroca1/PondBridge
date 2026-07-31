import { useEffect, useMemo, useState } from "react";
import { Bell, BellOff, CheckCheck, Archive, ExternalLink } from "lucide-react";
import { Button, Card } from "@pondbridge/ui";
import { useNavigate } from "react-router-dom";
import { useMobileNotifications } from "../context/MobileNotificationsContext.jsx";
import { isNativeApp } from "../lib/nativeApp.js";
import { useTenant } from "../context/TenantContext.jsx";
import { normalizeTenantRouteForHost } from "../lib/tenantRouting.js";

function formatDateTime(value) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleString();
}

function Toggle({ label, checked, onChange, disabled = false }) {
  return (
    <label className="mobile-notifications-toggle">
      <input
        type="checkbox"
        checked={Boolean(checked)}
        disabled={disabled}
        onChange={(event) => Promise.resolve(onChange(event.target.checked)).catch(() => {})}
      />
      <span>{label}</span>
    </label>
  );
}

export default function MobileNotificationsPage() {
  const navigate = useNavigate();
  const { tenant } = useTenant();
  const {
    supported,
    items,
    unreadCount,
    permissionState,
    preferences,
    loading,
    error,
    lastUpdatedAt,
    refresh,
    loadInbox,
    enablePush,
    markRead,
    markAllRead,
    archiveItem,
    updatePreferences
  } = useMobileNotifications();
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!supported) return;
    loadInbox({ unreadOnly: showUnreadOnly }).catch(() => {});
  }, [loadInbox, showUnreadOnly, supported]);

  const categoryPrefs = useMemo(() => preferences?.categories || {}, [preferences?.categories]);

  if (!isNativeApp()) {
    return (
      <section className="app-status-shell">
        <div className="app-status-card">
          <h1>Mobile notifications live in the iPhone app</h1>
          <p>Open this page in the PondBridge mobile app to manage push alerts and your mobile inbox.</p>
        </div>
      </section>
    );
  }

  async function saveCategory(key, value) {
    setSaving(true);
    setNotice("");
    try {
      await updatePreferences({
        categories: {
          [key]: value
        }
      });
      setNotice("Notification preferences saved.");
    } finally {
      setSaving(false);
    }
  }

  async function savePushEnabled(value) {
    setSaving(true);
    setNotice("");
    try {
      await updatePreferences({ pushEnabled: value });
      setNotice(value ? "Push alerts are allowed for this account." : "Push alerts are paused for this account.");
    } finally {
      setSaving(false);
    }
  }

  async function handleEnablePush() {
    setNotice("");
    const result = await enablePush();
    if (result === "granted") setNotice("This phone is registered for push alerts.");
  }

  return (
    <section className="page-container mobile-notifications-page">
      <div className="mobile-notifications-header">
        <div>
          <p className="mobile-notifications-eyebrow">Mobile Notifications</p>
          <h1>Inbox and push alerts</h1>
          <p className="muted">
            {unreadCount > 0 ? `${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}` : "All caught up"}
            {lastUpdatedAt ? ` · Updated ${lastUpdatedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}
          </p>
        </div>
        <div className="mobile-notifications-header-actions">
          <Button variant="ghost" loading={loading} onClick={() => refresh().catch(() => {})}>
            {loading ? "Refreshing" : "Refresh"}
          </Button>
          {unreadCount > 0 ? (
            <Button variant="secondary" onClick={() => markAllRead().catch(() => {})}>
              <CheckCheck size={16} /> Mark all read
            </Button>
          ) : null}
        </div>
      </div>

      <Card className="mobile-notifications-card">
        <div className="mobile-notifications-card-head">
          <div>
            <h2>Push Status</h2>
            <p className="muted">
              {permissionState === "granted"
                ? "Push notifications are enabled on this phone."
                : "Push notifications are not enabled yet."}
            </p>
          </div>
          <Button onClick={() => handleEnablePush().catch(() => {})}>
            {permissionState === "granted" ? <Bell size={16} /> : <BellOff size={16} />}
            {permissionState === "granted" ? "Re-register push" : "Enable push"}
          </Button>
        </div>

        <div className="mobile-notifications-master-pref">
          <Toggle
            label="Allow push alerts for this account"
            checked={preferences?.pushEnabled !== false}
            disabled={!preferences || saving}
            onChange={savePushEnabled}
          />
          <p className="muted">Pause pushes here without losing messages from your in-app inbox.</p>
        </div>

        <div className="mobile-notifications-pref-grid">
          <Toggle
            label="Announcements"
            checked={categoryPrefs.announcements}
            disabled={!preferences || saving || preferences?.pushEnabled === false}
            onChange={(value) => saveCategory("announcements", value)}
          />
          <Toggle
            label="Events & seminars"
            checked={categoryPrefs.events}
            disabled={!preferences || saving || preferences?.pushEnabled === false}
            onChange={(value) => saveCategory("events", value)}
          />
          <Toggle
            label="Community"
            checked={categoryPrefs.community}
            disabled={!preferences || saving || preferences?.pushEnabled === false}
            onChange={(value) => saveCategory("community", value)}
          />
          <Toggle
            label="Account"
            checked={categoryPrefs.account}
            disabled={!preferences || saving || preferences?.pushEnabled === false}
            onChange={(value) => saveCategory("account", value)}
          />
          <Toggle
            label="Admin"
            checked={categoryPrefs.admin}
            disabled={!preferences || saving || preferences?.pushEnabled === false}
            onChange={(value) => saveCategory("admin", value)}
          />
        </div>
        {permissionState === "denied" ? (
          <p className="mobile-notifications-warning">Push is disabled in iPhone Settings. Your inbox remains available here.</p>
        ) : null}
        {error ? <p className="mobile-notifications-error" role="alert">{error}</p> : null}
        {saving ? <p className="muted" role="status">Saving preferences...</p> : null}
        {!saving && notice ? <p className="mobile-notifications-success" role="status">{notice}</p> : null}
      </Card>

      <Card className="mobile-notifications-card">
        <div className="mobile-notifications-card-head">
          <div>
            <h2>Inbox</h2>
            <p className="muted">Messages sent to your mobile app stay here even if you miss the push.</p>
          </div>
          <label className="mobile-notifications-filter">
            <input
              type="checkbox"
              checked={showUnreadOnly}
              onChange={(event) => setShowUnreadOnly(event.target.checked)}
            />
            <span>Unread only</span>
          </label>
        </div>

        {loading ? <p className="muted">Loading notifications...</p> : null}
        {!loading && items.length === 0 ? <p className="muted">No mobile notifications yet.</p> : null}

        <div className="mobile-notifications-list">
          {items.map((item) => {
            const targetPath = normalizeTenantRouteForHost(
              String(tenant?.slug || ""),
              String(item.deepLink || "/home")
            );

            return (
              <article
                key={item.id}
                className={`mobile-notifications-item ${item.readAt ? "is-read" : "is-unread"}`.trim()}
              >
                <div className="mobile-notifications-item-copy">
                  <div className="mobile-notifications-item-head">
                    <strong>{item.title}</strong>
                    <span>{formatDateTime(item.createdAt)}</span>
                  </div>
                  <p>{item.body}</p>
                  <small>{item.category}</small>
                </div>
                <div className="mobile-notifications-item-actions">
                  {item.deepLink ? (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        markRead(item.id).catch(() => {});
                        navigate(targetPath);
                      }}
                    >
                      <ExternalLink size={16} /> Open
                    </Button>
                  ) : null}
                  {!item.readAt ? (
                    <Button variant="ghost" onClick={() => markRead(item.id).catch(() => {})}>
                      <CheckCheck size={16} /> Read
                    </Button>
                  ) : null}
                  <Button variant="ghost" onClick={() => archiveItem(item.id).catch(() => {})}>
                    <Archive size={16} /> Archive
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      </Card>
    </section>
  );
}
