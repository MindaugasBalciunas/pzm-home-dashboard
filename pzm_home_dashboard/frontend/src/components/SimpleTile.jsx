import { useCallback, useEffect, useRef, useState } from 'react';

const POLL_MS = 5000;

function isOnState(s) {
  if (s == null) return null;
  const v = String(s).toLowerCase();
  if (v === 'on' || v === 'open' || v === 'opened' || v === 'unlocked' || v === 'playing' || v === 'active') return true;
  if (v === 'off' || v === 'closed' || v === 'locked' || v === 'idle' || v === 'paused') return false;
  return null;
}

function formatNumber(state, unit) {
  if (state == null || state === '' || state === 'unknown' || state === 'unavailable') return { n: '—', u: '' };
  const num = Number(state);
  if (!Number.isFinite(num)) return { n: String(state), u: unit || '' };
  let precision = 0;
  if (Math.abs(num) < 1) precision = 2;
  else if (Math.abs(num) < 10) precision = 2;
  else if (Math.abs(num) < 100) precision = 1;
  return { n: num.toFixed(precision), u: unit || '' };
}

export default function SimpleTile({
  id,
  spec,
  col,
  row,
  colSpan,
  rowSpan,
  editMode,
  onStartMove,
  onStartResize,
  onRemove,
  onEdit,
}) {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('api/ha/entity/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [spec.entityId] }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      const first = Array.isArray(data) ? data[0] : null;
      setState(first || null);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [spec.entityId]);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const trigger = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch('api/ha/entity/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityId: spec.entityId }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setTimeout(load, 700);
    } catch (e) {
      setError(String(e));
    } finally {
      setTimeout(() => setBusy(false), 800);
    }
  };

  const style = {
    gridColumn: `${col} / span ${colSpan}`,
    gridRow: `${row} / span ${rowSpan}`,
  };

  const on = isOnState(state?.state);
  const stateText = state?.state && state.state !== 'unknown' && state.state !== 'unavailable'
    ? String(state.state)
    : '—';

  const stopPropagation = (e) => { e.stopPropagation(); e.preventDefault?.(); };
  const editHeader = editMode && (
    <>
      <div className="tile-edit-top">
        <span className="tile-edit-name">{spec.name}</span>
        <span className="tile-edit-size">{colSpan}×{rowSpan}</span>
        <button
          type="button"
          className="tile-edit-icon-btn"
          title="Edit tile"
          onPointerDown={stopPropagation}
          onClick={(e) => { e.stopPropagation(); onEdit?.(id); }}
          aria-label="Edit tile"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
            <path fill="currentColor" d="M14.06 4.94l3 3-9 9H5v-3l9-9zm2-2l1.94-1.94a1 1 0 0 1 1.41 0l1.59 1.59a1 1 0 0 1 0 1.41L19.06 6l-3-3z"/>
          </svg>
        </button>
        <button
          type="button"
          className="tile-edit-icon-btn tile-edit-icon-danger"
          title="Remove tile"
          onPointerDown={stopPropagation}
          onClick={(e) => { e.stopPropagation(); onRemove?.(id); }}
          aria-label="Remove tile"
        >×</button>
      </div>
      <div
        className="tile-resize"
        onPointerDown={(e) => e.button === 0 && onStartResize(e)}
      />
    </>
  );

  if (spec.kind === 'number') {
    const { n, u } = formatNumber(state?.state, spec.unit || state?.unit);
    return (
      <div
        className={`tile custom-tile ${editMode ? 'tile-editing' : ''}`}
        style={style}
        onPointerDown={editMode ? (e) => e.button === 0 && onStartMove(e) : undefined}
        title={spec.entityId}
      >
        <div className="custom-num-inner">
          <div className="custom-num-head">
            <div className="custom-num-label">{spec.name}</div>
            <NumberTileIcon spec={spec} unit={u} />
          </div>
          <div className="custom-num-value">
            <span className="n">{n}</span>
            {u && <span className="u">{u}</span>}
          </div>
          {error && <div className="side-menu-note" style={{ color: 'var(--danger)' }}>{error}</div>}
        </div>
        {editHeader}
      </div>
    );
  }

  const iconCls = busy
    ? ''
    : on === true ? 'is-on' : on === false ? 'is-off' : '';
  const labelCls = on === true ? 'is-on' : on === false ? 'is-off' : '';
  const tileStateCls = on === true ? 'custom-tile-on' : on === false ? 'custom-tile-off' : '';

  return (
    <div
      className={`tile custom-tile ${tileStateCls} ${editMode ? 'tile-editing' : ''}`}
      style={style}
      onPointerDown={editMode ? (e) => e.button === 0 && onStartMove(e) : undefined}
      onContextMenu={editMode ? (e) => e.preventDefault() : undefined}
      title={editMode ? `${spec.entityId}\nLong-press to edit` : spec.entityId}
    >
      <button
        type="button"
        className="custom-btn-inner"
        onClick={editMode ? undefined : trigger}
        disabled={editMode || busy}
      >
        <div className={`custom-btn-icon ${iconCls}`}>
          <TileIcon iconKey={spec.icon} domain={spec.domain} on={on} />
        </div>
        <div className="custom-btn-name">{spec.name}</div>
        <div className={`custom-btn-state ${labelCls}`}>
          {busy ? 'Triggering…' : stateText}
        </div>
        {error && <div className="side-menu-note" style={{ color: 'var(--danger)' }}>{error}</div>}
      </button>
      {editHeader}
    </div>
  );
}

