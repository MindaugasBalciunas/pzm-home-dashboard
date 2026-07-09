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

  const editHeader = editMode && (
    <>
      <div className="tile-edit-top">
        <span className="tile-edit-name">{spec.name}</span>
        <span className="tile-edit-size">{colSpan}×{rowSpan}</span>
        <button
          type="button"
          className="side-menu-close"
          title="Remove tile"
          onClick={(e) => { e.stopPropagation(); onRemove?.(id); }}
          style={{ color: 'var(--danger)' }}
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
          <div className="custom-num-label">{spec.name}</div>
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

  return (
    <div
      className={`tile custom-tile ${editMode ? 'tile-editing' : ''}`}
      style={style}
      onPointerDown={editMode ? (e) => e.button === 0 && onStartMove(e) : undefined}
      title={spec.entityId}
    >
      <button
        type="button"
        className="custom-btn-inner"
        onClick={editMode ? undefined : trigger}
        disabled={editMode || busy}
      >
        <div className={`custom-btn-icon ${iconCls}`}>
          <TileIcon domain={spec.domain} on={on} />
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

function TileIcon({ domain, on }) {
  switch (domain) {
    case 'light':
      return (
        <svg viewBox="0 0 24 24"><path fill="currentColor" d="M9 21h6v-1H9v1zm3-19a7 7 0 0 0-4 12.7V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.3A7 7 0 0 0 12 2z" /></svg>
      );
    case 'switch':
      return (
        <svg viewBox="0 0 24 24"><path fill="currentColor" d={on ? 'M17 6H7a6 6 0 0 0 0 12h10a6 6 0 0 0 0-12zm0 10a4 4 0 1 1 0-8 4 4 0 0 1 0 8z' : 'M7 6a6 6 0 0 0 0 12h10a6 6 0 0 0 0-12H7zm0 10a4 4 0 1 1 0-8 4 4 0 0 1 0 8z'} /></svg>
      );
    case 'cover':
      return (
        <svg viewBox="0 0 24 24"><path fill="currentColor" d="M4 3h16v2H4zM6 6h12v14H6zM8 8v10h8V8H8z" /></svg>
      );
    case 'lock':
      return (
        <svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2a5 5 0 0 0-5 5v3H5v12h14V10h-2V7a5 5 0 0 0-5-5zm-3 8V7a3 3 0 0 1 6 0v3H9z" /></svg>
      );
    case 'button':
    case 'input_button':
      return (
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="currentColor" /></svg>
      );
    case 'script':
    case 'automation':
      return (
        <svg viewBox="0 0 24 24"><path fill="currentColor" d="M8 5v14l11-7z" /></svg>
      );
    case 'scene':
      return (
        <svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2l2.4 6.7L21 10l-5 4.6L17.5 22 12 18.3 6.5 22 8 14.6 3 10l6.6-1.3z" /></svg>
      );
    case 'fan':
      return (
        <svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 4a4 4 0 0 1 3.5 5.9L20 12l-4.5 2.1A4 4 0 1 1 8.5 9.9L4 12l4.5-2.1A4 4 0 0 1 12 4z" /></svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6" fill="currentColor" /></svg>
      );
  }
}
