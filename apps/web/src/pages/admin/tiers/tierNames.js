/**
 * How a tier reads in a menu. The number is the identity and the label is the
 * camp's own word for it, so the two are only joined when the label actually
 * adds something — otherwise a tier the director never renamed would read
 * "Tier 1 · Tier 1".
 */
export function tierOptionLabel(tier = {}) {
  const rank = Number(tier?.rank);
  const base = `Tier ${Number.isFinite(rank) ? rank : ""}`.trim();
  const label = String(tier?.label || "").trim();
  if (!label || label.toLowerCase() === base.toLowerCase()) return base;
  return `${base} · ${label}`;
}

/** The tier's display name on its own, for the ladder. */
export function tierDisplayName(tier = {}) {
  const rank = Number(tier?.rank);
  const label = String(tier?.label || "").trim();
  return label || `Tier ${Number.isFinite(rank) ? rank : ""}`.trim();
}
