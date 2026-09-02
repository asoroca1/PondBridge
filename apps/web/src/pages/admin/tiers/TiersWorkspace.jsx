import { useState } from "react";
import { Button, Card, Input } from "@pondbridge/ui";
import { Layers, Plus, Trash2 } from "lucide-react";
import useAdminApi from "../useAdminApi.js";
import useTierAdmin from "./useTierAdmin.js";
import TierRosterView from "./TierRosterView.jsx";
import TierFeatureGrid from "./TierFeatureGrid.jsx";
import "../director-admin-tiers.css";

function TierLadder({ overview, actions, busy }) {
  const [editingId, setEditingId] = useState("");
  const [draftLabel, setDraftLabel] = useState("");
  const tiers = overview?.tiers || [];

  async function commitLabel(tier) {
    setEditingId("");
    if (draftLabel.trim() === String(tier.label || "").trim()) return;
    await actions.renameTier(tier.id, draftLabel.trim());
  }

  return (
    <div className="pb-tiers-ladder">
      <p className="pb-tiers-rail-title">Tiers · 1 is the top</p>
      <ul>
        {tiers.map((tier) => (
          <li key={tier.id} className="pb-tiers-ladder-row" data-rank={tier.rank}>
            <i aria-hidden="true">{tier.rank}</i>
            <span>
              {editingId === tier.id ? (
                <Input
                  autoFocus
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
                  className="pb-tiers-ladder-name"
                  onClick={() => {
                    setEditingId(tier.id);
                    setDraftLabel(String(tier.label || ""));
                  }}
                >
                  {tier.label || `Tier ${tier.rank}`}
                </button>
              )}
              <small>
                {tier.isTop
                  ? "Sees every tier"
                  : tier.isBottom
                    ? `Sees tier ${tier.rank} only`
                    : `Sees tiers ${tier.seesFrom}–${tier.seesTo}`}
              </small>
            </span>
            <b>{tier.memberCount.toLocaleString()}</b>
            {tier.isBottom && tiers.length > overview.limits.min ? (
              <button
                type="button"
                className="pb-tiers-ladder-remove"
                title={`Remove Tier ${tier.rank}`}
                aria-label={`Remove Tier ${tier.rank}`}
                onClick={() => actions.removeTier(tier.id)}
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {tiers.length < overview.limits.max ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={busy === "add-tier"}
          onClick={() => actions.addTier()}
        >
          <Plus size={14} aria-hidden="true" />
          Add a tier below
        </Button>
      ) : null}
      <p className="pb-tiers-rail-note">
        Click a name to rename it. Members never see the number or the name — it is only how you
        keep track.
      </p>
    </div>
  );
}

function EnableCard({ overview, actions, busy }) {
  const enabled = Boolean(overview?.enabled);
  const canEnable = Boolean(overview?.canEnable);
  const untagged = Number(overview?.untaggedCount || 0);
  const bottomRank = Number(overview?.bottomRank || 0);

  return (
    <Card className="pb-tiers-enable">
      <div className="pb-tiers-enable-main">
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
        <div>
          <strong>{enabled ? "On — members see their tier and below" : "Off — everyone sees everyone"}</strong>
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
      </div>

      {overview?.tiers?.length ? (
        <label className="pb-tiers-untagged">
          <span>Untagged members count as</span>
          <select
            value={String(overview.untaggedRank || bottomRank)}
            disabled={busy === "settings"}
            onChange={(event) => actions.setSettings({ untaggedRank: Number(event.target.value) })}
          >
            {overview.tiers.map((tier) => (
              <option key={tier.id} value={String(tier.rank)}>
                Tier {tier.rank}{tier.label ? ` · ${tier.label}` : ""}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </Card>
  );
}

/**
 * People → Tiers. One tab, two jobs: tag the roster, then decide what each tier
 * can use. Nothing here affects members until the switch above is turned on.
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
    <div className="pb-tiers">
      <div className="pb-tiers-side">
        <EnableCard overview={overview} actions={tiers.actions} busy={tiers.busy} />
        <Card>
          <TierLadder overview={overview} actions={tiers.actions} busy={tiers.busy} />
        </Card>
      </div>

      <Card className="pb-tiers-main">
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
    </div>
  );
}
