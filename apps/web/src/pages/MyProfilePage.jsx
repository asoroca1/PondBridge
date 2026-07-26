import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Button, Card, Input, PageShell } from "@pondbridge/ui";
import { requestJson } from "../lib/http.js";
import { useAuth } from "../context/AuthContext.jsx";

export default function MyProfilePage() {
  const { slug } = useParams();
  const { token, user } = useAuth();

  const [profile, setProfile] = useState(null);
  const [status, setStatus] = useState({ loading: true, error: "", saving: false, saved: false });

  useEffect(() => {
    let cancelled = false;

    requestJson(`/api/t/${slug}/profiles/me`, { token })
      .then((payload) => {
        if (cancelled) return;
        setProfile(payload.profile);
        setStatus((prev) => ({ ...prev, loading: false }));
      })
      .catch((error) => {
        if (cancelled) return;
        setStatus({ loading: false, saving: false, saved: false, error: error.message });
      });

    return () => {
      cancelled = true;
    };
  }, [slug, token]);

  async function onSave(event) {
    event.preventDefault();
    setStatus((prev) => ({ ...prev, saving: true, error: "", saved: false }));

    try {
      const payload = await requestJson(`/api/t/${slug}/profiles/me`, {
        method: "PUT",
        token,
        body: profile
      });

      setProfile(payload.profile);
      setStatus((prev) => ({ ...prev, saving: false, saved: true }));
    } catch (error) {
      setStatus((prev) => ({ ...prev, saving: false, error: error.message }));
    }
  }

  if (status.loading) {
    return (
      <PageShell>
        <Card>Loading profile...</Card>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <Card className="form-card">
        <h1>
          My Profile <span className="muted">({user?.email})</span>
        </h1>
        <form onSubmit={onSave} className="form-grid">
          <label>
            First name
            <Input
              value={profile?.firstName || ""}
              onChange={(event) => setProfile((prev) => ({ ...prev, firstName: event.target.value }))}
            />
          </label>
          <label>
            Last name
            <Input
              value={profile?.lastName || ""}
              onChange={(event) => setProfile((prev) => ({ ...prev, lastName: event.target.value }))}
            />
          </label>
          <label>
            City / State
            <Input
              value={profile?.cityState || ""}
              onChange={(event) => setProfile((prev) => ({ ...prev, cityState: event.target.value }))}
            />
          </label>
          <label>
            Role at camp
            <Input
              value={profile?.roleAtCamp || ""}
              onChange={(event) => setProfile((prev) => ({ ...prev, roleAtCamp: event.target.value }))}
            />
          </label>
          <label>
            Industry
            <Input
              value={profile?.industry || ""}
              onChange={(event) => setProfile((prev) => ({ ...prev, industry: event.target.value }))}
            />
          </label>
          {status.error ? <p className="error-text">{status.error}</p> : null}
          {status.saved ? <p className="success-text">Profile saved.</p> : null}

          <Button disabled={status.saving}>{status.saving ? "Saving..." : "Save profile"}</Button>
        </form>
      </Card>
    </PageShell>
  );
}
