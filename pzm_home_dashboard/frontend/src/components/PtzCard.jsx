import { memo, useEffect, useRef, useState } from 'react';
import { startPolling } from '../lib/poll.js';
import { tilePlacementStyle } from '../lib/placement.js';

const POLL_MS = 5000;

// Preset-name → outline-icon key (OUTLINE_ICONS below). TrackMix preset
// names are free text, so match common English / Lithuanian location
// words; anything unmatched falls back to the PTZ camera glyph. First
// match wins — order specific words (gate/garage) before generic ones
// (door/house).
const PRESET_ICONS = [
  [/garaž|garaz|garage/i, 'garage'],
  [/gate|vart/i, 'gate'],
  [/garden|sod|šiltnam|siltnam|green ?house/i, 'garden'],
  [/yard|kiem/i, 'tree'],
  [/street|gatv/i, 'street'],
  [/car|auto|mašin|masin|drive/i, 'car'],
  [/pool|basein/i, 'pool'],
  [/terra|teras|patio/i, 'terrace'],
  [/house|home|nam/i, 'house'],
  [/door|dur/i, 'door'],
  [/play|žaid|zaid|kid|vaik/i, 'ball'],
  [/track|follow|auto ?scan|patrol/i, 'track'],
];

function presetIcon(name) {
  for (const [re, key] of PRESET_ICONS) {
    if (re.test(name)) return key;
  }
  return 'camera';
}

