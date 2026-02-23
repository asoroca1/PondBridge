import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Card, Input, PageShell } from "@pondbridge/ui";
import { requestJson } from "../lib/http.js";
import { useAuth } from "../context/AuthContext.jsx";

export default function DirectoryPage() {
  const { slug } = useParams();
  const { token } = useAuth();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const timeout = setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const payload = await requestJson(
          `/api/t/${slug}/profiles?q=${encodeURIComponent(query)}&limit=60`,
          { token }
        );
        setResults(payload.items || []);
      } catch (searchError) {
        setError(searchError.message);
      } finally {
        setLoading(false);
      }
    }, 180);

    return () => clearTimeout(timeout);
  }, [slug, query, token]);

  return (
    <PageShell>
      <Card>
        <h1>Directory Search</h1>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name, email, or company"
        />

        {loading ? <p className="muted">Searching...</p> : null}
        {error ? <p className="error-text">{error}</p> : null}

        <div className="directory-grid">
          {results.map((profile) => (
            <article className="directory-item" key={profile._id}>
              <h3>
                {profile.firstName} {profile.lastName}
              </h3>
              <p>{profile.roleAtCamp || "No camp role listed"}</p>
              <p>{profile.cityState || "Location not provided"}</p>
              <Link to={`/t/${slug}/profile/${profile._id}`}>View profile</Link>
            </article>
          ))}
        </div>
      </Card>
    </PageShell>
  );
}
