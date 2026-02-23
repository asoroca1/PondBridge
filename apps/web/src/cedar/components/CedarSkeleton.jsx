import "./cedar-skeleton.css";

/**
 * Reusable skeleton loading components for cedar pages.
 *
 * Variants:
 *   <CedarSkeleton.Lines lines={3} />      — text placeholder lines
 *   <CedarSkeleton.Card />                 — card with avatar + lines
 *   <CedarSkeleton.Grid count={6} />       — grid of cards (for directory, photos)
 *   <CedarSkeleton.Page />                 — full page skeleton (header + grid)
 */

function Lines({ lines = 3 }) {
  return (
    <div className="cskel-lines">
      {Array.from({ length: lines }).map((_, i) => (
        <span
          key={i}
          className="cskel-line"
          style={{ width: i === lines - 1 ? "60%" : undefined }}
        />
      ))}
    </div>
  );
}

function Card() {
  return (
    <div className="cskel-card">
      <span className="cskel-avatar" />
      <div className="cskel-card-body">
        <span className="cskel-line" style={{ width: "55%" }} />
        <span className="cskel-line" style={{ width: "80%" }} />
        <span className="cskel-line" style={{ width: "40%" }} />
      </div>
    </div>
  );
}

function Grid({ count = 6 }) {
  return (
    <div className="cskel-grid">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} />
      ))}
    </div>
  );
}

function Page({ heading = true }) {
  return (
    <div className="cskel-page">
      {heading && (
        <div className="cskel-page-header">
          <span className="cskel-line cskel-line--lg" style={{ width: "35%" }} />
          <span className="cskel-line" style={{ width: "55%" }} />
        </div>
      )}
      <Grid count={6} />
    </div>
  );
}

const CedarSkeleton = { Lines, Card, Grid, Page };
export default CedarSkeleton;
