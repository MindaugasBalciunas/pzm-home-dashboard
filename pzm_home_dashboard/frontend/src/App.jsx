import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CameraTile from './components/CameraTile.jsx';
import SolarCard from './components/SolarCard.jsx';
import SecurityCard from './components/SecurityCard.jsx';
import SideMenu from './components/SideMenu.jsx';
import SimpleTile from './components/SimpleTile.jsx';
import TileEditor from './components/TileEditor.jsx';

const LONG_PRESS_MS = 500;
const DRAG_THRESHOLD_PX = 6;

const GRID_COLS = 48;
const HERO_ID = 'frontgate';
const SOLAR_ID = 'solar';
const SECURITY_ID = 'security';

const FIT_MODES = ['fit', 'center', 'stretch'];
const DEFAULT_FIT = 'fit';

// Marker that the initial template has already been seeded. Once present in
// `overrides`, we never re-seed even if the user deletes template tiles.
const TEMPLATE_MARKER = '_seededTemplate';
const TEMPLATE_VERSION = 'v1';

// One-tap tiles seeded on the very first load (no existing user layout).
// Stable IDs so the layout survives future template revisions without dupes.
const TEMPLATE_TILES = [
  // Outdoor switches — one big row.
  { id: 'tpl-garden-hose',       kind: 'button', entityId: 'switch.garden_hose_switch_1',       domain: 'switch', name: 'Garden hose' },
  { id: 'tpl-terrace-torch',     kind: 'button', entityId: 'switch.teresa_torch_switch_1',      domain: 'switch', name: 'Terrace torch' },
  { id: 'tpl-front-torch',       kind: 'button', entityId: 'switch.front_light_torch_switch_1', domain: 'switch', name: 'Front torch' },
  { id: 'tpl-street-sign',       kind: 'button', entityId: 'switch.street_sign_switch_1',       domain: 'switch', name: 'Street sign' },
  { id: 'tpl-street-lamp',       kind: 'button', entityId: 'switch.street_lamp_switch_socket_1', domain: 'switch', name: 'Street lamp' },
  { id: 'tpl-living-rgb',        kind: 'button', entityId: 'light.living_room_rgbic_led',       domain: 'light',  name: 'Living RGB' },
  // Environment sensors — number tiles.
  { id: 'tpl-outside-temp',      kind: 'number', entityId: 'sensor.outside_temperature_humidity_sensor_temperature',      domain: 'sensor', name: 'Outside temp',      unit: '°C' },
  { id: 'tpl-outside-hum',       kind: 'number', entityId: 'sensor.outside_temperature_humidity_sensor_humidity',         domain: 'sensor', name: 'Outside humidity',  unit: '%' },
  { id: 'tpl-greenhouse-temp',   kind: 'number', entityId: 'sensor.greenhouse_temperature_humidity_sensor_2_temperature', domain: 'sensor', name: 'Greenhouse temp',   unit: '°C' },
  { id: 'tpl-greenhouse-hum',    kind: 'number', entityId: 'sensor.greenhouse_temperature_humidity_sensor_2_humidity',    domain: 'sensor', name: 'Greenhouse hum.',   unit: '%' },
  { id: 'tpl-waste-tank',        kind: 'number', entityId: 'sensor.waste_tank_level_depth',                               domain: 'sensor', name: 'Waste tank',        unit: null },
  { id: 'tpl-garage-door',       kind: 'number', entityId: 'binary_sensor.garage_gates_contact_sensor_door',              domain: 'binary_sensor', name: 'Garage door',  unit: null },
];

// Lay out template tiles in a clean strip beneath the top row of cameras/
// solar/security. `startRow` is picked deep enough that existing defaults
// (which top out around row 17) never clash.
function seedTemplateLayout(startRow) {
  const buttonsW = 6, buttonsH = 6;
  const numbersW = 8, numbersH = 5;
  const cols = GRID_COLS;
  const out = {};
  let col = 1, row = startRow;
  const advance = (w, h) => {
    if (col + w - 1 > cols) { col = 1; row += h; }
    const pos = { col, row };
    col += w;
    return pos;
  };
  const buttons = TEMPLATE_TILES.filter((t) => t.kind === 'button');
  const numbers = TEMPLATE_TILES.filter((t) => t.kind === 'number');
  for (const t of buttons) {
    const { col: c, row: r } = advance(buttonsW, buttonsH);
    out[t.id] = { col: c, row: r, colSpan: buttonsW, rowSpan: buttonsH, spec: { kind: 'button', entityId: t.entityId, domain: t.domain, name: t.name } };
  }
  // Start a new row for the number strip.
  col = 1; row += buttonsH;
  for (const t of numbers) {
    const { col: c, row: r } = advance(numbersW, numbersH);
    out[t.id] = { col: c, row: r, colSpan: numbersW, rowSpan: numbersH, spec: { kind: 'number', entityId: t.entityId, domain: t.domain, name: t.name, unit: t.unit } };
  }
  return out;
}

