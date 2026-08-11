import { Card } from "@pondbridge/ui";
import { Check, LoaderCircle } from "lucide-react";
import "./setting-controls.css";

/**
 * The shared vocabulary every Settings tab is built from, so a switch, a field
 * label, and a row of records look the same whichever tab you are on.
 */

/**
 * Every tab opens by saying where you stand — what is on, what is set, how many
 * there are — before showing anything to change. `children` is for the one
 * control that belongs with that statement, if there is one.
 */
export function SettingStatus({ icon: Icon, tone = "on", title, detail = "", children = null }) {
  return (
    <Card className={`pb-set-status is-${tone}`}>
      <div className="pb-set-status-copy">
        {Icon ? <Icon aria-hidden="true" /> : null}
        <div>
          <strong>{title}</strong>
          {detail ? <span>{detail}</span> : null}
        </div>
      </div>
      {children ? <div className="pb-set-status-action">{children}</div> : null}
    </Card>
  );
}

/**
 * Sections within a tab. Used wherever a tab holds more than a couple of
 * distinct jobs, so Settings never becomes a long scroll you have to hunt in.
 */
export function SettingTabs({ tabs, active, onChange, saveState = "" }) {
  return (
    <div className="pb-set-bar">
      <nav className="pb-set-tabs" aria-label="Sections">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={active === tab.key ? "is-active" : ""}
            aria-current={active === tab.key ? "page" : undefined}
            onClick={() => onChange(tab.key)}
          >
            {tab.label}
            {tab.badge ? <em>{tab.badge}</em> : null}
          </button>
        ))}
      </nav>
      <span className="pb-set-savestate" role="status" aria-live="polite">
        {saveState === "saving" ? (
          <><LoaderCircle aria-hidden="true" className="is-spinning" /> Saving…</>
        ) : saveState === "saved" ? (
          <><Check aria-hidden="true" /> Saved</>
        ) : null}
      </span>
    </div>
  );
}

/** The big on/off switch that belongs inside a SettingStatus. */
export function SettingMasterSwitch({ checked, onChange, label }) {
  return (
    <label className="pb-set-master-switch">
      <input
        type="checkbox"
        role="switch"
        checked={Boolean(checked)}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span aria-hidden="true" />
      <em>{label || (checked ? "On" : "Off")}</em>
    </label>
  );
}

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
