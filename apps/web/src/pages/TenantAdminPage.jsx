import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button, Card, Input, PageShell, SectionTitle, Select } from "@pondbridge/ui";
import { requestBlob, requestJson } from "../lib/http.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useTenant } from "../context/TenantContext.jsx";
import { tenantHasFeature } from "../lib/features.js";
import { ModalConfirm } from "../components/admin/AdminUi.jsx";
import { useConfirmDialog } from "../components/admin/useConfirmDialog.js";

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function TenantAdminPage() {
  const { slug } = useParams();
  const { token } = useAuth();
  const { tenant } = useTenant();
  const { confirm, confirmDialogProps } = useConfirmDialog();

  const [overview, setOverview] = useState(null);
  const [profiles, setProfiles] = useState([]);
  // The endpoint returns one page now. Without these the page would quietly show the
  // first 50 members as though that were the whole camp.
  const [profilePage, setProfilePage] = useState({ page: 1, pageSize: 50, total: 0 });
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [banner, setBanner] = useState("");
  const [accessSettings, setAccessSettings] = useState({ signupMode: "open", accessCode: "" });
  const [theme, setTheme] = useState({
    brandPrimary: "#303030",
    brandSecondary: "#e6e6e6",
    bg: "#fafafa",
    text: "#1c1c1c",
    card: "#ffffff"
  });
  const canExportPdf = tenantHasFeature(tenant, "pdfExport");
  const profilePageCount = Math.max(1, Math.ceil(profilePage.total / (profilePage.pageSize || 50)));
  const profileRangeStart = profilePage.total === 0 ? 0 : (profilePage.page - 1) * profilePage.pageSize + 1;
  const profileRangeEnd = Math.min(profilePage.page * profilePage.pageSize, profilePage.total);

  async function loadData(page = profilePage.page) {
    setError("");
    try {
      const [overviewPayload, profilesPayload] = await Promise.all([
        requestJson(`/api/t/${slug}/admin/overview`, { token }),
        requestJson(`/api/t/${slug}/admin/profiles?page=${page}&pageSize=${profilePage.pageSize}`, {
          token
        })
      ]);
      setOverview(overviewPayload);
      setProfiles(profilesPayload.items || []);
      setProfilePage((curr) => ({
        page: Number(profilesPayload.page) || page,
        pageSize: Number(profilesPayload.pageSize) || curr.pageSize,
        total: Number(profilesPayload.total) || 0
      }));
      setAccessSettings({
        signupMode:
          overviewPayload.tenant?.settings?.signupMode ||
          overviewPayload.tenant?.accessSettings?.signupMode ||
          "open",
        accessCode: ""
      });
      setTheme({
        brandPrimary: overviewPayload.tenant?.theme?.brandPrimary || "#303030",
        brandSecondary: overviewPayload.tenant?.theme?.brandSecondary || "#e6e6e6",
        bg: overviewPayload.tenant?.theme?.bg || "#fafafa",
        text: overviewPayload.tenant?.theme?.text || "#1c1c1c",
        card: overviewPayload.tenant?.theme?.card || "#ffffff"
      });
    } catch (loadError) {
      setError(loadError.message);
    }
  }

  useEffect(() => {
    const launchBanner = sessionStorage.getItem("pondbridge-admin-banner");
    if (launchBanner) {
      setBanner(launchBanner);
      sessionStorage.removeItem("pondbridge-admin-banner");
    }
    loadData();
  }, [slug, token]);

  async function saveAccessSettings() {
    setStatus("");
    setError("");
    try {
      await requestJson(`/api/t/${slug}/admin/access-settings`, {
        method: "PUT",
        token,
        body: accessSettings
      });
      setStatus("Access settings saved.");
      await loadData();
    } catch (saveError) {
      setError(saveError.message);
    }
  }

  async function saveBranding() {
    setStatus("");
    setError("");
    try {
      await requestJson(`/api/t/${slug}/admin/branding`, {
        method: "PUT",
        token,
        body: { theme }
      });
      setStatus("Branding saved.");
      await loadData();
    } catch (saveError) {
      setError(saveError.message);
    }
  }

  async function publishOnboarding() {
    setStatus("");
    setError("");
    try {
      await requestJson(`/api/t/${slug}/admin/onboarding/publish`, {
        method: "PUT",
        token
      });
      setStatus("Onboarding marked live.");
      await loadData();
    } catch (publishError) {
      setError(publishError.message);
    }
  }

  async function deleteProfile(profileId) {
    const accepted = await confirm({
      title: "Delete this profile?",
      description: "The member profile will be permanently removed from this camp. This cannot be undone.",
      confirmLabel: "Delete profile",
    });
    if (!accepted) return;

    setError("");
    setStatus("");

    try {
      await requestJson(`/api/t/${slug}/admin/profiles/${profileId}`, {
        method: "DELETE",
        token
      });
      setStatus("Profile deleted.");
      await loadData();
    } catch (deleteError) {
      setError(deleteError.message);
    }
  }

  async function downloadCsv() {
    try {
      const blob = await requestBlob(`/api/t/${slug}/admin/export/csv`, { token });
      downloadBlob(blob, `${slug}-directory.csv`);
    } catch (downloadError) {
      setError(downloadError.message);
    }
  }

  async function downloadPdf() {
    try {
      const blob = await requestBlob(`/api/t/${slug}/admin/export/pdf`, { token });
      downloadBlob(blob, `${slug}-directory.pdf`);
    } catch (downloadError) {
      setError(downloadError.message);
    }
  }

  if (!overview) {
    return (
      <PageShell className="pb-cedar-page">
        <Card>Loading admin dashboard...</Card>
      </PageShell>
    );
  }

  return (
    <PageShell className="pb-cedar-page">
      <Card>
        <h1>Camp Director Dashboard</h1>
        <p>
          <strong>Onboarding status:</strong> {overview.tenant?.onboardingStatus}
        </p>
        <p>
          <strong>Onboarding step:</strong>{" "}
          {overview.tenant?.onboardingProgress?.currentStep || 1}
        </p>
        <p>
          <strong>Users:</strong> {overview.counts?.users} | <strong>Profiles:</strong>{" "}
          {overview.counts?.profiles}
        </p>

        <div className="inline-actions">
          <Link className="link-button secondary" to={`/t/${slug}/onboarding`}>
            {overview.tenant?.onboardingStatus === "live"
              ? "Open Setup Settings"
              : "Continue Setup"}
          </Link>
          <Button onClick={downloadCsv}>Export CSV</Button>
          {canExportPdf ? (
            <Button variant="secondary" onClick={downloadPdf}>
              Export PDF
            </Button>
          ) : (
            <Button variant="secondary" disabled>
              Export PDF (Premium)
            </Button>
          )}
          <Button variant="secondary" onClick={publishOnboarding}>
            Publish onboarding
          </Button>
          <Link className="link-button secondary" to={`/t/${slug}/admin/people/add`}>
            Invite or Import Members
          </Link>
          <Link className="link-button secondary" to={`/t/${slug}/admin/people/add`}>
            Manage Invites
          </Link>
          <Link className="link-button secondary" to={`/t/${slug}/admin/billing`}>
            Billing
          </Link>
        </div>

        {error ? <p className="error-text">{error}</p> : null}
        {status ? <p className="success-text">{status}</p> : null}
        {banner ? <p className="success-text">{banner}</p> : null}
      </Card>

      <Card>
        <SectionTitle>Signup Access</SectionTitle>
        <label>
          Signup mode
          <Select
            value={accessSettings.signupMode}
            onChange={(event) =>
              setAccessSettings((prev) => ({ ...prev, signupMode: event.target.value }))
            }
          >
            <option value="open">Open signup</option>
            <option value="code">Access code</option>
            <option value="invite">Invite-only</option>
          </Select>
        </label>
        {accessSettings.signupMode === "code" ? (
          <label>
            Access code
            <Input
              value={accessSettings.accessCode}
              onChange={(event) =>
                setAccessSettings((prev) => ({ ...prev, accessCode: event.target.value }))
              }
            />
          </label>
        ) : null}
        <Button onClick={saveAccessSettings}>Save access settings</Button>
      </Card>

      <Card>
        <SectionTitle>Camp Branding</SectionTitle>
        <div className="theme-grid">
          <label>
            Primary
            <Input
              value={theme.brandPrimary}
              onChange={(event) => setTheme((prev) => ({ ...prev, brandPrimary: event.target.value }))}
            />
          </label>
          <label>
            Secondary
            <Input
              value={theme.brandSecondary}
              onChange={(event) =>
                setTheme((prev) => ({ ...prev, brandSecondary: event.target.value }))
              }
            />
          </label>
          <label>
            Background
            <Input
              value={theme.bg}
              onChange={(event) => setTheme((prev) => ({ ...prev, bg: event.target.value }))}
            />
          </label>
          <label>
            Text
            <Input
              value={theme.text}
              onChange={(event) => setTheme((prev) => ({ ...prev, text: event.target.value }))}
            />
          </label>
          <label>
            Card
            <Input
              value={theme.card}
              onChange={(event) => setTheme((prev) => ({ ...prev, card: event.target.value }))}
            />
          </label>
        </div>
        <Button onClick={saveBranding}>Save branding</Button>
      </Card>

      <Card>
        <SectionTitle>Profiles</SectionTitle>
        <div className="directory-grid">
          {profiles.map((profile) => (
            <article key={profile._id} className="directory-item">
              <h3>
                {profile.firstName} {profile.lastName}
              </h3>
              <p>{profile.emails?.[0] || ""}</p>
              <Button variant="danger" onClick={() => deleteProfile(profile._id)}>
                Delete
              </Button>
            </article>
          ))}
        </div>
        {profilePage.total > profiles.length ? (
          <div className="directory-pager">
            <Button
              variant="secondary"
              disabled={profilePage.page <= 1}
              onClick={() => loadData(profilePage.page - 1)}
            >
              Previous
            </Button>
            <span>
              {profileRangeStart}-{profileRangeEnd} of {profilePage.total}
            </span>
            <Button
              variant="secondary"
              disabled={profilePage.page >= profilePageCount}
              onClick={() => loadData(profilePage.page + 1)}
            >
              Next
            </Button>
          </div>
        ) : null}
      </Card>
      <ModalConfirm {...confirmDialogProps} />
    </PageShell>
  );
}
