import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Button, Card, Input, PageShell, Textarea } from "@pondbridge/ui";
import { requestJson } from "../lib/http.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useTenant } from "../context/TenantContext.jsx";
import { tenantHasFeature } from "../lib/features.js";

const initialForm = {
  firstName: "",
  lastName: "",
  email: "",
  password: "",
  cityState: "",
  roleAtCamp: "",
  bio: "",
  accessCode: ""
};

export default function RegisterPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { login } = useAuth();
  const { tenant } = useTenant();

  const [form, setForm] = useState(initialForm);
  const [inviteToken, setInviteToken] = useState("");
  const [inviteMeta, setInviteMeta] = useState(null);
  const [resumeData, setResumeData] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [resumeUploading, setResumeUploading] = useState(false);
  const canUseResumeParsing = tenantHasFeature(tenant, "resumeParsing");
  const signupMode = tenant?.accessSettings?.signupMode || "open";
  const signupEnabled = tenant?.accessSettings?.signupEnabled !== false;

  useEffect(() => {
    const token = String(searchParams.get("inviteToken") || "").trim();
    const emailFromQuery = String(searchParams.get("email") || "").trim().toLowerCase();
    if (emailFromQuery) {
      setForm((prev) => ({ ...prev, email: emailFromQuery }));
    }

    if (!token) {
      setInviteToken("");
      setInviteMeta(null);
      return;
    }

    setInviteToken(token);
    requestJson(`/api/t/${slug}/auth/invite/verify`, {
      method: "POST",
      body: { inviteToken: token }
    })
      .then((payload) => {
        setInviteMeta(payload.invite || null);
        if (payload.invite?.email) {
          setForm((prev) => ({ ...prev, email: payload.invite.email }));
        }
      })
      .catch(() => {
        setInviteMeta(null);
      });
  }, [searchParams, slug]);

  async function onResumeUpload(event) {
    if (!canUseResumeParsing) return;
    const file = event.target.files?.[0];
    if (!file) return;

    setError("");
    setResumeUploading(true);

    try {
      const data = new FormData();
      data.append("resume", file);

      const payload = await requestJson(`/api/t/${slug}/resume/parse`, {
        method: "POST",
        body: data
      });

      const profile = payload.profile;
      setResumeData(profile);
      setForm((prev) => ({
        ...prev,
        firstName: profile.firstName || prev.firstName,
        lastName: profile.lastName || prev.lastName,
        email: profile.email || prev.email,
        cityState: profile.cityState || prev.cityState,
        highSchool: profile.highSchool || prev.highSchool,
        colleges: profile.colleges || prev.colleges,
        collegeYears: profile.collegeYears || prev.collegeYears,
        currentJobs: profile.currentJobs || prev.currentJobs,
        pastJobs: profile.pastJobs || prev.pastJobs,
        industry: profile.industry || prev.industry,
        socials: profile.socials || prev.socials
      }));
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      setResumeUploading(false);
    }
  }

  async function onSubmit(event) {
    event.preventDefault();
    setError("");
    setSaving(true);

    try {
      const payload = await requestJson(`/api/t/${slug}/auth/register`, {
        method: "POST",
        body: {
          ...form,
          ...resumeData,
          inviteToken
        }
      });

      login(payload.token, payload.user);
      navigate(`/t/${slug}/my-profile`);
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageShell className="auth-shell">
      <Card className="form-card auth-card">
        <h1>Create account</h1>
        {!signupEnabled ? (
          <p className="error-text">Signup is not open yet. Please contact your camp director.</p>
        ) : null}
        {signupMode === "invite" && !inviteMeta ? (
          <p className="muted">
            This camp is invite-only. Use the invite link sent to your email to continue.
          </p>
        ) : null}
        {inviteMeta ? (
          <p className="success-text">
            Invite recognized for <strong>{inviteMeta.email}</strong> ({inviteMeta.roleToAssign}).
          </p>
        ) : null}
        {canUseResumeParsing ? (
          <>
            <p className="muted">Optional: upload a resume PDF to autofill profile fields.</p>
            <div className="file-upload-row">
              <Input type="file" accept="application/pdf" onChange={onResumeUpload} />
              {resumeUploading ? <span className="muted">Parsing resume...</span> : null}
            </div>
          </>
        ) : (
          <p className="muted">Resume autofill is available on the Premium plan.</p>
        )}

        <form onSubmit={onSubmit} className="form-grid">
          <label>
            First name
            <Input
              value={form.firstName}
              onChange={(event) => setForm((prev) => ({ ...prev, firstName: event.target.value }))}
            />
          </label>
          <label>
            Last name
            <Input
              value={form.lastName}
              onChange={(event) => setForm((prev) => ({ ...prev, lastName: event.target.value }))}
            />
          </label>
          <label>
            Email
            <Input
              type="email"
              value={form.email}
              disabled={Boolean(inviteMeta?.email)}
              onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
            />
          </label>
          <label>
            Password
            <Input
              type="password"
              value={form.password}
              onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
            />
          </label>
          <label>
            Camp role
            <Input
              value={form.roleAtCamp}
              placeholder="Camper, Staff, Director"
              onChange={(event) => setForm((prev) => ({ ...prev, roleAtCamp: event.target.value }))}
            />
          </label>
          <label>
            City / State
            <Input
              value={form.cityState}
              onChange={(event) => setForm((prev) => ({ ...prev, cityState: event.target.value }))}
            />
          </label>
          <label>
            Access code (if required)
            <Input
              value={form.accessCode}
              onChange={(event) => setForm((prev) => ({ ...prev, accessCode: event.target.value }))}
            />
          </label>
          <label>
            Bio
            <Textarea
              value={form.bio}
              onChange={(event) => setForm((prev) => ({ ...prev, bio: event.target.value }))}
            />
          </label>

          {error ? <p className="error-text">{error}</p> : null}

          <Button disabled={saving || !signupEnabled}>{saving ? "Creating account..." : "Create account"}</Button>
        </form>
      </Card>
    </PageShell>
  );
}
