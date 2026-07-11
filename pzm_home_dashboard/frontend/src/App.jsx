import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CameraTile from './components/CameraTile.jsx';
import SolarCard from './components/SolarCard.jsx';
import SecurityCard from './components/SecurityCard.jsx';
import PtzCard from './components/PtzCard.jsx';
import WeatherCard from './components/WeatherCard.jsx';
import SideMenu from './components/SideMenu.jsx';
import SimpleTile from './components/SimpleTile.jsx';
import TileEditor from './components/TileEditor.jsx';
import SecurityOptions from './components/SecurityOptions.jsx';
import PullToRefresh from './components/PullToRefresh.jsx';
import { isFreePlacement } from './lib/placement.js';
import { repairLayout } from './lib/layoutRepair.js';
import { textVarsFor } from './lib/color.js';

// Touch move-drags arm after this hold; taps and mouse drags stay instant.
const HOLD_TO_DRAG_MS = 350;
const DRAG_THRESHOLD_PX = 6;

const GRID_COLS = 48;
const HERO_ID = 'frontgate';
const SOLAR_ID = 'solar';
const SECURITY_ID = 'security';
const PTZ_ID = 'ptz';
const PTZ_W = 10;
const PTZ_H = 7;
const WEATHER_ID = 'weather';
const WEATHER_W = 24;
const WEATHER_H = 6;

const FIT_MODES = ['fit', 'center', 'stretch'];
const DEFAULT_FIT = 'fit';

// Marker that the initial template has already been seeded. Once present in
// `overrides`, we never re-seed even if the user deletes template tiles.
const TEMPLATE_MARKER = '_seededTemplate';
// v2 added the Camera PTZ preset card, v3 the Weather card, v4 the garage
// RGBIC strip tile, v5 the light scenes (pattern) tiles. Older layouts
// get only the tiles their version predates, each seeded into a free
// slot (see the additions list in the load effect).
const TEMPLATE_VERSION = 'v5';

// Dashboard-wide appearance settings ride along in the shared layout under
// this key (like the template marker, it's not a tile). Currently: `bg`,
// the dashboard background colour behind all tiles.
const THEME_KEY = '_theme';

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
  { id: 'tpl-garage-rgb',        kind: 'button', entityId: 'light.garage_led_strip',            domain: 'light',  name: 'Garage LED' },
  // Environment sensors — number tiles. No baked-in units: tiles read the
  // live unit from HA each poll (a stored unit would shadow it forever —
  // see the same policy note in EntityPicker).
  { id: 'tpl-outside-temp',      kind: 'number', entityId: 'sensor.outside_temperature_humidity_sensor_temperature',      domain: 'sensor', name: 'Outside temp' },
  { id: 'tpl-outside-hum',       kind: 'number', entityId: 'sensor.outside_temperature_humidity_sensor_humidity',         domain: 'sensor', name: 'Outside humidity' },
  { id: 'tpl-greenhouse-temp',   kind: 'number', entityId: 'sensor.greenhouse_temperature_humidity_sensor_2_temperature', domain: 'sensor', name: 'Greenhouse temp' },
  { id: 'tpl-greenhouse-hum',    kind: 'number', entityId: 'sensor.greenhouse_temperature_humidity_sensor_2_humidity',    domain: 'sensor', name: 'Greenhouse hum.' },
  { id: 'tpl-waste-tank',        kind: 'number', entityId: 'sensor.waste_tank_level_depth',                               domain: 'sensor', name: 'Waste tank' },
  { id: 'tpl-garage-door',       kind: 'number', entityId: 'binary_sensor.garage_gates_contact_sensor_door',              domain: 'binary_sensor', name: 'Garage door' },
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
    out[t.id] = { col: c, row: r, colSpan: numbersW, rowSpan: numbersH, spec: { kind: 'number', entityId: t.entityId, domain: t.domain, name: t.name } };
  }
  // Camera PTZ preset card + Weather card on their own row below the strip.
  row += numbersH;
  out[PTZ_ID] = { col: 1, row, colSpan: PTZ_W, rowSpan: PTZ_H };
  out[WEATHER_ID] = { col: PTZ_W + 1, row, colSpan: WEATHER_W, rowSpan: WEATHER_H };
  // RGBIC pattern (light scenes) tiles for both strips.
  row += Math.max(PTZ_H, WEATHER_H);
  out['tpl-living-fx'] = {
    col: 1, row, colSpan: 12, rowSpan: 6,
    spec: { kind: 'lightfx', entityId: 'light.living_room_rgbic_led', domain: 'light', name: 'Living patterns' },
  };
  out['tpl-garage-fx'] = {
    col: 13, row, colSpan: 12, rowSpan: 6,
    spec: { kind: 'lightfx', entityId: 'light.garage_led_strip', domain: 'light', name: 'Garage patterns' },
  };
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