// Curated icon catalog. The key ends up in `spec.icon` from the picker so
// it survives layout persistence. Add/rename here to expose it to the UI.
export const TILE_ICON_KEYS = [
  'auto', 'light', 'lamp', 'torch', 'sign', 'switch', 'cover',
  'fan', 'lock', 'button', 'script', 'scene', 'water', 'garden',
  'fire', 'garage', 'gate', 'door', 'rgb', 'music', 'thermostat',
  'power',
];

const ICON_PATHS = {
  light:      'M9 21h6v-1H9v1zm3-19a7 7 0 0 0-4 12.7V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.3A7 7 0 0 0 12 2z',
  lamp:       'M6 2h12l-2 8h-8L6 2zm2 10h8v6h2v3H6v-3h2v-6z',
  torch:      'M9 2h6l-1 4h-4L9 2zm-1 5h8v3l-4 13-4-13V7z',
  sign:       'M6 3h12l3 4-3 4H6V3zm0 10h9l3 4-3 4H6v-8zM4 3h1v18H4V3z',
  switch_on:  'M17 6H7a6 6 0 0 0 0 12h10a6 6 0 0 0 0-12zm0 10a4 4 0 1 1 0-8 4 4 0 0 1 0 8z',
  switch_off: 'M7 6a6 6 0 0 0 0 12h10a6 6 0 0 0 0-12H7zm0 10a4 4 0 1 1 0-8 4 4 0 0 1 0 8z',
  cover:      'M4 3h16v2H4zM6 6h12v14H6zM8 8v10h8V8H8z',
  fan:        'M12 4a4 4 0 0 1 3.5 5.9L20 12l-4.5 2.1A4 4 0 1 1 8.5 9.9L4 12l4.5-2.1A4 4 0 0 1 12 4z',
  lock:       'M12 2a5 5 0 0 0-5 5v3H5v12h14V10h-2V7a5 5 0 0 0-5-5zm-3 8V7a3 3 0 0 1 6 0v3H9z',
  button:     null, // rendered as a circle below
  script:     'M8 5v14l11-7z',
  scene:      'M12 2l2.4 6.7L21 10l-5 4.6L17.5 22 12 18.3 6.5 22 8 14.6 3 10l6.6-1.3z',
  water:      'M12 2.5s-6.5 7.5-6.5 12.5a6.5 6.5 0 1 0 13 0C18.5 10 12 2.5 12 2.5z',
  garden:     'M12 2a5 5 0 0 0-5 5c0 3 5 8 5 8s5-5 5-8a5 5 0 0 0-5-5zm-8 20l3-6h10l3 6H4z',
  fire:       'M13 3s3 4 3 8a4 4 0 1 1-8 0c0-2 1-3 1-3s-2 5 2 7c0 0-3-2-1-6 1-2 3-6 3-6z',
  garage:     'M3 21V9l9-6 9 6v12h-4v-6H7v6H3zm6-2h2v-2H9v2zm4 0h2v-2h-2v2z',
  gate:       'M3 20V6h2v3h4V6h2v3h2V6h2v3h4V6h2v14H3z',
  door:       'M6 2h12v20H6V2zm2 2v16h8V4H8zm5 8v2h1v-2h-1z',
  rgb:        'M12 2a10 10 0 0 0 0 20c1 0 2-1 2-2s-1-1-1-2 1-1 2-1h2a5 5 0 0 0 5-5c0-6-4-10-10-10zm-4 6a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm8 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm-4-3a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z',
  music:      'M9 3v11.1a3 3 0 1 0 2 2.8V6h6V3H9z',
  thermostat: 'M13 3v9.3a3.5 3.5 0 1 1-2 0V3h2z',
  power:      'M13 3v10h-2V3h2zm5.4 3.6-1.4 1.4a7 7 0 1 1-10 0L5.6 6.6a9 9 0 1 0 12.8 0z',
};

