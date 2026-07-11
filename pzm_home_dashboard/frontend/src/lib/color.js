// Readable-text helper for user-picked backgrounds. The dashboard is
// dark-mode only, so light text is the default everywhere; when the user
// paints a tile (or the whole dashboard) with a light colour, the text on
// top must flip to dark or it washes out.

// Dark page colour translucent backgrounds get composited onto before the
// luminance test — matches the enforced dark theme's --bg.
const DARK_BASE = { r: 15, g: 18, b: 22 };

// Parse '#rgb', '#rrggbb' or 'rgb(a)(…)' into {r,g,b,a}. Returns null for
// anything else ('glass', named colours, gradients) — callers keep the
// default text colour in that case.
export function parseColor(input) {
  if (typeof input !== 'string') return null;
  const s = input.trim();
  if (s.startsWith('#')) {
    const hex = s.slice(1);
    if (hex.length === 3) {
      const [r, g, b] = [...hex].map((c) => parseInt(c + c, 16));
      if ([r, g, b].some(Number.isNaN)) return null;
      return { r, g, b, a: 1 };
    }
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      if ([r, g, b].some(Number.isNaN)) return null;
      return { r, g, b, a: 1 };
    }
    return null;
  }
  const m = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (m) {
    return {
      r: Number(m[1]),
      g: Number(m[2]),
      b: Number(m[3]),
      a: m[4] === undefined ? 1 : Number(m[4]),
    };
  }
  return null;
}

// Same colour with its alpha channel scaled by `factor` (0–1). Unparseable
// input ('glass', gradients) comes back unchanged so the caller's
// background still applies, just without the fade.
export function withAlpha(input, factor) {
  const c = parseColor(input);
  if (!c) return input;
  const base = Number.isFinite(c.a) ? Math.max(0, Math.min(1, c.a)) : 1;
  const f = Number.isFinite(factor) ? Math.max(0, Math.min(1, factor)) : 1;
  const a = Math.round(base * f * 1000) / 1000;
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${a})`;
}

// Perceived luminance (0 dark – 1 light) of a colour as it actually renders:
// translucent colours are composited over the dark page first.
export function effectiveLuminance(input) {
  const c = parseColor(input);
  if (!c) return null;
  const a = Number.isFinite(c.a) ? Math.max(0, Math.min(1, c.a)) : 1;
  const r = c.r * a + DARK_BASE.r * (1 - a);
  const g = c.g * a + DARK_BASE.g * (1 - a);
  const b = c.b * a + DARK_BASE.b * (1 - a);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

// CSS variable overrides ({'--text': …, '--muted': …}) that keep text
// readable on `bg`, or null when the default light-on-dark text already
// works (dark, translucent or unparseable backgrounds).
export function textVarsFor(bg) {
  const lum = effectiveLuminance(bg);
  if (lum == null || lum < 0.55) return null;
  return { '--text': '#1c1f24', '--muted': '#4d5561' };
}
