import React from "react";

export function Button({ variant = "primary", className = "", ...props }) {
  return <button className={`pb-btn pb-btn-${variant} ${className}`.trim()} {...props} />;
}

export function Card({ className = "", ...props }) {
  return <section className={`pb-card ${className}`.trim()} {...props} />;
}

export function PageShell({ className = "", ...props }) {
  return <main className={`pb-page ${className}`.trim()} {...props} />;
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
