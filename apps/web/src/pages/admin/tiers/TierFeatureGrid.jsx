import { useMemo, useState } from "react";
import { Check } from "lucide-react";

/**
 * Feature access cascades upward: each module has one decision — the deepest
 * tier that gets it — rather than a checkbox per tier. Clicking a cell fills
 * every tier above it, so a lower tier can never hold a feature the tier above
 * it lacks, and the whole grid reads as a staircase.
 */
export default function TierFeatureGrid({ overview, actions, busy }) {
  const tiers = useMemo(() => overview?.tiers || [], [overview]);
  const modules = useMemo(() => overview?.modules || [], [overview]);
  const bottomRank = Number(overview?.bottomRank || 0);
  const [pendingKey, setPendingKey] = useState("");

  function summarise(floor) {
    if (!floor) return "Nobody";
    if (bottomRank && floor >= bottomRank) return "Every tier";
    if (floor === 1) return "Tier 1 only";
    return `Tiers 1–${floor}`;
  }

  async function setFloor(moduleKey, rank) {
    const current = modules.find((entry) => entry.key === moduleKey);
    if (!current) return;
    // Clicking the cell that already ends the run switches the feature off for
    // that tier, which is how a director reaches "nobody" without a separate
    // control.
    const nextFloor = current.floor === rank ? rank - 1 : rank;

    const floors = {};
    for (const entry of modules) floors[entry.key] = entry.floor;
    floors[moduleKey] = nextFloor;
    if (moduleKey === "directory") {
      for (const key of ["search", "relatedProfiles"]) {
        if (key in floors) floors[key] = Math.min(floors[key], nextFloor);
      }
    }

    setPendingKey(moduleKey);
    try {
      await actions.setSettings({ tierModules: floors });
    } finally {
      setPendingKey("");
    }
  }

  if (!tiers.length) {
    return <p className="muted">Add some tiers first, then decide what each one can use.</p>;
  }

  return (
    <div className="pb-tiers-grid-wrap">
      <p className="pb-tiers-grid-intro">
        Click the lowest tier that should get each feature — everything above it fills in
        automatically. Turning a feature off here hides it from those members entirely, including
        in the navigation.
      </p>

      <div className="pb-tiers-grid-scroll">
        <table className="pb-tiers-grid">
          <thead>
            <tr>
              <th scope="col">Feature</th>
              {tiers.map((tier) => (
                <th key={tier.id} scope="col" className="pb-tiers-grid-rank">
                  Tier {tier.rank}
                </th>
              ))}
              <th scope="col">Who gets it</th>
            </tr>
          </thead>
          <tbody>
            <tr className="pb-tiers-grid-row is-always">
              <th scope="row">
                <strong>Profile &amp; account</strong>
                <small>The floor every tier keeps</small>
              </th>
              {tiers.map((tier) => (
                <td key={tier.id}>
                  <span className="pb-tiers-cell is-on is-locked" aria-hidden="true">
                    <Check size={14} />
                  </span>
                </td>
              ))}
              <td className="pb-tiers-grid-summary">Always on</td>
            </tr>

            {modules.map((module) => {
              const disabled = !module.campEnabled;
              return (
                <tr
                  key={module.key}
                  className={`pb-tiers-grid-row ${disabled ? "is-camp-off" : ""}`.trim()}
                >
                  <th scope="row">
                    <strong>{module.label}</strong>
                    <small>
                      {disabled
                        ? "Turned off for the whole camp in Settings → Features"
                        : module.dependsOn?.length
                          ? `Needs ${module.dependsOn.join(", ")}`
                          : module.description}
                    </small>
                  </th>
                  {tiers.map((tier) => {
                    const on = !disabled && tier.rank <= module.floor;
                    return (
                      <td key={tier.id}>
                        <button
                          type="button"
                          className={`pb-tiers-cell ${on ? "is-on" : ""}`.trim()}
                          data-rank={tier.rank}
                          disabled={disabled || (busy === "settings" && pendingKey === module.key)}
                          aria-pressed={on}
                          aria-label={`${module.label} for Tier ${tier.rank} — ${on ? "on" : "off"}`}
                          title={
                            on
                              ? `${module.label} reaches Tier ${tier.rank}`
                              : `Extend ${module.label} down to Tier ${tier.rank}`
                          }
                          onClick={() => setFloor(module.key, tier.rank)}
                        >
                          {on ? <Check size={14} aria-hidden="true" /> : null}
                        </button>
                      </td>
                    );
                  })}
                  <td className={`pb-tiers-grid-summary ${module.floor ? "" : "is-none"}`.trim()}>
                    {disabled ? "Off for everyone" : summarise(module.floor)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="pb-tiers-hint">
        Advanced Search and Related Profiles read from the Member Directory, so they can never
        reach deeper than it does.
      </p>
    </div>
  );
}
