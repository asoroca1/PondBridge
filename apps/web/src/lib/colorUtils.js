export function hexToHsl(hex) {
  const clean = String(hex || "").replace("#", "");
  if (clean.length !== 6) return [0, 0, 0];
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function hueToRgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

export function hslToHex(h, s, l) {
  const hNorm = ((h % 360) + 360) % 360 / 360;
  const sNorm = Math.max(0, Math.min(100, s)) / 100;
  const lNorm = Math.max(0, Math.min(100, l)) / 100;
  let r, g, b;
  if (sNorm === 0) {
    r = g = b = lNorm;
  } else {
    const q = lNorm < 0.5 ? lNorm * (1 + sNorm) : lNorm + sNorm - lNorm * sNorm;
    const p = 2 * lNorm - q;
    r = hueToRgb(p, q, hNorm + 1 / 3);
    g = hueToRgb(p, q, hNorm);
    b = hueToRgb(p, q, hNorm - 1 / 3);
  }
  const toHex = (v) => Math.round(v * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function linearizeSrgbChannel(channel) {
  const normalized = Math.max(0, Math.min(255, Number(channel) || 0)) / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex) {
  const clean = String(hex || "").replace("#", "");
  if (clean.length !== 6) return 0;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return (
    0.2126 * linearizeSrgbChannel(r) +
    0.7152 * linearizeSrgbChannel(g) +
    0.0722 * linearizeSrgbChannel(b)
  );
}

export function contrastRatio(baseHex, candidateHex) {
  const base = relativeLuminance(baseHex);
  const candidate = relativeLuminance(candidateHex);
  return (Math.max(base, candidate) + 0.05) / (Math.min(base, candidate) + 0.05);
}

/**
 * A neutral that belongs to the brand's own hue.
 *
 * Neutrals used to be produced by mixing the brand toward a fixed slate
 * constant, which tinted every palette blue — a brown camp got blue-grey
 * borders and muted text. Holding the hue and capping saturation keeps
 * neutrals in the brand family whatever the brand is, and leaves an
 * already-blue brand looking exactly as it did.
 */
export function brandNeutral(brandHex, { saturation = 14, lightness = 50 } = {}) {
  const [h, s] = hexToHsl(brandHex);
  return hslToHex(h, s === 0 ? 0 : Math.min(s, saturation), lightness);
}

/** Saturation/lightness stops for the shared `--neutral-*` custom properties. */
export const NEUTRAL_RAMP = {
  50: { saturation: 10, lightness: 97.5 },
  100: { saturation: 12, lightness: 95.5 },
  200: { saturation: 14, lightness: 90 },
  300: { saturation: 15, lightness: 81 },
  400: { saturation: 15, lightness: 65 },
  500: { saturation: 14, lightness: 47 },
  600: { saturation: 15, lightness: 37 },
  700: { saturation: 16, lightness: 28 },
  800: { saturation: 17, lightness: 19 },
  900: { saturation: 18, lightness: 11 }
};

export function neutralRampFor(brandHex) {
  const ramp = {};
  for (const [step, stop] of Object.entries(NEUTRAL_RAMP)) {
    ramp[step] = brandNeutral(brandHex, stop);
  }
  return ramp;
}

/**
 * White or a near-black in the brand's hue, whichever reads better on it.
 * The near-black is derived rather than a slate literal so dark text on a
 * light brand does not arrive tinted blue.
 */
export function readableTextColorOnBrand(brandHex) {
  const light = "#ffffff";
  const dark = brandNeutral(brandHex, { saturation: 18, lightness: 11 });
  return contrastRatio(brandHex, light) >= contrastRatio(brandHex, dark) ? light : dark;
}

export function generatePalette(primaryHex) {
  const [h, s, l] = hexToHsl(primaryHex);
  return {
    primary: primaryHex,
    dark: hslToHex(h, s, Math.max(8, l - 18)),
    light: hslToHex(h, Math.max(8, s - 20), Math.min(95, l + 38)),
    accent: hslToHex((h + 180) % 360, Math.min(85, s + 5), Math.max(40, Math.min(58, l))),
    warm: hslToHex((h + 30) % 360, Math.min(80, s), Math.max(35, Math.min(55, l)))
  };
}
