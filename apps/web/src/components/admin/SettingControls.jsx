import "./setting-controls.css";

/**
 * The shared vocabulary every Settings tab is built from, so a switch, a field
 * label, and a row of records look the same whichever tab you are on.
 */

export function SettingSwitch({ checked, onChange, label, blurb = "", disabled = false }) {
  return (
    <label className={`pb-set-switch${disabled ? " is-disabled" : ""}`}>
      <input
        type="checkbox"
        role="switch"
        checked={Boolean(checked)}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="pb-set-switch-track" aria-hidden="true" />
      <span className="pb-set-switch-copy">
        <strong>{label}</strong>
        {blurb ? <small>{blurb}</small> : null}
      </span>
    </label>
  );
}

export function SettingField({ label, hint = "", optional = false, children, className = "" }) {
  return (
    <label className={`pb-set-field ${className}`.trim()}>
      <span>
        {label}
        {optional ? <small>optional</small> : null}
      </span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

export function SettingRow({ children, className = "" }) {
  return <div className={`pb-set-row ${className}`.trim()}>{children}</div>;
}

export function SettingActions({ children, note = "" }) {
  return (
    <div className="pb-set-actions">
      {note ? <p>{note}</p> : <span />}
      <div>{children}</div>
    </div>
  );
}

export function SettingList({ children, empty = "" }) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children;
  if (!items || (Array.isArray(items) && !items.length)) {
    return <p className="muted pb-set-empty">{empty}</p>;
  }
  return <ul className="pb-set-list">{items}</ul>;
}

export function SettingListItem({ title, meta = "", children }) {
  return (
    <li>
      <div>
        <strong>{title}</strong>
        {meta ? <small>{meta}</small> : null}
      </div>
      {children ? <div className="pb-set-list-actions">{children}</div> : null}
    </li>
  );
}