// Defaults at 48-col density: everything doubled from the old 24-col defaults.
function computeDefaults(cameras) {
  const byId = {};
  const NORMAL_W = 12;
  const NORMAL_H = 8;
  const SOLAR_W = 16;
  const SOLAR_H = 16;
  const SECURITY_W = 10;
  const SECURITY_H = 14;
  const HERO_W = GRID_COLS - SOLAR_W - SECURITY_W;
  const HERO_H = 16;
  const hero = cameras.find((c) => c.id === HERO_ID);
  let rowCursor = 1;
  if (hero) {
    byId[hero.id] = { col: 1, row: 1, colSpan: HERO_W, rowSpan: HERO_H, fit: DEFAULT_FIT };
    byId[SOLAR_ID] = { col: HERO_W + 1, row: 1, colSpan: SOLAR_W, rowSpan: SOLAR_H };
    byId[SECURITY_ID] = { col: HERO_W + SOLAR_W + 1, row: 1, colSpan: SECURITY_W, rowSpan: SECURITY_H };
    rowCursor = 1 + Math.max(HERO_H, SOLAR_H, SECURITY_H);
  } else {
    byId[SOLAR_ID] = { col: 1, row: 1, colSpan: SOLAR_W, rowSpan: SOLAR_H };
    byId[SECURITY_ID] = { col: SOLAR_W + 1, row: 1, colSpan: SECURITY_W, rowSpan: SECURITY_H };
    rowCursor = 1 + Math.max(SOLAR_H, SECURITY_H);
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

// Debounced PUT so a drag gesture doesn't spam the backend.
function useDebouncedPersist(saveFn) {
  const timerRef = useRef(null);
  const latestRef = useRef(null);
  const cancel = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };
  const schedule = (value, delayMs = 400) => {
    latestRef.current = value;
    cancel();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      saveFn(latestRef.current);
    }, delayMs);
  };
  const flush = () => {
    if (timerRef.current == null) return;
    cancel();
    saveFn(latestRef.current);
  };
  useEffect(() => cancel, []);
  return { schedule, flush };
}

// Find a free spot for a new tile, size wxh, scanning the grid top-to-bottom.
function findFreeSpot(overrides, w, h) {
  const occupied = new Map(); // row -> Set<col>
  const mark = (col, row, colSpan, rowSpan) => {
    for (let r = row; r < row + rowSpan; r++) {
      let set = occupied.get(r);
      if (!set) { set = new Set(); occupied.set(r, set); }
      for (let c = col; c < col + colSpan; c++) set.add(c);
    }
  };
  for (const v of Object.values(overrides)) {
    if (!v || v.hidden) continue;
    if (v.col && v.row && v.colSpan && v.rowSpan) mark(v.col, v.row, v.colSpan, v.rowSpan);
  }
  for (let row = 1; row < 200; row++) {
    for (let col = 1; col <= GRID_COLS - w + 1; col++) {
      let free = true;
      outer: for (let r = row; r < row + h; r++) {
        const set = occupied.get(r);
        if (!set) continue;
        for (let c = col; c < col + w; c++) {
          if (set.has(c)) { free = false; break outer; }
        }
      }
      if (free) return { col, row };
    }
  }
  return { col: 1, row: 1 };
}

