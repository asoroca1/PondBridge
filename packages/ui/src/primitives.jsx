import React from "react";

const BUTTON_VARIANTS = new Set(["primary", "secondary", "danger", "ghost"]);
const BUTTON_SIZES = new Set(["sm", "md", "lg"]);

export function Button({
  type = "button",
  variant = "primary",
  size = "md",
  loading = false,
  className = "",
  disabled = false,
  children,
  ...props
}) {
  const resolvedVariant = BUTTON_VARIANTS.has(variant) ? variant : "primary";
  const resolvedSize = BUTTON_SIZES.has(size) ? size : "md";
  return (
    <button
      type={type}
      className={`pb-btn pb-btn-${resolvedVariant} pb-btn-${resolvedSize} ${className}`.trim()}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <span className="pb-btn-spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function Card({ className = "", ...props }) {
  return <section className={`pb-card ${className}`.trim()} {...props} />;
}

export function PageShell({ as: Component = "section", className = "", ...props }) {
  return <Component className={`pb-page ${className}`.trim()} {...props} />;
}

export function SectionTitle({ className = "", ...props }) {
  return <h2 className={`pb-section-title ${className}`.trim()} {...props} />;
}

export function Input({ className = "", ...props }) {
  return <input className={`pb-input ${className}`.trim()} {...props} />;
}

export function Select({ className = "", ...props }) {
  return <select className={`pb-input ${className}`.trim()} {...props} />;
}

export function Textarea({ className = "", ...props }) {
  return <textarea className={`pb-input pb-textarea ${className}`.trim()} {...props} />;
}

export function Badge({ className = "", tone = "neutral", ...props }) {
  return <span className={`pb-badge pb-badge-${tone} ${className}`.trim()} {...props} />;
}
