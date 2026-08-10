import { Card } from "@pondbridge/ui";
import AlertSwitch from "./AlertSwitch.jsx";
import { AUTOMATIC_GROUPS, DELIVERY_TOGGLES } from "./alertOptions.js";

export default function AlertsRulesView({ settings, update, disabled }) {
  return (
    <div className="pb-alerts-pane">
      <Card>
        <h2 className="pb-section-title">How alerts arrive</h2>
        <p className="muted">These apply to everything below, and to one-off alerts you send yourself.</p>
        <div className="pb-alerts-switches">
          {DELIVERY_TOGGLES.map((item) => (
            <AlertSwitch
              key={item.key}
              checked={settings[item.key]}
              onChange={(value) => update({ [item.key]: value })}
              label={item.label}
              blurb={item.blurb}
              disabled={disabled}
            />
          ))}
        </div>
        {!disabled && !settings.pushEnabled && !settings.inboxEnabled ? (
          <p className="pb-alerts-warning">
            Push and the inbox are both off, so nothing can reach anyone. Turn one back on.
          </p>
        ) : null}
      </Card>

      {AUTOMATIC_GROUPS.map((group) => (
        <Card key={group.key}>
          <h2 className="pb-section-title">{group.label}</h2>
          <p className="muted">{group.blurb}</p>
          <div className="pb-alerts-switches">
            {group.items.map((item) => (
              <AlertSwitch
                key={item.key}
                checked={settings[item.key]}
                onChange={(value) => update({ [item.key]: value })}
                label={item.label}
                disabled={disabled}
              />
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
