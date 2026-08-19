/**
 * Email chrome derived from a camp's brand colour.
 *
 * Email HTML cannot use CSS custom properties, so the templates used to inline
 * a fixed navy palette — every camp's outbound mail carried Cedar's blue no
 * matter what brand it had chosen. These helpers mirror the web's
 * lib/colorUtils.js so a brown camp gets brown chrome in its email too.
 */

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function normalizeHex(value = "", fallback = "#404040") {
  const raw = String(value || "").trim();
  if (!HEX.test(raw)) return fallback;
  if (raw.length === 4) {
    return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`.toLowerCase();
  }
  return raw.toLowerCase();
}

function toRgb(hex) {
  const c = normalizeHex(hex).slice(1);
  return [0, 2, 4].map((i) => Number.parseInt(c.slice(i, i + 2), 16));
}

function toHex([r, g, b]) {
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, "0")).join("")}`;
}

function rgbToHsl([r, g, b]) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return [0, 0, l * 100];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [(h / 6) * 360, s * 100, l * 100];
}

function hslToHex(h, s, l) {
  const H = (((h % 360) + 360) % 360) / 360;
  const S = Math.max(0, Math.min(100, s)) / 100;
  const L = Math.max(0, Math.min(100, l)) / 100;
  if (!S) return toHex([L * 255, L * 255, L * 255]);
  const q = L < 0.5 ? L * (1 + S) : L + S - L * S;
  const p = 2 * L - q;
  const channel = (t) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return toHex([channel(H + 1 / 3) * 255, channel(H) * 255, channel(H - 1 / 3) * 255]);
}

function mix(hexA, hexB, weight) {
  const a = toRgb(hexA);
  const b = toRgb(hexB);
  const w = Math.max(0, Math.min(1, weight));
  return toHex(a.map((v, i) => v + (b[i] - v) * w));
}

/** A neutral in the brand's own hue rather than a fixed slate. */
export function brandNeutral(brandHex, { saturation = 14, lightness = 50 } = {}) {
  const [h, s] = rgbToHsl(toRgb(brandHex));
  return hslToHex(h, s === 0 ? 0 : Math.min(s, saturation), lightness);
}

function luminance(hex) {
  const lin = (c) => {
    const n = c / 255;
    return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = toRgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function readableOn(hex) {
  const dark = brandNeutral(hex, { saturation: 18, lightness: 11 });
  const contrast = (a, b) => {
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };
  return contrast(hex, "#ffffff") >= contrast(hex, dark) ? "#ffffff" : dark;
}

/** The full set of colours an email layout needs, all tied to the brand. */
export function buildEmailPalette(brandPrimary = "#404040") {
  const primary = normalizeHex(brandPrimary);
  return {
    primary,
    primaryStrong: mix(primary, "#000000", 0.24),
    onPrimary: readableOn(primary),
    accent: primary,
    page: brandNeutral(primary, { saturation: 10, lightness: 96 }),
    surface: "#ffffff",
    border: brandNeutral(primary, { saturation: 14, lightness: 88 }),
    borderSoft: brandNeutral(primary, { saturation: 12, lightness: 93 }),
    wash: mix(primary, "#ffffff", 0.93),
    text: brandNeutral(primary, { saturation: 18, lightness: 13 }),
    textMuted: brandNeutral(primary, { saturation: 14, lightness: 45 })
  };
}
