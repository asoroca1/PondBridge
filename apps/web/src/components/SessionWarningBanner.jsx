import { useAuth } from "../context/AuthContext.jsx";

/**
 * Non-intrusive banner that warns users before their session expires
 * due to inactivity.  Displayed at the top of the viewport and
 * auto-dismissed on any user interaction (the idle timer resets).
 */
export default function SessionWarningBanner() {
  const { sessionWarningMinutes, dismissSessionWarning } = useAuth();

  if (!sessionWarningMinutes) return null;

  return (
    <div
      role="alert"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 99999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "12px",
        padding: "10px 16px",
        background: "#fef3c7",
        borderBottom: "2px solid #f59e0b",
        color: "#92400e",
        fontSize: "14px",
        fontWeight: 500
      }}
    >
      <span>
        Your session will expire in {sessionWarningMinutes} minute{sessionWarningMinutes !== 1 ? "s" : ""} due to
        inactivity. Move your mouse or press any key to stay logged in.
      </span>
      <button
        onClick={dismissSessionWarning}
        style={{
          background: "#f59e0b",
          color: "#fff",
          border: "none",
          borderRadius: "4px",
          padding: "4px 12px",
          cursor: "pointer",
          fontSize: "13px",
          fontWeight: 600
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
