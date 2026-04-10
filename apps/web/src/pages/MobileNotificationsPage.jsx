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

function Toggle({ label, checked, onChange }) {
  return (
    <label className="mobile-notifications-toggle">
      <input type="checkbox" checked={Boolean(checked)} onChange={(event) => onChange(event.target.checked)} />
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
    try {
      await updatePreferences({
        categories: {
          [key]: value
        }
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="page-container mobile-notifications-page">
      <div className="mobile-notifications-header">
        <div>
          <p className="mobile-notifications-eyebrow">Mobile Notifications</p>
          <h1>Inbox and push alerts</h1>
          <p className="muted">
            {unreadCount > 0 ? `${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}` : "All caught up"}
          </p>
        </div>
        <div className="mobile-notifications-header-actions">
          <Button variant="ghost" onClick={() => refresh().catch(() => {})}>
            Refresh
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
          <Button onClick={() => enablePush().catch(() => {})}>
            {permissionState === "granted" ? <Bell size={16} /> : <BellOff size={16} />}
            {permissionState === "granted" ? "Re-register push" : "Enable push"}
          </Button>
        </div>

        <div className="mobile-notifications-pref-grid">
          <Toggle
            label="Announcements"
            checked={categoryPrefs.announcements}
            onChange={(value) => saveCategory("announcements", value)}
          />
          <Toggle label="Events" checked={categoryPrefs.events} onChange={(value) => saveCategory("events", value)} />
          <Toggle
            label="Community"
            checked={categoryPrefs.community}
            onChange={(value) => saveCategory("community", value)}
          />
          <Toggle label="Account" checked={categoryPrefs.account} onChange={(value) => saveCategory("account", value)} />
          <Toggle label="Admin" checked={categoryPrefs.admin} onChange={(value) => saveCategory("admin", value)} />
        </div>
        {saving ? <p className="muted">Saving preferences...</p> : null}
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
