import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Button, Card, Input, PageShell } from "@pondbridge/ui";
import { requestJson } from "../lib/http.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useTenant } from "../context/TenantContext.jsx";
import { tenantHasFeature } from "../lib/features.js";
import {
  LEGAL_PRIVACY_VERSION,
  LEGAL_TERMS_VERSION,
  MINIMUM_MEMBER_AGE,
  buildAcceptedLegalAgreementPayload
} from "../lib/legalAgreement.js";

const initialForm = {
  firstName: "",
  lastName: "",
  email: "",
  password: "",
  cityState: "",
  roleAtCamp: ""
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
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [legalAgreementAccepted, setLegalAgreementAccepted] = useState(false);
  const [ageEligibilityConfirmed, setAgeEligibilityConfirmed] = useState(false);
  const canUseResumeParsing = tenantHasFeature(tenant, "resumeParsing");
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

  async function onSubmit(event) {
    event.preventDefault();
    setError("");
    if (!legalAgreementAccepted || !ageEligibilityConfirmed) {
      setError(`You must confirm that you are at least ${MINIMUM_MEMBER_AGE} and agree to Terms and Privacy.`);
      return;
    }
    setSaving(true);

    try {
      const legalAgreement = buildAcceptedLegalAgreementPayload({ ageEligibilityConfirmed });
      const payload = await requestJson(`/api/t/${slug}/auth/register`, {
        method: "POST",
        body: {
          ...form,
          inviteToken,
          legalAgreementAccepted: true,
          ageEligibilityConfirmed: true,
          termsVersion: LEGAL_TERMS_VERSION,
          privacyVersion: LEGAL_PRIVACY_VERSION,
          legalAgreement
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
        {inviteMeta ? (
          <p className="success-text">
            Invite recognized for <strong>{inviteMeta.email}</strong> ({inviteMeta.roleToAssign}).
          </p>
        ) : null}
        {canUseResumeParsing ? (
          <p className="muted">
            After creating your account, you can use the consent-gated resume assistant in Edit Profile and review every suggested field before saving.
          </p>
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
          <label className="wizard1-legal-check">
            <input
              type="checkbox"
              checked={legalAgreementAccepted}
              onChange={(event) => setLegalAgreementAccepted(event.target.checked)}
            />
            <span>
              I agree to the{" "}
              <a href={`/t/${slug}/legal#terms`} target="_blank" rel="noreferrer">
                Terms of Service
              </a>{" "}
              and{" "}
              <a href={`/t/${slug}/legal#privacy`} target="_blank" rel="noreferrer">
                Privacy Policy
              </a>
              .
            </span>
          </label>

          <label className="wizard1-legal-check">
            <input
              type="checkbox"
              checked={ageEligibilityConfirmed}
              onChange={(event) => setAgeEligibilityConfirmed(event.target.checked)}
            />
            <span>I confirm that I am at least {MINIMUM_MEMBER_AGE} years old.</span>
          </label>

          {error ? <p className="error-text">{error}</p> : null}

          <Button disabled={saving || !signupEnabled}>{saving ? "Creating account..." : "Create account"}</Button>
        </form>
      </Card>
    </PageShell>
  );
}
