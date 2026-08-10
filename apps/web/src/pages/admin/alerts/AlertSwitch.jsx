export default function AlertSwitch({ checked, onChange, label, blurb = "", disabled = false }) {
  return (
    <label className={`pb-alert-switch${disabled ? " is-disabled" : ""}`}>
      <input
        type="checkbox"
        role="switch"
        checked={Boolean(checked)}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="pb-alert-switch-track" aria-hidden="true" />
      <span className="pb-alert-switch-copy">
        <strong>{label}</strong>
        {blurb ? <small>{blurb}</small> : null}
      </span>
    </label>
  );
}
