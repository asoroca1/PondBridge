import { useEffect, useMemo, useState } from "react";
import { Button, Card, Input, PageShell, SectionTitle } from "@pondbridge/ui";
import { useParams } from "react-router-dom";
import { requestJson } from "../lib/http.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useTenant } from "../context/TenantContext.jsx";
import { tenantHasFeature } from "../lib/features.js";

export default function FamilyTreesPage() {
  const { slug } = useParams();
  const { token } = useAuth();
  const { tenant } = useTenant();

  const [trees, setTrees] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [selectedProfiles, setSelectedProfiles] = useState([]);
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const canUseFamilyTrees = tenantHasFeature(tenant, "familyTrees");

  const filteredProfiles = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return profiles;
    return profiles.filter((profile) =>
      `${profile.firstName} ${profile.lastName}`.toLowerCase().includes(q)
    );
  }, [profiles, query]);

  async function loadData() {
    setError("");
    const [treePayload, profilePayload] = await Promise.all([
      requestJson(`/api/t/${slug}/family-trees`, { token }),
      requestJson(`/api/t/${slug}/profiles?limit=200`, { token })
    ]);

    setTrees(treePayload.items || []);
    setProfiles(profilePayload.items || []);
  }

  useEffect(() => {
    if (!canUseFamilyTrees) return;
    loadData().catch((loadError) => {
      setError(loadError.message);
    });
  }, [slug, token, canUseFamilyTrees]);

  function toggleProfile(profileId) {
    setSelectedProfiles((prev) =>
      prev.includes(profileId) ? prev.filter((value) => value !== profileId) : [...prev, profileId]
    );
  }

  async function createTree(event) {
    event.preventDefault();
    setStatus("");
    setError("");

    if (selectedProfiles.length < 2) {
      setError("Select at least two members.");
      return;
    }

    try {
      await requestJson(`/api/t/${slug}/family-trees`, {
        method: "POST",
        token,
        body: {
          name,
          members: selectedProfiles.map((profileId) => ({ profileId, relationships: [] }))
        }
      });

      setName("");
      setSelectedProfiles([]);
      setStatus("Family tree created.");
      await loadData();
    } catch (createError) {
      setError(createError.message);
    }
  }

  return (
    <PageShell>
      <Card>
        <h1>Family Trees</h1>
        <p className="muted">Create named family groups and maintain relationship structures.</p>
        {error ? <p className="error-text">{error}</p> : null}
        {status ? <p className="success-text">{status}</p> : null}
      </Card>

      {!canUseFamilyTrees ? (
        <Card>
          <SectionTitle>Premium Feature</SectionTitle>
          <p>Family Trees is available on the Premium plan.</p>
        </Card>
      ) : null}

      {canUseFamilyTrees ? (
      <Card>
        <SectionTitle>Create New Tree</SectionTitle>
        <form className="form-grid" onSubmit={createTree}>
          <label>
            Tree name
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </label>

          <label>
            Search profiles
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter by name"
            />
          </label>

          <div className="directory-grid">
            {filteredProfiles.slice(0, 60).map((profile) => {
              const selected = selectedProfiles.includes(profile._id);
              return (
                <button
                  key={profile._id}
                  type="button"
                  className={`select-card ${selected ? "selected" : ""}`}
                  onClick={() => toggleProfile(profile._id)}
                >
                  <strong>
                    {profile.firstName} {profile.lastName}
                  </strong>
                  <span>{profile.roleAtCamp || "No camp role"}</span>
                </button>
              );
            })}
          </div>

          <Button>Create family tree</Button>
        </form>
      </Card>
      ) : null}

      {canUseFamilyTrees ? (
      <Card>
        <SectionTitle>All Trees</SectionTitle>
        <div className="directory-grid">
          {trees.map((tree) => (
            <article className="directory-item" key={tree.id}>
              <h3>{tree.name}</h3>
              <p>
                <strong>Members:</strong> {tree.memberCount}
              </p>
            </article>
          ))}
        </div>
      </Card>
      ) : null}
    </PageShell>
  );
}
