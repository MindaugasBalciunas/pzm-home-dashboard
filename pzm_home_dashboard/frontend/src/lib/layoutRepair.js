// Heals known data-level defects in stored layouts (server copy, SSE
// snapshots, uploaded backups) before they render or persist:
//
//   1. Mojibake text. Some historical layouts hold UTF-8 text that was
//      mis-decoded as Latin-1 at save time — most visibly '°C' stored as
//      'Â°C', which then shadows the live HA unit on number tiles.
//   2. Renamed HA entities. Tile specs (and old seeded templates) can point
//      at entity ids that no longer exist in Home Assistant, leaving the
//      tile permanently stateless.
//
// Repair is idempotent: running it over an already-clean layout returns the
// same object (`changed: false`), so callers can persist only when needed.

// Entities renamed in Home Assistant since older layouts/templates were
// saved. Extend this map when a device gets re-registered under a new id.
const ENTITY_RENAMES = {
  'light.garage_rgbic_led': 'light.garage_led_strip',
};

// A Latin-1 mis-decode of UTF-8 always yields 0xC2/0xC3 followed by a
// continuation byte (0x80-0xBF) for the Latin-1 range — 'Â°', 'Ã©', …
const MOJIBAKE_HINT = /[\u00c2\u00c3][\u0080-\u00bf]/;

function fixMojibake(value) {
  if (typeof value !== 'string' || !MOJIBAKE_HINT.test(value)) return value;
  // Only a pure Latin-1 string can be a byte-for-byte mis-decode; anything
  // holding real multi-byte characters is left alone.
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) > 0xff) return value;
  }
  const bytes = Uint8Array.from(value, (c) => c.charCodeAt(0));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // Not valid UTF-8 after all — the 'Â'/'Ã' was genuine text.
    return value;
  }
}

// Returns the original spec object when nothing changed, so identity checks
// upstream can skip cloning untouched tiles.
function repairSpec(spec) {
  let changed = false;
  const out = { ...spec };
  for (const [key, value] of Object.entries(out)) {
    const fixed = fixMojibake(value);
    if (fixed !== value) {
      out[key] = fixed;
      changed = true;
    }
  }
  const renamed = ENTITY_RENAMES[out.entityId];
  if (renamed) {
    out.entityId = renamed;
    changed = true;
  }
  return changed ? out : spec;
}

export function repairLayout(layout) {
  if (!layout || typeof layout !== 'object' || Array.isArray(layout)) {
    return { layout, changed: false };
  }
  let changed = false;
  const out = {};
  for (const [id, entry] of Object.entries(layout)) {
    if (entry && typeof entry === 'object' && entry.spec && typeof entry.spec === 'object') {
      const spec = repairSpec(entry.spec);
      if (spec !== entry.spec) {
        out[id] = { ...entry, spec };
        changed = true;
        continue;
      }
    }
    out[id] = entry;
  }
  return changed ? { layout: out, changed: true } : { layout, changed: false };
}
