import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Card, PageShell } from "@pondbridge/ui";
import { requestJson } from "../lib/http.js";
import { useAuth } from "../context/AuthContext.jsx";

export default function ProfileViewPage() {
  const { slug, profileId } = useParams();
  const { token } = useAuth();

  const [profile, setProfile] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    requestJson(`/api/t/${slug}/profiles/${profileId}`, { token })
      .then((payload) => setProfile(payload.profile))
      .catch((fetchError) => setError(fetchError.message));
  }, [slug, profileId, token]);

  if (error) {
    return (
      <PageShell>
        <Card>
          <p className="error-text">{error}</p>
        </Card>
      </PageShell>
    );
  }

  if (!profile) {
    return (
      <PageShell>
        <Card>Loading profile...</Card>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <Card>
        <h1>
          {profile.firstName} {profile.lastName}
        </h1>
        <p>
          <strong>Role at camp:</strong> {profile.roleAtCamp || "Not listed"}
        </p>
        <p>
          <strong>Location:</strong> {profile.cityState || "Not listed"}
        </p>
        <p>
          <strong>Industry:</strong> {profile.industry || "Not listed"}
        </p>
      </Card>
    </PageShell>
  );
}