export default function App() {
  const [cameras, setCameras] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  // `overrides` is the full layout object stored server-side. Keys are tile
  // ids: camera ids, "solar", "security", or user-added "custom-*" ids.
  // Values include position/size plus per-type extras (fit for cameras,
  // spec for custom tiles).
  const [overrides, setOverrides] = useState({});
  const [revision, setRevision] = useState(0);
  const [editingTileId, setEditingTileId] = useState(null);
  const gridRef = useRef(null);
  const overridesRef = useRef(overrides);
  useEffect(() => { overridesRef.current = overrides; }, [overrides]);

  const saveLayout = useCallback(async (payload) => {
    try {
      const r = await fetch('api/layout', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layout: payload }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      if (typeof data.revision === 'number') setRevision(data.revision);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('layout PUT failed', e);
    }
  }, []);

  const persist = useDebouncedPersist(saveLayout);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch('api/cameras').then((r) => { if (!r.ok) throw new Error(`cameras HTTP ${r.status}`); return r.json(); }),
      fetch('api/layout').then((r) => { if (!r.ok) throw new Error(`layout HTTP ${r.status}`); return r.json(); }),
    ])
      .then(([camData, layoutData]) => {
        if (cancelled) return;
        const cams = Array.isArray(camData) ? camData : [];
        setCameras(cams);
        const initial = layoutData?.layout && typeof layoutData.layout === 'object' ? layoutData.layout : {};
        setRevision(typeof layoutData?.revision === 'number' ? layoutData.revision : 0);

        // Seed the starter template on the very first load. Guard with a
        // marker so template tiles never resurrect once the user deletes
        // them. Persist immediately so every other client picks it up.
        const marker = initial[TEMPLATE_MARKER];
        if (!marker) {
          const camDefaults = computeDefaults(cams);
          // Determine the first row below the built-in tiles.
          let maxRow = 1;
          for (const v of Object.values(camDefaults)) {
            if (v && v.row && v.rowSpan) maxRow = Math.max(maxRow, v.row + v.rowSpan);
          }
          for (const v of Object.values(initial)) {
            if (v && v.row && v.rowSpan) maxRow = Math.max(maxRow, v.row + v.rowSpan);
          }
          const seeded = { ...initial, ...seedTemplateLayout(maxRow), [TEMPLATE_MARKER]: TEMPLATE_VERSION };
          setOverrides(seeded);
          saveLayout(seeded);
        } else {
          setOverrides(initial);
        }
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(String(e));
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [saveLayout]);

  // Subscribe to layout changes from other clients.
  useEffect(() => {
    if (typeof EventSource === 'undefined') return undefined;
    const es = new EventSource('api/layout/events');
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (!data || typeof data.revision !== 'number') return;
        // Only accept newer revisions than what we already have.
        setRevision((current) => {
          if (data.revision <= current) return current;
          setOverrides(data.layout && typeof data.layout === 'object' ? data.layout : {});
          return data.revision;
        });
      } catch { /* ignore */ }
    };
    es.onerror = () => { /* browser auto-reconnects */ };
    return () => es.close();
  }, []);

  const defaults = useMemo(() => computeDefaults(cameras), [cameras]);
  const layout = useMemo(() => {
    const out = {};
    for (const cam of cameras) {
      out[cam.id] = { ...defaults[cam.id], ...(overrides[cam.id] || {}) };
    }
    out[SOLAR_ID] = { ...defaults[SOLAR_ID], ...(overrides[SOLAR_ID] || {}) };
    out[SECURITY_ID] = { ...defaults[SECURITY_ID], ...(overrides[SECURITY_ID] || {}) };
    for (const [id, entry] of Object.entries(overrides)) {
      if (!entry || typeof entry !== 'object') continue;
      if (id.startsWith('custom-') || id.startsWith('tpl-')) {
        out[id] = { colSpan: 6, rowSpan: 6, ...entry };
      }
    }
    return out;
  }, [cameras, overrides, defaults]);

  // Merge a patch into overrides for one tile and (optionally) persist.
  const updateTile = (id, patch, persistNow) => {
    setOverrides((prev) => {
      const existing = prev[id] || {};
      const merged = { ...(layout[id] || {}), ...existing, ...patch };
      const next = { ...prev, [id]: merged };
      if (persistNow) persist.schedule(next, 400);
      return next;
    });
  };

  const commitLayoutSnapshot = () => persist.flush();

  const setFit = (id, fit) => {
    if (!FIT_MODES.includes(fit)) return;
    setOverrides((prev) => {
      const merged = { ...(layout[id] || {}), ...(prev[id] || {}), fit };
      const next = { ...prev, [id]: merged };
      persist.schedule(next, 200);
      return next;
    });
  };

  const resetLayout = () => {
    // Rebuild the starter template so an empty layout never actually reaches
    // any client — users always see something on first paint.
    const camDefaults = computeDefaults(cameras);
    let maxRow = 1;
    for (const v of Object.values(camDefaults)) {
      if (v && v.row && v.rowSpan) maxRow = Math.max(maxRow, v.row + v.rowSpan);
    }
    const next = { ...seedTemplateLayout(maxRow), [TEMPLATE_MARKER]: TEMPLATE_VERSION };
    setOverrides(next);
    persist.schedule(next, 0);
  };

  const addCustomTile = (spec) => {
    // Default sizes tuned for the 48-col grid.
    const w = spec.kind === 'number' ? 8 : 6;
    const h = spec.kind === 'number' ? 5 : 6;
    const { col, row } = findFreeSpot(overridesRef.current, w, h);
    const id = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const entry = { col, row, colSpan: w, rowSpan: h, spec };
    setOverrides((prev) => {
      const next = { ...prev, [id]: entry };
      persist.schedule(next, 0);
      return next;
    });
    // Open edit mode so the user can immediately position it.
    setEditMode(true);
  };

  const removeCustomTile = (id) => {
    setOverrides((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      persist.schedule(next, 0);
      return next;
    });
  };

  const updateTileSpec = (id, nextSpec) => {
    setOverrides((prev) => {
      const cur = prev[id];
      if (!cur) return prev;
      const next = { ...prev, [id]: { ...cur, spec: nextSpec } };
      persist.schedule(next, 0);
      return next;
    });
    setEditingTileId(null);
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

    // Long-press to edit — only for user-owned tiles (custom / template),
    // only on the move gesture. If the pointer moves before the timer fires
    // we treat the gesture as a drag; if the timer wins we abort the drag
    // and open the editor instead.
    const isEditable = kind === 'move'
      && (id.startsWith('custom-') || id.startsWith('tpl-'));
    let longPressFired = false;
    let moved = false;
    let longPressTimer = null;

    const teardown = () => {
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };

    const onMove = (ev) => {
      if (!moved
          && (Math.abs(ev.clientX - startX) > DRAG_THRESHOLD_PX
              || Math.abs(ev.clientY - startY) > DRAG_THRESHOLD_PX)) {
        moved = true;
        if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
      }
      if (longPressFired) return;
      const stepX = metrics.cellW + metrics.gap;
      const stepY = metrics.cellH + metrics.gap;
      const dCol = Math.round((ev.clientX - startX) / stepX);
      const dRow = Math.round((ev.clientY - startY) / stepY);
      if (kind === 'move') {
        const col = clamp(startCol + dCol, 1, GRID_COLS - startColSpan + 1);
        const row = Math.max(1, startRow + dRow);
        if (col !== eff.col || row !== eff.row) updateTile(id, { col, row }, true);
      } else {
        const colSpan = clamp(startColSpan + dCol, 1, GRID_COLS - startCol + 1);
        const rowSpan = Math.max(1, startRowSpan + dRow);
        if (colSpan !== eff.colSpan || rowSpan !== eff.rowSpan) updateTile(id, { colSpan, rowSpan }, true);
      }
    };
    const onUp = () => {
      teardown();
      if (!longPressFired) commitLayoutSnapshot();
    };

    if (isEditable) {
      longPressTimer = setTimeout(() => {
        if (moved) return;
        longPressFired = true;
        teardown();
        setEditingTileId(id);
      }, LONG_PRESS_MS);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const customEntries = Object.entries(overrides).filter(
    ([id, v]) => (id.startsWith('custom-') || id.startsWith('tpl-')) && v && v.spec
  );

  return (
    <>
      <SideMenu
        editMode={editMode}
        onToggleEdit={() => setEditMode((v) => !v)}
        onResetLayout={resetLayout}
        onAddTile={addCustomTile}
      />

      <main
        ref={gridRef}
        className={`grid ${editMode ? 'grid-edit' : ''}`}
      >
        {loading && <div className="notice" style={{ gridColumn: `1 / -1` }}>Loading dashboard…</div>}
        {error && (
          <div className="notice notice-error" style={{ gridColumn: `1 / -1` }}>
            Failed to load: {error}
          </div>
        )}
        {!loading && !error && cameras.length === 0 && customEntries.length === 0 && (
          <div className="notice" style={{ gridColumn: `1 / -1` }}>No cameras or tiles configured.</div>
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
        {layout[SECURITY_ID] && (
          <SecurityCard
            key={SECURITY_ID}
            col={layout[SECURITY_ID].col}
            row={layout[SECURITY_ID].row}
            colSpan={layout[SECURITY_ID].colSpan}
            rowSpan={layout[SECURITY_ID].rowSpan}
            editMode={editMode}
            onStartMove={(e) => startDrag(SECURITY_ID, e, 'move')}
            onStartResize={(e) => startDrag(SECURITY_ID, e, 'resize')}
          />
        )}
        {customEntries.map(([id, entry]) => {
          const l = layout[id];
          if (!l) return null;
          return (
            <SimpleTile
              key={id}
              id={id}
              spec={entry.spec}
              col={l.col}
              row={l.row}
              colSpan={l.colSpan}
              rowSpan={l.rowSpan}
              editMode={editMode}
              onStartMove={(e) => startDrag(id, e, 'move')}
              onStartResize={(e) => startDrag(id, e, 'resize')}
              onRemove={removeCustomTile}
            />
          );
        })}
      </main>

      {editingTileId && overrides[editingTileId] && (
        <TileEditor
          id={editingTileId}
          entry={overrides[editingTileId]}
          onSave={updateTileSpec}
          onDelete={(id) => { removeCustomTile(id); setEditingTileId(null); }}
          onCancel={() => setEditingTileId(null)}
        />
      )}
    </>
  );
}
