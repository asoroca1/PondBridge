import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { requestJson } from "../lib/http.js";
import { isNativeApp } from "../lib/nativeApp.js";
import { useAuth } from "../context/AuthContext.jsx";

function rememberCampSlug(slug = "") {
  const safeSlug = String(slug || "").trim().toLowerCase();
  if (!safeSlug || typeof window === "undefined") return;
  try {
    window.localStorage.setItem("pondbridgeTenantSlug", safeSlug);
  } catch {
    // Ignore storage failures.
  }
}

function normalizeCode(value = "") {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export default function MobileCampCodeEntryPage() {
  const navigate = useNavigate();
  const { isAuthenticated, isReady } = useAuth();
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const codeHelpId = "mobile-camp-code-help";
  const codeErrorId = "mobile-camp-code-error";

  const rememberedSlug =
    typeof window !== "undefined"
      ? String(window.localStorage.getItem("pondbridgeTenantSlug") || "").trim().toLowerCase()
      : "";

  useEffect(() => {
    setError("");
  }, [code]);

  if (!isNativeApp()) {
    return <Navigate to="/" replace />;
  }

  if (isReady && isAuthenticated && rememberedSlug) {
    return <Navigate to={`/t/${rememberedSlug}/home`} replace />;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const normalizedCode = normalizeCode(code);
    if (normalizedCode.length < 4) {
      setError("Enter your camp app code.");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const payload = await requestJson("/api/public/mobile-app-code/resolve", {
        method: "POST",
        body: { code: normalizedCode }
      });
      const slug = String(payload?.slug || "").trim().toLowerCase();
      if (!slug) {
        throw new Error("We could not find a camp for that code.");
      }
      rememberCampSlug(slug);
      navigate(`/t/${slug}/login`, { replace: true });
    } catch (submitError) {
      setError(String(submitError?.message || "Unable to verify that code right now."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="app-status-shell mobile-camp-code-shell">
      <div className="app-status-card mobile-camp-code-card">
        <div className="mobile-camp-code-head">
          <p className="mobile-camp-code-kicker">PondBridge</p>
          <h1>Find your camp</h1>
          <p>Enter the six-character app code from your camp director.</p>
        </div>

        <form className="mobile-camp-code-form" onSubmit={handleSubmit}>
          <label className="mobile-camp-code-field" htmlFor="mobile-camp-code">
            <span>Six-character camp code</span>
            <input
              id="mobile-camp-code"
              type="text"
              value={code}
              onChange={(event) => setCode(normalizeCode(event.target.value))}
              placeholder="ABC123"
              autoCapitalize="characters"
              autoCorrect="off"
              autoComplete="one-time-code"
              spellCheck="false"
              inputMode="text"
              maxLength={6}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? `${codeHelpId} ${codeErrorId}` : codeHelpId}
            />
          </label>

          <p id={codeHelpId} className="mobile-camp-code-hint">
            The code is not case-sensitive. Ask your camp if you do not have it.
          </p>

          {error ? <p id={codeErrorId} className="login1-error" role="alert">{error}</p> : null}

          <button type="submit" className="login1-btn mobile-camp-code-submit" disabled={submitting}>
            {submitting ? "Checking code..." : "Continue"}
          </button>
        </form>

        <p className="mobile-camp-code-privacy">Your camp code only selects the right private network. You will still sign in securely.</p>
      </div>
    </section>
  );
}
