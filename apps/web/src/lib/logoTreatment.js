// How a camp logo should sit on the brand-colored navbar.
//
// Directors upload whatever their camp already has, and most camps have a JPEG or
// a flattened PNG: an emblem baked onto an opaque white square. Dropped straight
// onto a colored bar that reads as a white rectangle stuck to the logo. Knocking
// the white out to transparency is not the fix either -- a green mark on a green
// bar loses the contrast that the white was accidentally providing (Camp Green
// Lane's disc sits at 1.36:1 against its own brand color). So the white is kept
// and made deliberate: a circular or rounded chip the mark sits inside.
//
// A logo that already carries its own transparency is left exactly as it is.

export const LOGO_TREATMENTS = Object.freeze({
  AUTO: "auto",
  PLAIN: "plain",
  CIRCLE: "circle",
  ROUNDED: "rounded"
});

const CHIP_TREATMENTS = new Set([LOGO_TREATMENTS.CIRCLE, LOGO_TREATMENTS.ROUNDED]);

// Wider than this and a circle would crop a wordmark's ends, so it gets a
// rounded rectangle instead. Square-ish emblems -- crests, seals, roundels --
// take the circle.
const SQUARE_ASPECT_MIN = 0.8;
const SQUARE_ASPECT_MAX = 1.25;

function normalizeTreatment(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === LOGO_TREATMENTS.PLAIN) return LOGO_TREATMENTS.PLAIN;
  if (normalized === LOGO_TREATMENTS.CIRCLE) return LOGO_TREATMENTS.CIRCLE;
  if (normalized === LOGO_TREATMENTS.ROUNDED) return LOGO_TREATMENTS.ROUNDED;
  if (normalized === LOGO_TREATMENTS.AUTO) return LOGO_TREATMENTS.AUTO;
  return "";
}

/**
 * Turns the measurements taken at upload time into a treatment. Kept separate
 * from the pixel reading so the rules are testable without a canvas.
 */
export function classifyLogoBackdrop(measurement = {}) {
  const {
    backdropIsOpaque = false,
    borderIsUniformLight = false,
    contentWidth = 0,
    contentHeight = 0
  } = measurement;

  // Already cut out. Whatever the camp intended is what gets drawn.
  if (!backdropIsOpaque) return LOGO_TREATMENTS.PLAIN;

  // An opaque backdrop that is not near-white -- a dark tile, a colored banner --
  // is a deliberate part of the artwork far more often than it is an accident,
  // and a white chip around it would look worse than leaving it be.
  if (!borderIsUniformLight) return LOGO_TREATMENTS.PLAIN;

  const width = Math.max(0, Number(contentWidth) || 0);
  const height = Math.max(0, Number(contentHeight) || 0);
  if (!width || !height) return LOGO_TREATMENTS.PLAIN;

  const aspect = width / height;
  return aspect >= SQUARE_ASPECT_MIN && aspect <= SQUARE_ASPECT_MAX
    ? LOGO_TREATMENTS.CIRCLE
    : LOGO_TREATMENTS.ROUNDED;
}

/**
 * The treatment to render with. A director's explicit choice wins; "auto" (and
 * the absence of any setting) falls back to what detection recorded at upload.
 *
 * Tenants that predate detection have neither field, so they resolve to "plain"
 * -- the behavior they have today -- until the backfill records one.
 */
export function resolveLogoTreatment(tenant) {
  const branding = tenant?.config?.branding || tenant?.theme || {};
  const chosen = normalizeTreatment(branding.logoTreatment);
  if (chosen && chosen !== LOGO_TREATMENTS.AUTO) return chosen;

  const detected = normalizeTreatment(branding.logoBackdrop);
  if (detected && detected !== LOGO_TREATMENTS.AUTO) return detected;

  return LOGO_TREATMENTS.PLAIN;
}

export function isChipTreatment(treatment) {
  return CHIP_TREATMENTS.has(normalizeTreatment(treatment));
}

/** The class list for an <img> rendering a tenant logo. */
export function logoTreatmentClassName(treatment) {
  const normalized = normalizeTreatment(treatment);
  if (!isChipTreatment(normalized)) return "";
  return `is-logo-chip is-logo-chip-${normalized}`;
}