// Dedicated outline icon set for the preset buttons — thin rounded
// strokes instead of the filled tile-catalog glyphs, so the overlay reads
// light and modern over the video.
const OUTLINE_ICONS = {
  gate: [
    'M4 21V8.5', 'M20 21V8.5',
    'M4 10.5C6.4 7.8 9.1 6.5 12 6.5s5.6 1.3 8 4',
    'M8 21v-9.4', 'M12 21V10.4', 'M16 21v-9.4', 'M3 21h18',
  ],
  garage: [
    'M3 21V9.5L12 4l9 5.5V21',
    'M6.5 21v-8h11v8', 'M6.5 16h11', 'M6.5 18.5h11',
  ],
  garden: [
    'M12 21v-7',
    'M9 18.5c-2.8 0-4.6-1.5-5.2-3.9 2.7-.5 4.5.5 5.6 2.2',
    'M12 14c-2.7 0-4.4-2.2-4.4-4.9V6.3l2.2 1.5L12 5.6l2.2 2.2 2.2-1.5v2.8c0 2.7-1.7 4.9-4.4 4.9z',
  ],
  tree: [
    'M12 21v-4.8',
    'M12 16.2c-3.2 0-5.6-2.1-5.6-5 0-2 1.2-3.7 3-4.4C9.8 4.6 10.8 3 12 3s2.2 1.6 2.6 3.8c1.8.7 3 2.4 3 4.4 0 2.9-2.4 5-5.6 5z',
  ],
  street: [
    'M9 21h6', 'M12 21V8.5',
    'M8.6 8.5h6.8L14.1 3.8H9.9z',
    'M12 3.8V2.4',
    'M6.6 6.6 5.2 5.6', 'M17.4 6.6l1.4-1',
  ],
  car: [
    'M5 17H3.5v-3.2c0-.6.2-1.2.5-1.6l2-3.1C6.4 8.4 7.1 8 7.9 8h8.2c.8 0 1.5.4 1.9 1.1l2 3.1c.3.4.5 1 .5 1.6V17H19',
    'M9 17h6', 'M6.3 9.7h11.4',
    'M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', 'M17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  ],
  pool: [
    'M9 15.5V6.8a1.8 1.8 0 0 1 3.6 0V7', 'M14.5 15.5V6.8a1.8 1.8 0 0 1 3.6 0V7',
    'M9 9.2h5.5', 'M9 12.4h5.5',
    'M3 18c1.5 1.3 3 1.3 4.5 0s3-1.3 4.5 0 3 1.3 4.5 0 3-1.3 4.5 0',
  ],
  terrace: [
    'M12 3c4.8 0 8.6 3.4 8.6 7.6H3.4C3.4 6.4 7.2 3 12 3z',
    'M7.2 10.6c0-4 1.9-7 4.8-7.4', 'M16.8 10.6c0-4-1.9-7-4.8-7.4',
    'M12 10.6v7.9a2.1 2.1 0 0 0 4.2 0',
  ],
  house: [
    'M4 21V10.8L12 4.5l8 6.3V21',
    'M9.5 21v-6.2h5V21', 'M3 21h18',
  ],
  door: [
    'M6.5 21V4.8A1.8 1.8 0 0 1 8.3 3h7.4a1.8 1.8 0 0 1 1.8 1.8V21',
    'M4.5 21h15', 'M14.4 12.4h.01',
  ],
  ball: [
    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
    'M12 3c2.5 2.3 3.8 5.3 3.8 9s-1.3 6.7-3.8 9',
    'M12 3C9.5 5.3 8.2 8.3 8.2 12s1.3 6.7 3.8 9',
    'M3.5 9.5h17', 'M3.5 14.5h17',
  ],
  track: [
    'M12 17.5a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4z',
    'M8.2 12.2a5.4 5.4 0 0 1 7.6 0',
    'M5.3 9a9.5 9.5 0 0 1 13.4 0',
    'M12.9 15.3l4-5.2',
  ],
  camera: [
    'M3.5 6h17',
    'M6 6l1.4 6.2a4.8 4.8 0 0 0 9.2 0L18 6',
    'M12 12.6a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2z',
  ],
};

function PresetIcon({ kind }) {
  const paths = OUTLINE_ICONS[kind] || OUTLINE_ICONS.camera;
  return (
    <svg className="ptz-preset-icon" viewBox="0 0 24 24" aria-hidden>
      {paths.map((d) => <path key={d} d={d} />)}
    </svg>
  );
}

// How long the overlay stays readable after the last interaction before
// ghosting back over the camera view.
const WAKE_MS = 6000;

// Camera PTZ preset card, designed to sit ON TOP of the camera view
// (drag it over the TrackMix tile with "Snap to grid" off). It idles as a
// near-invisible ghost (5% opacity); the first tap anywhere on it wakes
// it to 60% so the presets are readable — that tap never fires a preset —
// and it fades back after a few idle seconds. Presets render as icon
// buttons in a single row; tapping one calls select.select_option and the
// active option (the select's current state) is highlighted.
function PtzCard({ col, row, colSpan, rowSpan, editMode, onStartMove, onStartResize }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [awake, setAwake] = useState(false);
  const awakeRef = useRef(false);
  useEffect(() => { awakeRef.current = awake; }, [awake]);
  const wakeTimerRef = useRef(null);
  // True when the current tap landed while the card was still a ghost —
  // that tap only wakes the card, it must not trigger a preset.
  const wakeTapRef = useRef(false);
  const wake = () => {
    setAwake(true);
    if (wakeTimerRef.current) clearTimeout(wakeTimerRef.current);
    wakeTimerRef.current = setTimeout(() => setAwake(false), WAKE_MS);
  };
  useEffect(() => () => {
    if (wakeTimerRef.current) clearTimeout(wakeTimerRef.current);
  }, []);
  // Skip re-renders while nothing changed (same trick as the Solar card):
  // compare the raw payload before parsing.
  const lastPayloadRef = useRef('');

  useEffect(() => startPolling(async () => {
    try {
      const r = await fetch('api/ha/ptz');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const text = await r.text();
      setError(null);
      if (text === lastPayloadRef.current) return;
      lastPayloadRef.current = text;
      setData(JSON.parse(text));
    } catch (e) {
      setError(String(e));
    }
  }, POLL_MS), []);

  const select = async (option) => {
    // The tap that woke the ghost is consumed — selecting a preset you
    // couldn't see would drive the camera blindly.
    if (wakeTapRef.current) { wakeTapRef.current = false; return; }
    wake();
    if (busy) return;
    setBusy(option);
    try {
      const r = await fetch('api/ha/ptz/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ option }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setError(null);
      // Optimistic highlight — the camera takes a moment to report the new
      // preset; clear the payload cache so the next poll refreshes for real.
      setData((prev) => (prev ? { ...prev, state: option } : prev));
      lastPayloadRef.current = '';
    } catch (e) {
      setError(String(e));
    } finally {
      setTimeout(() => setBusy(null), 900);
    }
  };

  const style = tilePlacementStyle(col, row, colSpan, rowSpan);
  const options = Array.isArray(data?.options) ? data.options : [];
  const configured = data ? data.configured !== false : true;

  return (
    <div
      className={`tile ptz-tile ptz-overlay${awake ? ' ptz-awake' : ''}${editMode ? ' tile-editing' : ''}`}
      style={style}
      onPointerDown={editMode
        ? (e) => e.button === 0 && onStartMove(e)
        : () => {
          // Fresh per tap: a ghost tap is a wake-only tap; an awake tap
          // just resets the fade timer and lets the click through.
          wakeTapRef.current = !awakeRef.current;
          wake();
        }}
      title={data?.entityId || 'PTZ presets'}
    >
      <div className="ptz-inner">
        <div className="ptz-title">Camera PTZ</div>
        {error && <div className="solar-note solar-note-error">Fetch error</div>}
        {!error && !configured && (
          <div className="solar-note">Set Home Assistant token in appsettings.json to see PTZ presets.</div>
        )}
        {!error && configured && data && options.length === 0 && (
          <div className="solar-note">
            No presets on {data.entityId || 'the PTZ select entity'}.
          </div>
        )}
        {options.length > 0 && (
          <div className="ptz-grid">
            {options.map((opt) => {
              const active = data?.state === opt;
              return (
                <button
                  key={opt}
                  type="button"
                  className={`ptz-btn ${active ? 'is-active' : ''}`}
                  disabled={editMode || !!busy}
                  onClick={() => select(opt)}
                  title={opt}
                >
                  <span className="ptz-btn-icon">
                    <PresetIcon kind={presetIcon(opt)} />
                  </span>
                  <span className="ptz-btn-name">{busy === opt ? 'Moving…' : opt}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      {editMode && (
        <>
          <div className="tile-edit-top">
            <span className="tile-edit-name">Camera PTZ</span>
            <span className="tile-edit-size">{colSpan}×{rowSpan}</span>
          </div>
          <div className="tile-resize" onPointerDown={(e) => e.button === 0 && onStartResize(e)} />
        </>
      )}
    </div>
  );
}

export default memo(PtzCard);