const DOMAIN_TO_ICON = {
  light: 'light',
  switch: 'switch',
  cover: 'cover',
  fan: 'fan',
  lock: 'lock',
  button: 'button',
  input_button: 'button',
  script: 'script',
  automation: 'script',
  scene: 'scene',
  input_boolean: 'switch',
};

function TileIcon({ iconKey, domain, on }) {
  const key = iconKey && iconKey !== 'auto' ? iconKey : DOMAIN_TO_ICON[domain] || 'power';
  if (key === 'switch') {
    return (
      <svg viewBox="0 0 24 24">
        <path fill="currentColor" d={on ? ICON_PATHS.switch_on : ICON_PATHS.switch_off} />
      </svg>
    );
  }
  if (key === 'button') {
    return <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" fill="currentColor" /></svg>;
  }
  const d = ICON_PATHS[key];
  if (!d) return <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6" fill="currentColor" /></svg>;
  return <svg viewBox="0 0 24 24"><path fill="currentColor" d={d} /></svg>;
}

export { TileIcon };

// Number tile icon. Heuristic dispatch: unit → temp / humidity; entity id
// and name → waste-tank depth, door/contact sensors. Falls through to a
// generic gauge so every number tile still gets a glyph next to the label.
function NumberTileIcon({ spec, unit }) {
  const name = (spec.name || '').toLowerCase();
  const eid = (spec.entityId || '').toLowerCase();
  const u = (unit || spec.unit || '').toString().toLowerCase();
  const isTemp = u === '°c' || u === '°f' || u === 'c' || u === 'f'
    || /temperat/.test(name) || /temperature/.test(eid);
  const isHum = (u === '%' && (/humid/.test(name) || /humid/.test(eid)))
    || /humidity/.test(eid);
  const isWaste = /waste|tank|depth|level/.test(name) || /waste_tank|tank_level|depth/.test(eid);
  const isDoor = spec.domain === 'binary_sensor'
    || /door|gate|window|contact/.test(name)
    || /door|gate|window|contact/.test(eid);

  if (isTemp) {
    return (
      <span className="custom-num-icon custom-num-icon-temp" aria-hidden>
        <svg viewBox="0 0 24 24">
          <path fill="currentColor" d="M12 3a3 3 0 0 0-3 3v8.35a5 5 0 1 0 6 0V6a3 3 0 0 0-3-3zm-1 3a1 1 0 1 1 2 0v9.02a3 3 0 1 1-2 0V6zm1 4a1 1 0 0 0-1 1v4.28a2 2 0 1 0 2 0V11a1 1 0 0 0-1-1z"/>
        </svg>
      </span>
    );
  }
  if (isHum) {
    return (
      <span className="custom-num-icon custom-num-icon-hum" aria-hidden>
        <svg viewBox="0 0 24 24">
          <path fill="currentColor" d="M12 2.5s-6.5 7.5-6.5 12.5a6.5 6.5 0 1 0 13 0C18.5 10 12 2.5 12 2.5zm-3 12a1 1 0 0 1 1-1c.55 0 1 .45 1 1 0 1.66-1.79 3-4 3v-2c.83 0 2 -.34 2 -1z"/>
        </svg>
      </span>
    );
  }
  if (isWaste) {
    return (
      <span className="custom-num-icon custom-num-icon-waste" aria-hidden>
        <svg viewBox="0 0 24 24">
          <path fill="currentColor" d="M5 3h14v3H5zm1 4h12l-1 14H7L6 7zm3 3v9h2v-9H9zm4 0v9h2v-9h-2z"/>
        </svg>
      </span>
    );
  }
  if (isDoor) {
    return (
      <span className="custom-num-icon custom-num-icon-door" aria-hidden>
        <svg viewBox="0 0 24 24">
          <path fill="currentColor" d="M6 2h12v20H6V2zm2 2v16h8V4H8zm5 8v2h1v-2h-1z"/>
        </svg>
      </span>
    );
  }
  return (
    <span className="custom-num-icon" aria-hidden>
      <svg viewBox="0 0 24 24">
        <path fill="none" stroke="currentColor" strokeWidth="2" d="M12 3a9 9 0 1 0 9 9M12 3v9l7-7"/>
      </svg>
    </span>
  );
}
