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
          <h1>Enter camp code</h1>
          <p>Use the code your camp gave you to continue.</p>
        </div>

        <form className="mobile-camp-code-form" onSubmit={handleSubmit}>
          <label className="mobile-camp-code-field">
            <span>Camp code</span>
            <input
              type="text"
              value={code}
              onChange={(event) => setCode(normalizeCode(event.target.value))}
              placeholder="Camp code"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck="false"
              inputMode="text"
            />
          </label>

          {error ? <p className="login1-error">{error}</p> : null}

          <button type="submit" className="login1-btn mobile-camp-code-submit" disabled={submitting}>
            {submitting ? "Checking code..." : "Continue"}
          </button>
        </form>
      </div>
    </section>
  );
}
