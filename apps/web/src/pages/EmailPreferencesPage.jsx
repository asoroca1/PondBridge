import { useEffect, useState } from "react";
import { Button, Card } from "@pondbridge/ui";
import { requestJson } from "../lib/http.js";

function readToken() {
  if (typeof window === "undefined") return "";
  return String(new URLSearchParams(window.location.search).get("token") || "").trim();
}

export default function EmailPreferencesPage() {
  const [token] = useState(readToken);
  const [preference, setPreference] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    if (!token) {
      setError("This email preference link is incomplete.");
      setLoading(false);
      return () => { active = false; };
    }
    requestJson(`/api/public/email-preferences?token=${encodeURIComponent(token)}`)
      .then((payload) => {
        if (active) setPreference(payload);
      })
      .catch((requestError) => {
        if (active) setError(requestError?.message || "This email preference link is unavailable.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [token]);

  async function setStatus(status) {
    setSaving(true);
    setError("");
    try {
      const payload = await requestJson("/api/public/email-preferences", {
        method: "POST",
        body: { token, status }
      });
      setPreference(payload);
    } catch (requestError) {
      setError(requestError?.message || "We could not update this preference. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const unsubscribed = preference?.status === "unsubscribed";

  return (
    <main className="email-preferences-shell">
      <Card className="email-preferences-card">
        <div className="email-preferences-brand" aria-hidden="true">PB</div>
        <p className="email-preferences-kicker">PondBridge email preferences</p>
        <h1>{loading ? "Loading your preferences…" : preference?.campName || "Email preferences"}</h1>

        {loading ? (
          <p className="muted" role="status">Checking the secure preference link.</p>
        ) : error && !preference ? (
          <div className="email-preferences-error" role="alert">
            <strong>We could not open this link.</strong>
            <p>{error}</p>
          </div>
        ) : (
          <>
            <p className="email-preferences-summary">
              {unsubscribed
                ? `${preference.email} will not receive ${preference.topicLabel.toLowerCase()} from this camp.`
                : `${preference.email} currently receives ${preference.topicLabel.toLowerCase()} from this camp.`}
            </p>
            <div className={`email-preferences-state ${unsubscribed ? "is-off" : "is-on"}`} role="status" aria-live="polite">
              <span aria-hidden="true" />
              {unsubscribed ? "Unsubscribed" : "Subscribed"}
            </div>
            <div className="email-preferences-actions">
              {unsubscribed ? (
                <Button type="button" onClick={() => setStatus("subscribed")} disabled={saving}>
                  {saving ? "Updating…" : "Resubscribe"}
                </Button>
              ) : (
                <Button type="button" variant="secondary" onClick={() => setStatus("unsubscribed")} disabled={saving}>
                  {saving ? "Updating…" : "Unsubscribe from community updates"}
                </Button>
              )}
            </div>
            {error ? <p className="error-text" role="alert">{error}</p> : null}
            <p className="email-preferences-note">
              Account, security, and other essential service emails may still be sent when necessary.
            </p>
          </>
        )}
      </Card>
    </main>
  );
}
