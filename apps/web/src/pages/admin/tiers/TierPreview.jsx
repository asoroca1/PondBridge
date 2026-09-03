import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Eye, Minus } from "lucide-react";
import { tierOptionLabel } from "./tierNames.js";

function Stat({ label, visible, total }) {
  const hidden = Math.max(0, Number(total || 0) - Number(visible || 0));
  return (
    <div className={`pb-tiers-stat ${hidden ? "is-reduced" : ""}`.trim()}>
      <strong>
        {Number(visible || 0).toLocaleString()}
        <span> of {Number(total || 0).toLocaleString()}</span>
      </strong>
      <small>{label}</small>
      {hidden ? <em>{hidden.toLocaleString()} hidden</em> : null}
    </div>
  );
}

/**
 * A dry run of a tier. Without this the only way to find out what Tier 3 can
 * reach is to switch tiering on over real members and watch what happens, so
 * everything here is read-only and nothing it reports depends on the switch.
 */
export default function TierPreview({ overview, request }) {
  const tiers = useMemo(() => overview?.tiers || [], [overview]);
  const [rank, setRank] = useState(() => (tiers.length ? tiers[tiers.length - 1].rank : 0));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(
    async (nextRank) => {
      if (!nextRank) return;
      setLoading(true);
      setError("");
      try {
        setData(await request(`/tiers/preview?rank=${nextRank}`));
      } catch (requestError) {
        setError(requestError.message || "Could not build the preview.");
        setData(null);
      } finally {
        setLoading(false);
      }
    },
    [request]
  );

  useEffect(() => { load(rank); }, [load, rank]);

  if (!tiers.length) {
    return <p className="muted">Add some tiers first, then preview what each one can reach.</p>;
  }

  const lostFeatures = (data?.features || []).filter((feature) => !feature.available);

  return (
    <div className="pb-tiers-preview">
      <div className="pb-tiers-preview-head">
        <Eye size={15} aria-hidden="true" />
        <span>See the network as</span>
        <span className="pb-tiers-preview-picks" role="group" aria-label="Preview a tier">
          {tiers.map((tier) => (
            <button
              key={tier.id}
              type="button"
              className="pb-tiers-chip"
              data-rank={tier.rank}
              aria-pressed={tier.rank === rank}
              onClick={() => setRank(tier.rank)}
            >
              {tier.rank}
            </button>
          ))}
        </span>
        <small>
          {tierOptionLabel(tiers.find((tier) => tier.rank === rank) || {})} · nothing here changes
          anything
        </small>
      </div>

      {error ? <p className="error-text" role="alert">{error}</p> : null}
      {loading && !data ? <p className="muted">Working it out…</p> : null}

      {data ? (
        <>
          {data.isTop ? (
            <p className="pb-tiers-preview-note">
              Tier {data.rank} is the top tier, so it reaches the whole network. Preview a lower
              tier to see what gets held back.
            </p>
          ) : null}

          <div className="pb-tiers-stats">
            <Stat label="People" visible={data.people?.visible} total={data.people?.total} />
            <Stat label="Photos" visible={data.photos?.visible} total={data.photos?.total} />
            <Stat label="Forums" visible={data.forums?.visible} total={data.forums?.total} />
            <Stat label="Feed posts" visible={data.activity?.visible} total={data.activity?.total} />
            <Stat
              label="Family trees"
              visible={data.familyTrees?.visible}
              total={data.familyTrees?.total}
            />
          </div>

          <div className="pb-tiers-preview-cols">
            <section>
              <h3>Features</h3>
              {lostFeatures.length ? (
                <ul className="pb-tiers-preview-list">
                  {lostFeatures.map((feature) => (
                    <li key={feature.key}>
                      <Minus size={13} aria-hidden="true" />
                      {feature.label}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="pb-tiers-preview-ok">
                  <Check size={14} aria-hidden="true" />
                  Everything the camp has switched on.
                </p>
              )}
            </section>

            <section>
              <h3>People held back</h3>
              {data.hiddenSample?.length ? (
                <>
                  <ul className="pb-tiers-preview-list">
                    {data.hiddenSample.map((name) => (
                      <li key={name}>
                        <Minus size={13} aria-hidden="true" />
                        {name}
                      </li>
                    ))}
                  </ul>
                  {data.hiddenTotal > data.hiddenSample.length ? (
                    <p className="muted pb-tiers-preview-more">
                      and {(data.hiddenTotal - data.hiddenSample.length).toLocaleString()} more
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="pb-tiers-preview-ok">
                  <Check size={14} aria-hidden="true" />
                  Nobody — this tier reaches every member.
                </p>
              )}
            </section>
          </div>
        </>
      ) : null}
    </div>
  );
}