// Debounced PUT so a drag gesture doesn't spam the backend. The returned
// object (and its functions) are referentially stable so callbacks built on
// top of it stay stable too — that's what lets the memoised tiles skip
// re-renders.
function useDebouncedPersist(saveFn) {
  const timerRef = useRef(null);
  const latestRef = useRef(null);
  const saveFnRef = useRef(saveFn);
  useEffect(() => { saveFnRef.current = saveFn; }, [saveFn]);
  const api = useMemo(() => {
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
        saveFnRef.current(latestRef.current);
      }, delayMs);
    };
    const flush = () => {
      if (timerRef.current == null) return;
      cancel();
      saveFnRef.current(latestRef.current);
    };
    return { schedule, flush, cancel };
  }, []);
  useEffect(() => api.cancel, [api]);
  return api;
}

// Find a free spot for a new tile, size wxh, scanning the grid top-to-bottom.
function findFreeSpot(overrides, w, h) {
  const occupied = new Map(); // row -> Set<col>
  // Floor/ceil so free-placed (fractional) tiles still block every grid
  // cell they touch — the integer scan below only probes whole cells.
  const mark = (col, row, colSpan, rowSpan) => {
    for (let r = Math.floor(row); r < Math.ceil(row + rowSpan); r++) {
      let set = occupied.get(r);
      if (!set) { set = new Set(); occupied.set(r, set); }
      for (let c = Math.floor(col); c < Math.ceil(col + colSpan); c++) set.add(c);
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
  const [camerasError, setCamerasError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  // Edit-mode drag quantisation. On = classic grid snap; off = free
  // placement at 1/20-cell precision, letting tiles overlap other cards
  // (they persist as fractional col/row and render absolutely).
  const [snapToGrid, setSnapToGrid] = useState(true);
  const snapRef = useRef(snapToGrid);
  useEffect(() => { snapRef.current = snapToGrid; }, [snapToGrid]);
  // Experiments: loop the Electricity house photo through all variants.
  const [bgDemo, setBgDemo] = useState(false);
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
    Promise.allSettled([
      fetch('api/cameras').then((r) => { if (!r.ok) throw new Error(`cameras HTTP ${r.status}`); return r.json(); }),
      fetch('api/layout').then((r) => { if (!r.ok) throw new Error(`layout HTTP ${r.status}`); return r.json(); }),
    ])
      .then(([camRes, layoutRes]) => {
        if (cancelled) return;
        // The layout IS the dashboard — without it nothing can safely
        // render (and seeding the starter template over an unknown server
        // state could overwrite a real layout), so its failure stays
        // fatal. Cameras are optional: if that endpoint hiccups (ffmpeg
        // startup, camera subsystem down) the buttons, sensors, solar and
        // security tiles must still come up on the kiosk.
        if (layoutRes.status === 'rejected') {
          setError(String(layoutRes.reason));
          setLoading(false);
          return;
        }
        if (camRes.status === 'rejected') setCamerasError(String(camRes.reason));
        const cams = camRes.status === 'fulfilled' && Array.isArray(camRes.value) ? camRes.value : [];
        setCameras(cams);
        const layoutData = layoutRes.value;
        const stored = layoutData?.layout && typeof layoutData.layout === 'object' ? layoutData.layout : {};
        // Heal known data defects (mojibake units, renamed entities) before
        // anything renders or reseeds. When something was repaired the fixed
        // layout is persisted below, so the shared copy heals too.
        const { layout: initial, changed: repaired } = repairLayout(stored);
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
        } else if (marker !== TEMPLATE_VERSION) {
          // Older template: seed only the tiles this layout's version
          // predates, each into the first free slot (sequentially, so
          // later seeds see earlier ones' spots as taken). Version-gated
          // so a tile the user deleted isn't resurrected by a later
          // upgrade that didn't introduce it.
          const additions = [
            { id: PTZ_ID, since: 2, w: PTZ_W, h: PTZ_H },
            { id: WEATHER_ID, since: 3, w: WEATHER_W, h: WEATHER_H },
            { id: 'tpl-garage-rgb', since: 4, w: 6, h: 6,
              spec: { kind: 'button', entityId: 'light.garage_led_strip', domain: 'light', name: 'Garage LED' } },
            { id: 'tpl-living-fx', since: 5, w: 12, h: 6,
              spec: { kind: 'lightfx', entityId: 'light.living_room_rgbic_led', domain: 'light', name: 'Living patterns' } },
            { id: 'tpl-garage-fx', since: 5, w: 12, h: 6,
              spec: { kind: 'lightfx', entityId: 'light.garage_led_strip', domain: 'light', name: 'Garage patterns' } },
          ];
          const fromVersion = Number(String(marker).replace(/^v/, '')) || 1;
          const seeded = { ...initial };
          for (const add of additions) {
            if (add.since <= fromVersion || seeded[add.id]) continue;
            const spot = findFreeSpot(seeded, add.w, add.h);
            seeded[add.id] = {
              ...spot,
              colSpan: add.w,
              rowSpan: add.h,
              ...(add.spec ? { spec: add.spec } : {}),
            };
          }
          seeded[TEMPLATE_MARKER] = TEMPLATE_VERSION;
          setOverrides(seeded);
          saveLayout(seeded);
        } else {
          setOverrides(initial);
          if (repaired) saveLayout(initial);
        }
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
          // Display-side repair only — the client that loads/edits next
          // persists the fixed layout; repairing here without a PUT avoids
          // several clients racing to heal the same snapshot.
          setOverrides(data.layout && typeof data.layout === 'object'
            ? repairLayout(data.layout).layout
            : {});
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
    // PTZ / Weather cards only render once seeded into the layout.
    if (overrides[PTZ_ID]) {
      out[PTZ_ID] = { colSpan: PTZ_W, rowSpan: PTZ_H, ...overrides[PTZ_ID] };
    }
    if (overrides[WEATHER_ID]) {
      out[WEATHER_ID] = { colSpan: WEATHER_W, rowSpan: WEATHER_H, ...overrides[WEATHER_ID] };
    }
    for (const [id, entry] of Object.entries(overrides)) {
      if (!entry || typeof entry !== 'object') continue;
      if (id.startsWith('custom-') || id.startsWith('tpl-')) {
        out[id] = { colSpan: 6, rowSpan: 6, ...entry };
      }
    }
    return out;
  }, [cameras, overrides, defaults]);

  // Keep --cell exact: the stylesheet fallback derives it from 100vw,
  // which includes a classic scrollbar's width — the grid's 1fr tracks
  // don't. Free-placed (absolute) tiles are positioned in --cell units,
  // so they'd drift up to ~15px against the grid. Measure the grid's
  // real client width and pin --cell in pixels; ResizeObserver keeps it
  // fresh across rotations / scrollbar appearance.
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return undefined;
    const apply = () => {
      const cs = getComputedStyle(el);
      const gap = parseFloat(cs.rowGap || cs.gap || '0') || 0;
      const cell = (el.clientWidth - (GRID_COLS + 1) * gap) / GRID_COLS;
      if (cell > 0) el.style.setProperty('--cell', `${cell}px`);
    };
    apply();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Latest effective layout for stable callbacks (event handlers run after
  // render, so the ref is always in sync by the time they fire).
  const layoutRef = useRef(layout);
  useEffect(() => { layoutRef.current = layout; }, [layout]);

  // Merge a patch into overrides for one tile and (optionally) persist.
  const updateTile = useCallback((id, patch, persistNow) => {
    setOverrides((prev) => {
      const existing = prev[id] || {};
      const merged = { ...(layoutRef.current[id] || {}), ...existing, ...patch };
      const next = { ...prev, [id]: merged };
      if (persistNow) persist.schedule(next, 400);
      return next;
    });
  }, [persist]);

  const setFit = useCallback((id, fit) => {
    if (!FIT_MODES.includes(fit)) return;
    setOverrides((prev) => {
      const merged = { ...(layoutRef.current[id] || {}), ...(prev[id] || {}), fit };
      const next = { ...prev, [id]: merged };
      persist.schedule(next, 200);
      return next;
    });
  }, [persist]);

  // Restore a layout from a downloaded backup file. Replaces the whole
  // shared layout (every client follows via SSE).
  const restoreLayout = useCallback((layoutObj) => {
    if (!layoutObj || typeof layoutObj !== 'object' || Array.isArray(layoutObj)) return;
    // Backups taken before a repair shipped still carry the old defects —
    // heal them on the way in so a restore can't reintroduce them.
    const { layout: repaired } = repairLayout(layoutObj);
    setOverrides(repaired);
    persist.schedule(repaired, 0);
  }, [persist]);

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
    // Default sizes tuned for the 48-col grid. Scene tiles are wide —
    // they hold a whole chip list.
    const w = spec.kind === 'lightfx' ? 12 : spec.kind === 'number' ? 8 : 6;
    const h = spec.kind === 'lightfx' ? 6 : spec.kind === 'number' ? 5 : 6;
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

  const removeCustomTile = useCallback((id) => {
    setOverrides((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      persist.schedule(next, 0);
      return next;
    });
  }, [persist]);

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

  const startDrag = useCallback((id, e, kind) => {
    e.preventDefault();
    e.stopPropagation();
    const gridEl = gridRef.current;
    if (!gridEl) return;
    const gridRect = gridEl.getBoundingClientRect();
    const cs = getComputedStyle(gridEl);
    const gap = parseFloat(cs.rowGap || cs.gap || '0') || 0;
    const cellW = (gridRect.width - (GRID_COLS - 1) * gap) / GRID_COLS;
    const metrics = { gap, cellW, cellH: cellW };
    const eff = layoutRef.current[id];
    if (!eff) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const startCol = eff.col;
    const startRow = eff.row;
    const startColSpan = eff.colSpan;
    const startRowSpan = eff.rowSpan;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }

    // The pop effect targets the tile root even when the gesture starts
    // on the resize handle.
    const tileEl = e.currentTarget.closest?.('.tile, .custom-tile') || e.currentTarget;

    // Touch move-gestures arm after a short hold (long-press with a pop +
    // haptic tick) so a stray swipe never drags tiles around; mouse drags
    // and the resize handle arm immediately. A plain tap (no hold, no
    // movement) opens the tile editor for user-owned tiles.
    const isTouch = e.pointerType === 'touch' || e.pointerType === 'pen';
    const needsHold = isTouch && kind === 'move';
    const canOpenEditor = kind === 'move'
      && (id.startsWith('custom-') || id.startsWith('tpl-') || id === SECURITY_ID);
    let armed = !needsHold;
    let lifted = false;
    let moved = false;
    let holdTimer = null;

    const lift = () => {
      if (lifted) return;
      lifted = true;
      tileEl.classList.add('tile-lifted');
      if (isTouch && navigator.vibrate) navigator.vibrate(12);
    };
    const teardown = () => {
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
      tileEl.classList.remove('tile-lifted');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };

    const onMove = (ev) => {
      if (!moved
          && (Math.abs(ev.clientX - startX) > DRAG_THRESHOLD_PX
              || Math.abs(ev.clientY - startY) > DRAG_THRESHOLD_PX)) {
        moved = true;
        // Finger drifted before the hold armed the drag — an accidental
        // brush, not an edit. Give up quietly.
        if (!armed) { teardown(); return; }
        lift();
      }
      if (!armed || !moved) return;
      const stepX = metrics.cellW + metrics.gap;
      const stepY = metrics.cellH + metrics.gap;
      // Snap on: whole-cell quantisation (a value that lands on an integer
      // returns the tile to normal grid flow). Snap off: 1/20-cell steps —
      // fine enough to feel free, coarse enough to keep saved layouts tidy.
      const snap = snapRef.current;
      const q = snap
        ? Math.round
        : (n) => Math.round(n * 20) / 20;
      const dCol = (ev.clientX - startX) / stepX;
      const dRow = (ev.clientY - startY) / stepY;
      if (kind === 'move') {
        const col = clamp(q(startCol + dCol), 1, GRID_COLS - startColSpan + 1);
        const row = Math.max(1, q(startRow + dRow));
        if (col !== eff.col || row !== eff.row) updateTile(id, { col, row }, true);
      } else {
        const colSpan = clamp(q(startColSpan + dCol), 1, GRID_COLS - startCol + 1);
        const rowSpan = Math.max(1, q(startRowSpan + dRow));
        if (colSpan !== eff.colSpan || rowSpan !== eff.rowSpan) updateTile(id, { colSpan, rowSpan }, true);
      }
    };
    const onUp = () => {
      const wasTap = !moved && !lifted;
      teardown();
      if (moved) { persist.flush(); return; }
      if (wasTap && canOpenEditor) setEditingTileId(id);
    };

    if (needsHold) {
      holdTimer = setTimeout(() => {
        if (moved) return;
        armed = true;
        lift();
      }, HOLD_TO_DRAG_MS);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, [updateTile, persist]);

  // Per-tile event handlers with stable identities. Tiles are memoised;
  // handing each one fresh arrow functions per render would defeat that,
  // so handlers are minted once per tile id and dispatch through refs.
  const startDragRef = useRef(startDrag);
  useEffect(() => { startDragRef.current = startDrag; }, [startDrag]);
  const setFitRef = useRef(setFit);
  useEffect(() => { setFitRef.current = setFit; }, [setFit]);
  const tileHandlersRef = useRef(new Map());
  const tileHandlers = (id) => {
    let h = tileHandlersRef.current.get(id);
    if (!h) {
      h = {
        onStartMove: (e) => startDragRef.current(id, e, 'move'),
        onStartResize: (e) => startDragRef.current(id, e, 'resize'),
        onSetFit: (mode) => setFitRef.current(id, mode),
      };
      tileHandlersRef.current.set(id, h);
    }
    return h;
  };

  const onFlowPointChange = useCallback(
    (pt) => updateTile(SOLAR_ID, { flowX: pt.x, flowY: pt.y }, true),
    [updateTile],
  );
  const onCalloutPosChange = useCallback((key, pos) => {
    setOverrides((prev) => {
      const existing = prev[SOLAR_ID] || {};
      const callouts = {
        ...(existing.callouts || layoutRef.current[SOLAR_ID]?.callouts || {}),
        [key]: pos,
      };
      const merged = { ...(layoutRef.current[SOLAR_ID] || {}), ...existing, callouts };
      const next = { ...prev, [SOLAR_ID]: merged };
      persist.schedule(next, 400);
      return next;
    });
  }, [persist]);

  const customEntries = useMemo(() => Object.entries(overrides).filter(
    ([id, v]) => (id.startsWith('custom-') || id.startsWith('tpl-')) && v && v.spec
  ), [overrides]);

  // Free-placed tiles are absolutely positioned, so they don't stretch the
  // grid. Give the grid an explicit min-height covering the lowest tile so
  // one parked below the in-flow content stays scrollable-to.
  const gridMinHeight = useMemo(() => {
    let maxRowEnd = 0;
    let anyFree = false;
    for (const l of Object.values(layout)) {
      if (!l || !Number.isFinite(l.row) || !Number.isFinite(l.rowSpan)) continue;
      if (isFreePlacement(l.col, l.row, l.colSpan, l.rowSpan)) anyFree = true;
      maxRowEnd = Math.max(maxRowEnd, l.row + l.rowSpan);
    }
    if (!anyFree || maxRowEnd <= 1) return undefined;
    const rows = maxRowEnd - 1;
    return { minHeight: `calc(${rows} * var(--cell) + ${rows + 1} * var(--gap))` };
  }, [layout]);

  // Dashboard background colour (shared appearance setting). Overrides the
  // theme's --bg variable at the root, so the grid, gaps and the page edge
  // all follow; clearing it restores the stylesheet default. A light
  // background also flips --text/--muted dark so page-level text (notices,
  // tiles without their own background) stays readable on it.
  const themeBg = overrides[THEME_KEY]?.bg || null;
  useEffect(() => {
    const root = document.documentElement;
    const textVars = themeBg ? textVarsFor(themeBg) : null;
    const clear = () => {
      root.style.removeProperty('--bg');
      root.style.removeProperty('--text');
      root.style.removeProperty('--muted');
    };
    clear();
    if (themeBg) {
      root.style.setProperty('--bg', themeBg);
      for (const [k, v] of Object.entries(textVars || {})) root.style.setProperty(k, v);
    }
    return clear;
  }, [themeBg]);

  const setThemeBg = (bg) => {
    setOverrides((prev) => {
      const theme = { ...(prev[THEME_KEY] || {}) };
      if (bg) theme.bg = bg;
      else delete theme.bg;
      const next = { ...prev };
      if (Object.keys(theme).length > 0) next[THEME_KEY] = theme;
      else delete next[THEME_KEY];
      persist.schedule(next, 200);
      return next;
    });
  };

  return (
    <>
      <PullToRefresh />
      <SideMenu
        editMode={editMode}
        onToggleEdit={() => setEditMode((v) => !v)}
        onResetLayout={resetLayout}
        snapToGrid={snapToGrid}
        onToggleSnap={() => setSnapToGrid((v) => !v)}
        onAddTile={addCustomTile}
        bgDemo={bgDemo}
        onToggleBgDemo={() => setBgDemo((v) => !v)}
        themeBg={themeBg}
        onSetThemeBg={setThemeBg}
        onRestoreLayout={restoreLayout}
      />

      <main
        ref={gridRef}
        className={`grid ${editMode ? 'grid-edit' : ''}`}
        style={gridMinHeight}
      >
        {loading && <div className="notice" style={{ gridColumn: `1 / -1` }}>Loading dashboard…</div>}
        {error && (
          <div className="notice notice-error" style={{ gridColumn: `1 / -1` }}>
            Failed to load: {error}
          </div>
        )}
        {!error && camerasError && (
          <div className="notice" style={{ gridColumn: `1 / -1` }}>
            Cameras unavailable ({camerasError}) — rest of the dashboard is live.
          </div>
        )}
        {!loading && !error && cameras.length === 0 && customEntries.length === 0 && (
          <div className="notice" style={{ gridColumn: `1 / -1` }}>No cameras or tiles configured.</div>
        )}
        {cameras.map((cam) => {
          const l = layout[cam.id];
          if (!l) return null;
          const wide = l.colSpan >= Math.ceil(GRID_COLS / 2);
          const h = tileHandlers(cam.id);
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
              onStartMove={h.onStartMove}
              onStartResize={h.onStartResize}
              onSetFit={h.onSetFit}
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
            onStartMove={tileHandlers(SOLAR_ID).onStartMove}
            onStartResize={tileHandlers(SOLAR_ID).onStartResize}
            bgDemo={bgDemo}
            flowX={layout[SOLAR_ID].flowX ?? 78}
            flowY={layout[SOLAR_ID].flowY ?? 50}
            onFlowPointChange={onFlowPointChange}
            calloutPos={layout[SOLAR_ID].callouts || null}
            onCalloutPosChange={onCalloutPosChange}
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
            onStartMove={tileHandlers(SECURITY_ID).onStartMove}
            onStartResize={tileHandlers(SECURITY_ID).onStartResize}
            showZones={layout[SECURITY_ID].showZones !== false}
            showPir={layout[SECURITY_ID].showPir !== false}
          />
        )}
        {layout[PTZ_ID] && (
          <PtzCard
            key={PTZ_ID}
            col={layout[PTZ_ID].col}
            row={layout[PTZ_ID].row}
            colSpan={layout[PTZ_ID].colSpan}
            rowSpan={layout[PTZ_ID].rowSpan}
            editMode={editMode}
            onStartMove={tileHandlers(PTZ_ID).onStartMove}
            onStartResize={tileHandlers(PTZ_ID).onStartResize}
          />
        )}
        {layout[WEATHER_ID] && (
          <WeatherCard
            key={WEATHER_ID}
            col={layout[WEATHER_ID].col}
            row={layout[WEATHER_ID].row}
            colSpan={layout[WEATHER_ID].colSpan}
            rowSpan={layout[WEATHER_ID].rowSpan}
            editMode={editMode}
            onStartMove={tileHandlers(WEATHER_ID).onStartMove}
            onStartResize={tileHandlers(WEATHER_ID).onStartResize}
          />
        )}
        {customEntries.map(([id, entry]) => {
          const l = layout[id];
          if (!l) return null;
          const h = tileHandlers(id);
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
              onStartMove={h.onStartMove}
              onStartResize={h.onStartResize}
              onRemove={removeCustomTile}
              onEdit={setEditingTileId}
            />
          );
        })}
      </main>

      {editingTileId === SECURITY_ID && (
        <SecurityOptions
          showZones={layout[SECURITY_ID]?.showZones !== false}
          showPir={layout[SECURITY_ID]?.showPir !== false}
          onChange={(patch) => updateTile(SECURITY_ID, patch, true)}
          onClose={() => setEditingTileId(null)}
        />
      )}
      {editingTileId && editingTileId !== SECURITY_ID && overrides[editingTileId] && (
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
