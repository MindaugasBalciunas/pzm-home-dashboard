import { memo, useEffect, useRef, useState } from 'react';
import { startPolling } from '../lib/poll.js';
import { tilePlacementStyle } from '../lib/placement.js';
import { TileIcon } from './SimpleTile.jsx';

const POLL_MS = 5000;

// Preset-name → icon-catalog key. TrackMix preset names are free text, so
// match common English / Lithuanian location words; anything unmatched
// falls back to the PTZ camera glyph. First match wins — order specific
// words (gate/garage) before generic ones (door).
const PRESET_ICONS = [
  [/garaž|garaz|garage/i, 'garage'],
  [/gate|vart/i, 'gate'],
  [/garden|sod|šiltnam|siltnam|green ?house/i, 'garden'],
  [/yard|kiem/i, 'tree'],
  [/street|gatv/i, 'sign'],
  [/car|auto|mašin|masin|drive/i, 'car'],
  [/pool|basein/i, 'pool'],
  [/terra|teras|patio/i, 'awning'],
  [/house|home|nam/i, 'door'],
  [/door|dur/i, 'door'],
  [/play|žaid|zaid|kid|vaik/i, 'stroller'],
  [/track|follow|auto ?scan|patrol/i, 'radar'],
];

function presetIcon(name) {
  for (const [re, key] of PRESET_ICONS) {
    if (re.test(name)) return key;
  }
  return 'camera-ptz';
}

// Camera PTZ preset card. Lists the options of the configured select
// entity (TrackMix position presets) as icon buttons; tapping one calls
// select.select_option so the camera drives to that preset. The active
// option (the select's current state) is highlighted.
function PtzCard({ col, row, colSpan, rowSpan, editMode, onStartMove, onStartResize }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
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
      className={`tile ptz-tile${editMode ? ' tile-editing' : ''}`}
      style={style}
      onPointerDown={editMode ? (e) => e.button === 0 && onStartMove(e) : undefined}
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
                    <TileIcon iconKey={presetIcon(opt)} domain="camera" on={active} />
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
