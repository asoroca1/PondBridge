import { useState } from "react";
import { Card, Input } from "@pondbridge/ui";
import { Layers, Plus, Trash2 } from "lucide-react";
import useAdminApi from "../useAdminApi.js";
import useTierAdmin from "./useTierAdmin.js";
import TierRosterView from "./TierRosterView.jsx";
import TierFeatureGrid from "./TierFeatureGrid.jsx";
import { tierDisplayName, tierOptionLabel } from "./tierNames.js";
import "../director-admin-tiers.css";

/**
 * The enforcement switch and the untagged default. A slim banner rather than a
 * card of its own: it is read once and touched rarely, so it should not compete
 * with the roster for space.
 */
function EnableBanner({ overview, actions, busy }) {
  const enabled = Boolean(overview?.enabled);
  const canEnable = Boolean(overview?.canEnable);
  const untagged = Number(overview?.untaggedCount || 0);
  const bottomRank = Number(overview?.bottomRank || 0);

  return (
    <div className={`pb-tiers-banner ${enabled ? "is-on" : ""}`.trim()}>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        className="pb-tiers-switch"
        disabled={busy === "settings" || (!enabled && !canEnable)}
        onClick={() => actions.setSettings({ enabled: !enabled })}
      >
        <span aria-hidden="true" />
      </button>

      <div className="pb-tiers-banner-copy">
        <strong>
          {enabled ? "On — members see their tier and below" : "Off — everyone sees everyone"}
        </strong>
        <small>
          {enabled
            ? untagged
              ? `${untagged.toLocaleString()} untagged ${untagged === 1 ? "person is" : "people are"} treated as Tier ${overview.untaggedRank}.`
              : "Every member has a tier."
            : canEnable
              ? "Nothing is hidden yet. Turning this on applies the tiers below across search, the directory, the map, chat, and posts."
              : overview?.reason || "Finish setting up before turning this on."}
        </small>
      </div>

      {overview?.tiers?.length ? (
        <label className="pb-tiers-untagged">
          <span>Untagged count as</span>
          <select
            value={String(overview.untaggedRank || bottomRank)}
            disabled={busy === "settings"}
            onChange={(event) => actions.setSettings({ untaggedRank: Number(event.target.value) })}
          >
            {overview.tiers.map((tier) => (
              <option key={tier.id} value={String(tier.rank)}>
                {tierOptionLabel(tier)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}

/**
 * The tiers, left to right, top rank first. Horizontal because the ladder is
 * reference material the director glances at while tagging — stacked in its own
 * column it became a second narrow rail crowding the one People already has.
 */
function TierBar({ overview, actions, busy, roster }) {
  const [editingId, setEditingId] = useState("");
  const [draftLabel, setDraftLabel] = useState("");
  const tiers = overview?.tiers || [];

  async function commitLabel(tier) {
    setEditingId("");
    if (draftLabel.trim() === String(tier.label || "").trim()) return;
    await actions.renameTier(tier.id, draftLabel.trim());
  }

  return (
    <div className="pb-tiers-bar">
      <div className="pb-tiers-bar-head">
        <p className="pb-tiers-bar-title">Tiers · 1 is the top</p>
        <p className="pb-tiers-bar-note">
          Each tier sees its own number and every number below it. Click a count to open a tier,
          a name to rename it. Members never see either.
        </p>
      </div>

      <ul className="pb-tiers-bar-list">
        {tiers.map((tier) => {
          const isOpen =
            roster.filters.scope === "tier" && Number(roster.filters.rank) === tier.rank;
          const removable = tier.isBottom && tiers.length > overview.limits.min;
          return (
            <li
              key={tier.id}
              className={`pb-tiers-tier ${isOpen ? "is-open" : ""}`.trim()}
              data-rank={tier.rank}
            >
              <span className="pb-tiers-tier-rank" aria-hidden="true">{tier.rank}</span>

              {editingId === tier.id ? (
                <Input
                  autoFocus
                  className="pb-tiers-tier-input"
                  value={draftLabel}
                  onChange={(event) => setDraftLabel(event.target.value)}
                  onBlur={() => commitLabel(tier)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commitLabel(tier);
                    if (event.key === "Escape") setEditingId("");
                  }}
                  aria-label={`Name for Tier ${tier.rank}`}
                />
              ) : (
                <button
                  type="button"
                  className="pb-tiers-tier-name"
                  title={
                    tier.isTop
                      ? "Sees every tier"
                      : tier.isBottom
                        ? `Sees tier ${tier.rank} only`
                        : `Sees tiers ${tier.seesFrom}–${tier.seesTo}`
                  }
                  onClick={() => {
                    setEditingId(tier.id);
                    setDraftLabel(String(tier.label || ""));
                  }}
                >
                  {tierDisplayName(tier)}
                </button>
              )}

              <button
                type="button"
                className="pb-tiers-tier-count"
                aria-pressed={isOpen}
                title={`Show the ${tier.memberCount} in Tier ${tier.rank}`}
                aria-label={`Show the ${tier.memberCount} people in Tier ${tier.rank}`}
                onClick={() => roster.showTier(tier.rank)}
              >
                {tier.memberCount.toLocaleString()}
              </button>

              {removable ? (
                <button
                  type="button"
                  className="pb-tiers-tier-remove"
                  title={`Remove Tier ${tier.rank}`}
                  aria-label={`Remove Tier ${tier.rank}`}
                  onClick={() => actions.removeTier(tier.id)}
                >
                  <Trash2 size={13} aria-hidden="true" />
                </button>
              ) : null}
            </li>
          );
        })}

        {tiers.length < (overview?.limits?.max || 6) ? (
          <li>
            <button
              type="button"
              className="pb-tiers-add"
              disabled={busy === "add-tier"}
              onClick={() => actions.addTier()}
            >
              <Plus size={14} aria-hidden="true" />
              Add a tier
            </button>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

/**
 * People → Tiers. One surface, two jobs: tag the roster, then decide what each
 * tier can use. Nothing here affects members until the switch is turned on.
 */
export default function TiersWorkspace() {
  const { request } = useAdminApi();
  const tiers = useTierAdmin({ request });
  const [view, setView] = useState("tag");

  if (tiers.loading) return <Card><p className="muted">Loading tiers…</p></Card>;

  if (!tiers.available) {
    return (
      <Card className="pb-tiers-unavailable">
        <Layers aria-hidden="true" />
        <h2>Tiered access is switched off</h2>
        <p className="muted">
          Turn on <strong>Tiered access</strong> in Settings → Features to divide your network into
          numbered tiers. Until then nothing about your community changes.
        </p>
      </Card>
    );
  }

  const overview = tiers.overview;

  return (
    <Card className="pb-tiers">
      <EnableBanner overview={overview} actions={tiers.actions} busy={tiers.busy} />
      <TierBar
        overview={overview}
        actions={tiers.actions}
        busy={tiers.busy}
        roster={tiers.roster}
      />

      <div className="pb-tiers-views" role="tablist" aria-label="Tiers views">
        <button
          type="button"
          role="tab"
          aria-selected={view === "tag"}
          onClick={() => setView("tag")}
        >
          Tag people
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "features"}
          onClick={() => setView("features")}
        >
          Feature access
        </button>
      </div>

      {tiers.error ? <p className="error-text" role="alert">{tiers.error}</p> : null}

      {view === "tag" ? (
        <TierRosterView
          overview={overview}
          roster={tiers.roster}
          actions={tiers.actions}
          busy={tiers.busy}
        />
      ) : (
        <TierFeatureGrid overview={overview} actions={tiers.actions} busy={tiers.busy} />
      )}
    </Card>
  );
}
