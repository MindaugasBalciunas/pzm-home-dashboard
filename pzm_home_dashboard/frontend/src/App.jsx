import { useEffect, useMemo, useRef, useState } from 'react';
import CameraTile from './components/CameraTile.jsx';
import SolarCard from './components/SolarCard.jsx';

const LS_KEY = 'pzm-layout-v5';
const GRID_COLS = 24;
const HERO_ID = 'frontgate';
const SOLAR_ID = 'solar';

function loadStored() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && parsed.byId ? parsed.byId : {};
  } catch {
    return {};
  }
}

function saveStored(byId) {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ byId })); } catch { /* ignore */ }
}

const FIT_MODES = ['fit', 'center', 'stretch'];
const DEFAULT_FIT = 'fit';

function computeDefaults(cameras) {
  const byId = {};
  const NORMAL_W = 6;
  const NORMAL_H = 4;
  const SOLAR_W = 8;
  const SOLAR_H = 8;
  const HERO_W = GRID_COLS - SOLAR_W;
  const HERO_H = 8;
  const hero = cameras.find((c) => c.id === HERO_ID);
  let rowCursor = 1;
  if (hero) {
    byId[hero.id] = { col: 1, row: 1, colSpan: HERO_W, rowSpan: HERO_H, fit: DEFAULT_FIT };
    byId[SOLAR_ID] = { col: HERO_W + 1, row: 1, colSpan: SOLAR_W, rowSpan: SOLAR_H };
    rowCursor = 1 + Math.max(HERO_H, SOLAR_H);
  } else {
    byId[SOLAR_ID] = { col: 1, row: 1, colSpan: SOLAR_W, rowSpan: SOLAR_H };
    rowCursor = 1 + SOLAR_H;
  }
  let col = 1;
  let row = rowCursor;
  for (const cam of cameras) {
    if (byId[cam.id]) continue;
    if (col + NORMAL_W - 1 > GRID_COLS) { col = 1; row += NORMAL_H; }
    byId[cam.id] = { col, row, colSpan: NORMAL_W, rowSpan: NORMAL_H, fit: DEFAULT_FIT };
    col += NORMAL_W;
  }
  return byId;
}

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

export default function App() {
  const [cameras, setCameras] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [overrides, setOverrides] = useState(loadStored);
  const gridRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    fetch('api/cameras')
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data) => {
        if (cancelled) return;
        setCameras(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(String(e));
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const layout = useMemo(() => {
    const defaults = computeDefaults(cameras);
    const out = {};
    for (const cam of cameras) {
      out[cam.id] = { ...defaults[cam.id], ...(overrides[cam.id] || {}) };
    }
    out[SOLAR_ID] = { ...defaults[SOLAR_ID], ...(overrides[SOLAR_ID] || {}) };
    return out;
  }, [cameras, overrides]);

  const updateTile = (id, patch, persist) => {
    setOverrides((prev) => {
      const next = {
        ...prev,
        [id]: { ...(prev[id] || {}), ...(layout[id] || {}), ...patch },
      };
      if (persist) saveStored(next);
      return next;
    });
  };

  const commitLayoutSnapshot = () => { saveStored(overrides); };

  const setFit = (id, fit) => {
    if (!FIT_MODES.includes(fit)) return;
    setOverrides((prev) => {
      const next = {
        ...prev,
        [id]: { ...(prev[id] || {}), ...(layout[id] || {}), fit },
      };
      saveStored(next);
      return next;
    });
  };

  const resetLayout = () => {
    setOverrides({});
    try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
  };

  const getCellMetrics = () => {
    const el = gridRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const gap = parseFloat(cs.rowGap || cs.gap || '0') || 0;
    const cellW = (rect.width - (GRID_COLS - 1) * gap) / GRID_COLS;
    const cellH = cellW;
    return { rect, gap, cellW, cellH };
  };

  const startDrag = (id, e, kind) => {
    e.preventDefault();
    e.stopPropagation();
    const metrics = getCellMetrics();
    if (!metrics) return;
    const eff = layout[id];
    if (!eff) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const startCol = eff.col;
    const startRow = eff.row;
    const startColSpan = eff.colSpan;
    const startRowSpan = eff.rowSpan;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }

    const onMove = (ev) => {
      const stepX = metrics.cellW + metrics.gap;
      const stepY = metrics.cellH + metrics.gap;
      const dCol = Math.round((ev.clientX - startX) / stepX);
      const dRow = Math.round((ev.clientY - startY) / stepY);
      if (kind === 'move') {
        const col = clamp(startCol + dCol, 1, GRID_COLS - startColSpan + 1);
        const row = Math.max(1, startRow + dRow);
        if (col !== eff.col || row !== eff.row) updateTile(id, { col, row });
      } else {
        const colSpan = clamp(startColSpan + dCol, 1, GRID_COLS - startCol + 1);
        const rowSpan = Math.max(1, startRowSpan + dRow);
        if (colSpan !== eff.colSpan || rowSpan !== eff.rowSpan) updateTile(id, { colSpan, rowSpan });
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      commitLayoutSnapshot();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  return (
    <>
      <main
        ref={gridRef}
        className={`grid ${editMode ? 'grid-edit' : ''}`}
      >
        {loading && <div className="notice" style={{ gridColumn: `1 / -1` }}>Loading cameras…</div>}
        {error && (
          <div className="notice notice-error" style={{ gridColumn: `1 / -1` }}>
            Failed to load cameras: {error}
          </div>
        )}
        {!loading && !error && cameras.length === 0 && (
          <div className="notice" style={{ gridColumn: `1 / -1` }}>No cameras configured.</div>
        )}
        {cameras.map((cam) => {
          const l = layout[cam.id];
          if (!l) return null;
          const wide = l.colSpan >= Math.ceil(GRID_COLS / 2);
          return (
            <CameraTile
              key={cam.id}
              camera={cam}
              col={l.col}
              row={l.row}
              colSpan={l.colSpan}
              rowSpan={l.rowSpan}
              wide={wide}
              fit={l.fit || DEFAULT_FIT}
              editMode={editMode}
              onStartMove={(e) => startDrag(cam.id, e, 'move')}
              onStartResize={(e) => startDrag(cam.id, e, 'resize')}
              onSetFit={(mode) => setFit(cam.id, mode)}
            />
          );
        })}
        {layout[SOLAR_ID] && (
          <SolarCard
            key={SOLAR_ID}
            col={layout[SOLAR_ID].col}
            row={layout[SOLAR_ID].row}
            colSpan={layout[SOLAR_ID].colSpan}
            rowSpan={layout[SOLAR_ID].rowSpan}
            editMode={editMode}
            onStartMove={(e) => startDrag(SOLAR_ID, e, 'move')}
            onStartResize={(e) => startDrag(SOLAR_ID, e, 'resize')}
          />
        )}
      </main>
      <div className="edit-toolbar">
        {editMode && (
          <button type="button" className="edit-btn edit-btn-secondary" onClick={resetLayout}>
            Reset
          </button>
        )}
        <button
          type="button"
          className={`edit-btn ${editMode ? 'edit-btn-active' : ''}`}
          onClick={() => setEditMode((v) => !v)}
          title="Toggle edit mode"
        >
          {editMode ? 'Done' : 'Edit'}
        </button>
      </div>
    </>
  );
}
