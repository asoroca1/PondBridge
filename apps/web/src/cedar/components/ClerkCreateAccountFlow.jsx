import React, { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { SignUp, useAuth as useClerkAuth } from "@clerk/clerk-react";
import Navbar1 from "./Navbar1";
import { requestJson } from "../../lib/http.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { useTenant } from "../../context/TenantContext.jsx";

function routeWithSlug(slug, path) {
  return slug ? `/t/${slug}${path.startsWith("/") ? path : `/${path}`}` : path;
}

function truthy(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

export default function ClerkCreateAccountFlow() {
  const navigate = useNavigate();
  const params = useParams();
  const { slug: contextSlug } = useTenant();
  const slug = String(params.slug || contextSlug || "").trim().toLowerCase();
  const [searchParams] = useSearchParams();
  const inviteToken = String(searchParams.get("inviteToken") || searchParams.get("token") || "").trim();
  const completeJoin = truthy(searchParams.get("completeJoin"));
  const { refreshSession } = useAuth();
  const { isLoaded, isSignedIn, getToken } = useClerkAuth();
  const [inviteMeta, setInviteMeta] = useState(null);
  const [accessCode, setAccessCode] = useState("");
  const [submittingJoin, setSubmittingJoin] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!inviteToken || !slug) return;
    requestJson(`/api/t/${slug}/auth/invite/verify`, {
      method: "POST",
      body: { inviteToken }
    })
      .then((payload) => {
        setInviteMeta(payload?.invite || null);
      })
      .catch(() => {
        setInviteMeta(null);
      });
  }, [inviteToken, slug]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !slug) return;
    if (completeJoin) return;
    const callbackPath = routeWithSlug(
      slug,
      `/auth/callback${inviteToken ? `?inviteToken=${encodeURIComponent(inviteToken)}` : ""}`
    );
    navigate(callbackPath, { replace: true });
  }, [completeJoin, inviteToken, isLoaded, isSignedIn, navigate, slug]);

  async function onCompleteJoin(event) {
    event.preventDefault();
    if (!slug) return;
    setError("");
    setSubmittingJoin(true);

    try {
      const token = await getToken();
      if (!token) throw new Error("Missing Clerk session token.");

      const payload = await requestJson(`/api/t/${slug}/access/join`, {
        method: "POST",
        token,
        body: { accessCode: String(accessCode || "").trim() }
      });
      await refreshSession({ tenantSlug: slug });
      const next = String(payload?.decision?.nextRoute || routeWithSlug(slug, "/home")).trim();
      navigate(next, { replace: true });
    } catch (err) {
      setError(String(err?.message || "Unable to complete signup for this network."));
    } finally {
      setSubmittingJoin(false);
    }
  }

  if (isLoaded && isSignedIn && completeJoin) {
    return (
      <div className="login1">
        <Navbar1 />
        <section className="login1-main">
          <div className="login1-card">
            <h1 className="login1-title">Complete Signup</h1>
            <p className="login1-forgot">This camp requires an access code to join.</p>
            <form className="login1-form" onSubmit={onCompleteJoin}>
              <input
                className="login1-input"
                type="text"
                value={accessCode}
                onChange={(event) => setAccessCode(event.target.value)}
                placeholder="Enter access code"
                required
              />
              {error ? <p className="login1-error">{error}</p> : null}
              <button className="login1-btn" type="submit" disabled={submittingJoin}>
                {submittingJoin ? "Joining..." : "Join Network"}
              </button>
            </form>
          </div>
        </section>
      </div>
    );
  }

  const path = routeWithSlug(slug, "/create-account");
  const callbackPath = routeWithSlug(
    slug,
    `/auth/callback${inviteToken ? `?inviteToken=${encodeURIComponent(inviteToken)}` : ""}`
  );
  const signInUrl = routeWithSlug(slug, `/login${inviteToken ? `?inviteToken=${encodeURIComponent(inviteToken)}` : ""}`);

  return (
    <div className="login1">
      <Navbar1 />
      <section className="login1-main">
        <div className="login1-card">
          <h1 className="login1-title">Create Profile</h1>
          <p className="login1-forgot">Sign up with email and secure account recovery via Clerk.</p>
          {inviteMeta ? (
            <p className="success-text">
              Invite recognized for <strong>{inviteMeta.email || "this account"}</strong>.
            </p>
          ) : null}
          <SignUp
            path={path}
            routing="path"
            signInUrl={signInUrl}
            fallbackRedirectUrl={callbackPath}
            forceRedirectUrl={callbackPath}
            appearance={{
              elements: {
                socialButtons: {
                  display: "none"
                },
                socialButtonsBlock: {
                  display: "none"
                },
                socialButtonsBlockButton: {
                  display: "none"
                },
                socialButtonsIconButton: {
                  display: "none"
                },
                dividerRow: {
                  display: "none"
                },
                dividerLine: {
                  display: "none"
                },
                dividerText: {
                  display: "none"
                },
                card: {
                  boxShadow: "none",
                  border: "none",
                  width: "100%"
                }
              }
            }}
          />
        </div>
      </section>
    </div>
  );
}
