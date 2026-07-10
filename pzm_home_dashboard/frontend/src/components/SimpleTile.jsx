import { useCallback, useEffect, useRef, useState } from 'react';
import LightControl from './LightControl.jsx';

const POLL_MS = 5000;
const LONG_PRESS_MS = 450;
const LONG_PRESS_MOVE_PX = 8;

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
  const [lightOpen, setLightOpen] = useState(false);
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

  // For light entities that expose brightness or colour, a long-press on
  // the tile opens the LightControl modal (dim slider + colour swatches).
  // Non-lights and simple on/off bulbs keep the plain toggle-on-tap flow.
  const isDimmable = spec.domain === 'light' && !!state?.light
    && (state.light.supportsBrightness || state.light.supportsColor);

  const pressRef = useRef({ timer: null, x: 0, y: 0, fired: false });
  const cancelLongPress = () => {
    const p = pressRef.current;
    if (p.timer) { clearTimeout(p.timer); p.timer = null; }
  };
  const btnHandlers = !editMode && isDimmable ? {
    onPointerDown: (e) => {
      if (e.button !== 0) return;
      const p = pressRef.current;
      p.fired = false;
      p.x = e.clientX; p.y = e.clientY;
      cancelLongPress();
      p.timer = setTimeout(() => {
        p.fired = true;
        setLightOpen(true);
      }, LONG_PRESS_MS);
    },
    onPointerMove: (e) => {
      const p = pressRef.current;
      if (!p.timer) return;
      if (Math.abs(e.clientX - p.x) > LONG_PRESS_MOVE_PX
          || Math.abs(e.clientY - p.y) > LONG_PRESS_MOVE_PX) {
        cancelLongPress();
      }
    },
    onPointerUp: () => cancelLongPress(),
    onPointerCancel: () => cancelLongPress(),
    onClick: (e) => {
      if (pressRef.current.fired) { e.preventDefault(); e.stopPropagation(); return; }
      trigger();
    },
  } : {
    onClick: editMode ? undefined : trigger,
  };

  return (
    <div
      className={`tile custom-tile ${tileStateCls} ${editMode ? 'tile-editing' : ''}`}
      style={style}
      onPointerDown={editMode ? (e) => e.button === 0 && onStartMove(e) : undefined}
      onContextMenu={editMode ? (e) => e.preventDefault() : undefined}
      title={editMode
        ? `${spec.entityId}\nLong-press to edit`
        : isDimmable
          ? `${spec.entityId}\nLong-press for dim + colour`
          : spec.entityId}
    >
      <button
        type="button"
        className="custom-btn-inner"
        disabled={editMode || busy}
        {...btnHandlers}
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
      {lightOpen && (
        <LightControl
          entityId={spec.entityId}
          name={spec.name}
          initial={state}
          onChanged={() => setTimeout(load, 400)}
          onClose={() => setLightOpen(false)}
        />
      )}
    </div>
  );
}

// Curated icon catalog. The key ends up in `spec.icon` from the picker so
// it survives layout persistence. `aliases` feeds the icon-picker search
// box (matching also considers the key itself). Add/rename here to expose
// to the UI. Grouped roughly by domain — lighting, HVAC/climate, kitchen,
// utility rooms, security, media, energy, outdoor, sensors, generic.
export const TILE_ICONS = [
  // --- Meta ---
  { key: 'auto',        aliases: 'default automatic domain' },

  // --- Lighting ---
  { key: 'light',       aliases: 'bulb ceiling room lamp home' },
  { key: 'lamp',        aliases: 'table floor bedside home' },
  { key: 'desk-lamp',   aliases: 'reading office study work lamp' },
  { key: 'torch',       aliases: 'wall outdoor flame home' },
  { key: 'chandelier',  aliases: 'ceiling dining pendant crystal light' },
  { key: 'led-strip',   aliases: 'ambient bar tape light ribbon' },
  { key: 'nightlight',  aliases: 'kids nursery bedroom dim' },
  { key: 'rgb',         aliases: 'color led ambient bulb home' },
  { key: 'sign',        aliases: 'label plate street' },
  { key: 'scene',       aliases: 'star mood preset lighting' },

  // --- Switches / outlets ---
  { key: 'switch',      aliases: 'toggle outlet plug' },
  { key: 'outlet',      aliases: 'plug socket power point wall' },
  { key: 'usb',         aliases: 'plug charger device' },
  { key: 'button',      aliases: 'press dot round' },
  { key: 'script',      aliases: 'automation run play home' },
  { key: 'automation',  aliases: 'trigger routine schedule loop' },

  // --- Doors / windows / covers ---
  { key: 'door',        aliases: 'entry room home open' },
  { key: 'window',      aliases: 'glass pane sash home' },
  { key: 'cover',       aliases: 'blind shade curtain shutter roller' },
  { key: 'curtain',     aliases: 'drape cloth window home' },
  { key: 'blinds',      aliases: 'roller venetian window shade' },
  { key: 'awning',      aliases: 'terrace patio sun shade outdoor' },
  { key: 'garage',      aliases: 'car parking door home' },
  { key: 'gate',        aliases: 'fence yard entrance' },
  { key: 'lock',        aliases: 'door secure padlock home' },
  { key: 'keypad',      aliases: 'code pin access lock alarm' },

  // --- Climate / HVAC ---
  { key: 'thermostat',  aliases: 'heating ac climate temperature home' },
  { key: 'temperature', aliases: 'thermometer heat home climate' },
  { key: 'humidity',    aliases: 'moisture damp home comfort' },
  { key: 'ac',          aliases: 'air conditioning cool heat pump home' },
  { key: 'heat-pump',   aliases: 'heating cooling hvac home boiler' },
  { key: 'radiator',    aliases: 'heater warmth home comfort' },
  { key: 'boiler',      aliases: 'water hot heater tank home' },
  { key: 'underfloor',  aliases: 'floor heating warm feet' },
  { key: 'fan',         aliases: 'ventilator ceiling home cool' },
  { key: 'ceiling-fan', aliases: 'fan blade circulation cool' },
  { key: 'ventilation', aliases: 'exhaust fresh air recovery' },
  { key: 'purifier',    aliases: 'air quality filter clean' },
  { key: 'humidifier',  aliases: 'moisture add mist' },
  { key: 'dehumidifier',aliases: 'moisture remove dry basement' },

  // --- Kitchen ---
  { key: 'kitchen',     aliases: 'cook home stove' },
  { key: 'oven',        aliases: 'kitchen bake home' },
  { key: 'microwave',   aliases: 'reheat kitchen' },
  { key: 'stove',       aliases: 'cook hob induction kitchen' },
  { key: 'fridge',      aliases: 'refrigerator kitchen home cold' },
  { key: 'freezer',     aliases: 'kitchen frozen storage' },
  { key: 'dishwasher',  aliases: 'kitchen home' },
  { key: 'kettle',      aliases: 'boiler water hot kitchen home' },
  { key: 'coffee',      aliases: 'espresso kitchen home' },
  { key: 'blender',     aliases: 'kitchen smoothie mixer' },
  { key: 'toaster',     aliases: 'bread breakfast kitchen' },

  // --- Utility / laundry ---
  { key: 'washer',      aliases: 'laundry washing home' },
  { key: 'dryer',       aliases: 'laundry tumble clothes' },
  { key: 'iron',        aliases: 'laundry clothes press' },
  { key: 'vacuum',      aliases: 'robot cleaner home' },
  { key: 'mop',         aliases: 'floor clean bucket water' },

  // --- Media / office ---
  { key: 'tv',          aliases: 'television media home' },
  { key: 'projector',   aliases: 'cinema movie beamer screen' },
  { key: 'speaker',     aliases: 'sonos audio media music' },
  { key: 'music',       aliases: 'speaker media audio home note' },
  { key: 'headphones',  aliases: 'audio quiet listening' },
  { key: 'game',        aliases: 'console controller playstation xbox' },
  { key: 'printer',     aliases: 'office print paper' },
  { key: 'computer',    aliases: 'pc desktop office' },
  { key: 'laptop',      aliases: 'computer portable office' },
  { key: 'phone',       aliases: 'mobile cell smart' },
  { key: 'tablet',      aliases: 'ipad slate device' },

  // --- Network ---
  { key: 'router',      aliases: 'wifi network internet home' },
  { key: 'wifi',        aliases: 'network signal internet' },
  { key: 'server',      aliases: 'nas rack network home lab' },
  { key: 'antenna',     aliases: 'signal broadcast radio' },

  // --- Security / sensors ---
  { key: 'camera',      aliases: 'security cctv home' },
  { key: 'doorbell',    aliases: 'ring intercom home' },
  { key: 'motion',      aliases: 'pir sensor movement home' },
  { key: 'presence',    aliases: 'occupancy person home mmwave' },
  { key: 'alarm',       aliases: 'siren security home' },
  { key: 'shield',      aliases: 'protection security guard' },
  { key: 'smoke',       aliases: 'alarm fire detector safety' },
  { key: 'co',          aliases: 'carbon monoxide gas detector alarm' },
  { key: 'leak',        aliases: 'water flood moisture damp sensor' },

  // --- Energy / EV ---
  { key: 'sun',         aliases: 'solar day home' },
  { key: 'moon',        aliases: 'night sleep bedtime home' },
  { key: 'solar-panel', aliases: 'pv photovoltaic roof energy' },
  { key: 'wind',        aliases: 'turbine breeze weather generator' },
  { key: 'battery',     aliases: 'storage charge energy home' },
  { key: 'ev-charger',  aliases: 'car charging electric vehicle plug' },
  { key: 'car',         aliases: 'ev vehicle garage' },
  { key: 'meter',       aliases: 'electricity kwh utility gauge' },
  { key: 'gauge',       aliases: 'dial pressure level indicator' },
  { key: 'bolt',        aliases: 'power watt current electricity flash' },

  // --- Outdoor / garden ---
  { key: 'garden',      aliases: 'plant flower yard outdoor tree' },
  { key: 'tree',        aliases: 'plant garden outdoor forest' },
  { key: 'sprinkler',   aliases: 'irrigation water garden lawn' },
  { key: 'mower',       aliases: 'lawn robot garden grass' },
  { key: 'pool',        aliases: 'swim water outdoor spa' },
  { key: 'hot-tub',     aliases: 'spa jacuzzi outdoor water' },
  { key: 'grill',       aliases: 'bbq outdoor cook' },
  { key: 'mailbox',     aliases: 'post letter delivery outdoor' },
  { key: 'flag',        aliases: 'garden marker pole yard' },

  // --- Rooms ---
  { key: 'bed',         aliases: 'bedroom sleep home' },
  { key: 'sofa',        aliases: 'living room couch home' },
  { key: 'bathroom',    aliases: 'shower bath home' },
  { key: 'shower',      aliases: 'bath water bathroom' },
  { key: 'toilet',      aliases: 'wc restroom bathroom' },
  { key: 'stairs',      aliases: 'hallway floor level up down' },
  { key: 'workshop',    aliases: 'tools shed garage diy' },

  // --- Water / sensors ---
  { key: 'water',       aliases: 'droplet leak humidity home' },
  { key: 'valve',       aliases: 'water gas shutoff pipe' },
  { key: 'tank',        aliases: 'level waste rainwater cistern' },
  { key: 'pump',        aliases: 'water pressure boost pool' },

  // --- Sensors / metrics ---
  { key: 'weather',     aliases: 'forecast outside cloud rain sun' },
  { key: 'rain',        aliases: 'weather cloud precipitation' },
  { key: 'snow',        aliases: 'weather cold winter' },
  { key: 'wind-sock',   aliases: 'weather speed direction outdoor' },
  { key: 'compass',     aliases: 'direction navigation orientation' },
  { key: 'clock',       aliases: 'time schedule timer' },
  { key: 'timer',       aliases: 'countdown clock stopwatch' },
  { key: 'calendar',    aliases: 'schedule date planner' },
  { key: 'bell',        aliases: 'notification alert ring doorbell' },

  // --- Generic ---
  { key: 'fire',        aliases: 'flame stove alarm heat' },
  { key: 'star',        aliases: 'favorite bookmark preset scene' },
  { key: 'heart',       aliases: 'favorite health love' },
  { key: 'gift',        aliases: 'holiday present party' },
  { key: 'question',    aliases: 'unknown help placeholder' },
  { key: 'power',       aliases: 'on off electricity default' },
];

export const TILE_ICON_KEYS = TILE_ICONS.map((i) => i.key);

const ICON_PATHS = {
  light:      'M9 21h6v-1H9v1zm3-19a7 7 0 0 0-4 12.7V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.3A7 7 0 0 0 12 2z',
  lamp:       'M6 2h12l-2 8h-8L6 2zm2 10h8v6h2v3H6v-3h2v-6z',
  torch:      'M9 2h6l-1 4h-4L9 2zm-1 5h8v3l-4 13-4-13V7z',
  sign:       'M6 3h12l3 4-3 4H6V3zm0 10h9l3 4-3 4H6v-8zM4 3h1v18H4V3z',
  switch_on:  'M17 6H7a6 6 0 0 0 0 12h10a6 6 0 0 0 0-12zm0 10a4 4 0 1 1 0-8 4 4 0 0 1 0 8z',
  switch_off: 'M7 6a6 6 0 0 0 0 12h10a6 6 0 0 0 0-12H7zm0 10a4 4 0 1 1 0-8 4 4 0 0 1 0 8z',
  outlet:     'M6 2h12v20H6V2zm2 5h2v4H8V7zm6 0h2v4h-2V7zm-3 8a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',
  cover:      'M4 3h16v2H4zM6 6h12v14H6zM8 8v10h8V8H8z',
  curtain:    'M3 3h18v2H3V3zm2 3h6v14H5V6zm8 0h6v14h-6V6zM7 8v10h2V8H7zm8 0v10h2V8h-2z',
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
  window:     'M4 3h16v18H4V3zm2 2v7h5V5H6zm7 0v7h5V5h-5zM6 14v5h5v-5H6zm7 0v5h5v-5h-5z',
  rgb:        'M12 2a10 10 0 0 0 0 20c1 0 2-1 2-2s-1-1-1-2 1-1 2-1h2a5 5 0 0 0 5-5c0-6-4-10-10-10zm-4 6a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm8 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm-4-3a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z',
  music:      'M9 3v11.1a3 3 0 1 0 2 2.8V6h6V3H9z',
  thermostat: 'M13 3v9.3a3.5 3.5 0 1 1-2 0V3h2z',
  temperature:'M12 3a3 3 0 0 0-3 3v8.35a5 5 0 1 0 6 0V6a3 3 0 0 0-3-3zm-1 3a1 1 0 1 1 2 0v9.02a3 3 0 1 1-2 0V6z',
  humidity:   'M12 2.5s-6.5 7.5-6.5 12.5a6.5 6.5 0 1 0 13 0C18.5 10 12 2.5 12 2.5zm-3 12a1 1 0 0 1 1-1c.55 0 1 .45 1 1 0 1.66-1.79 3-4 3v-2c.83 0 2 -.34 2 -1z',
  ac:         'M11 2v3H8l3 3 3-3h-3V2h0zm-9 9h3v3l3-3-3-3v3H2zm18 0h-3V8l-3 3 3 3v-3h3zm-9 8v-3h3l-3-3-3 3h3v3z',
  'heat-pump':'M12 3a4 4 0 0 0-4 4c0 2 4 6 4 6s4-4 4-6a4 4 0 0 0-4-4zm-8 12v6h16v-6H4zm3 2a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm5 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm5 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2z',
  radiator:   'M4 4h2v16H4V4zm4 0h2v16H8V4zm4 0h2v16h-2V4zm4 0h2v16h-2V4zm4 0h2v16h-2V4z',
  kettle:     'M6 8h11a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-9zm11 2v9H8v-9h9zM6 8V6a2 2 0 0 1 2-2h8V2H8a4 4 0 0 0-4 4v2h2z',
  coffee:     'M4 4h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V4zm2 2v4a3 3 0 0 0 3 3h3a3 3 0 0 0 3-3V6H6zm12 1h2a3 3 0 0 1 0 6h-1v-2h1a1 1 0 0 0 0-2h-2V7zM3 19h15v2H3v-2z',
  oven:       'M4 3h16v18H4V3zm2 2v4h12V5H6zm0 6v8h12v-8H6zm2 2h8v4H8v-4z',
  fridge:     'M6 2h12v20H6V2zm2 2v6h8V4H8zm0 8v8h8v-8H8zm1 1h2v3H9v-3zm0-7h2v3H9V5z',
  washer:     'M5 3h14v18H5V3zm2 2v3h10V5H7zm5 4a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6z',
  dishwasher: 'M4 3h16v18H4V3zm2 2v3h12V5H6zm0 5v9h12v-9H6zm2 1h2v2H8v-2zm4 0h2v2h-2v-2zm4 0h2v2h-2v-2z',
  vacuum:     'M12 3a8 8 0 0 0-8 8v6h16v-6a8 8 0 0 0-8-8zm-1 4h2v4h-2V7zM6 15h12v2H6v-2zm2-6h1v3H8V9zm7 0h1v3h-1V9z',
  tv:         'M3 5h18v11H3V5zm2 2v7h14V7H5zm4 11h6v2H9v-2z',
  router:     'M2 15h20v4H2v-4zm2 1v2h2v-2H4zm4 0v2h2v-2H8zm4 0v2h2v-2h-2zM12 5v5m-4-3 4-4 4 4M6 10a6 6 0 0 1 12 0',
  wifi:       'M12 4a13 13 0 0 0-9.5 4l2 2A10 10 0 0 1 12 7a10 10 0 0 1 7.5 3l2-2A13 13 0 0 0 12 4zm0 5a8 8 0 0 0-5.7 2.3l2 2A5 5 0 0 1 12 12a5 5 0 0 1 3.7 1.3l2-2A8 8 0 0 0 12 9zm0 5a3 3 0 0 0-2.1.9L12 17l2.1-2.1A3 3 0 0 0 12 14z',
  camera:     'M9 4h6l2 3h3v13H4V7h3l2-3zm3 5a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6z',
  doorbell:   'M12 2a5 5 0 0 0-5 5v7a2 2 0 0 1-2 2h14a2 2 0 0 1-2-2V7a5 5 0 0 0-5-5zm-2 17h4a2 2 0 1 1-4 0z',
  motion:     'M13 2a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM5 22l3-9 3 2 3-4 5 5-1 1-4-3-3 4-3-2-1 6H5z',
  alarm:      'M12 3a2 2 0 0 1 2 2v.4A7 7 0 0 1 19 12v5l2 2v1H3v-1l2-2v-5a7 7 0 0 1 5-6.6V5a2 2 0 0 1 2-2zm-2 18a2 2 0 0 0 4 0h-4z',
  shield:     'M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3zm-1 6h2v4h-2V8zm0 6h2v2h-2v-2z',
  sun:        'M12 4v2m0 12v2m8-8h-2M4 12H2m14.24-5.66-1.42 1.42M7.18 16.82l-1.42 1.42m0-12.72 1.42 1.42m9.06 9.06 1.42 1.42M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z',
  moon:       'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  bed:        'M3 8h11a4 4 0 0 1 4 4v3h3v5h-2v-2H5v2H3V8zm2 2v5h11v-3a2 2 0 0 0-2-2H5zm2 1a2 2 0 1 1 4 0 2 2 0 0 1-4 0z',
  kitchen:    'M6 2h12v20H6V2zm2 2v6h8V4H8zm0 8v8h8v-8H8zm1 1h6v2H9v-2zm0 4h6v1H9v-1zm2-10a1 1 0 1 1 2 0 1 1 0 0 1-2 0z',
  bathroom:   'M6 4a3 3 0 0 1 6 0v6H4v3a5 5 0 0 0 4 4.9V21h2v-3.1a5 5 0 0 0 4-4.9v-3H8a1 1 0 0 1 0-2h2V7H8a3 3 0 0 1-2-3zm14 0h2v9h-2V4z',
  sofa:       'M3 11a2 2 0 0 1 4 0v3h10v-3a2 2 0 1 1 4 0v6h-2v2h-2v-2H7v2H5v-2H3v-6zm4 3v-2a4 4 0 0 1 4-4h2a4 4 0 0 1 4 4v2H7z',
  battery:    'M7 4h10v2h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h1V4zm-1 4v11h12V8H6zm2 3h8v6H8v-6z',
  'ev-charger':'M6 3h9v9H6V3zm2 2v5h5V5H8zm-1 9h11v6H7v-6zm2 2v2h2v-2H9zm4 0v2h2v-2h-2zM17 5l3 3v6h-2v-3h-2V5h1z',
  power:      'M13 3v10h-2V3h2zm5.4 3.6-1.4 1.4a7 7 0 1 1-10 0L5.6 6.6a9 9 0 1 0 12.8 0z',

  // Lighting extras
  'desk-lamp':'M13 3l6 3-2 5-5-2 1-6zm-1 8 2-1 3 6-2 1-3-6zm-2 8h10v2H10v-2zm2-4v3h6v-3h-6z',
  chandelier: 'M11 2h2v3h-2V2zm-1 4h4v2h-4V6zM4 10h16l-1 3H5l-1-3zm3 4 2 5H6l1-5zm5 0v6h-2v-6h2zm2 0 2 5h-3l1-5zm-9 6h14v2H5v-2z',
  'led-strip':'M3 10h18v4H3v-4zm2 2h1v-1h1v1h1v-1h1v1h1v-1h1v1h1v-1h1v1h1v-1h1v1h1v-1h1v1h1',
  nightlight: 'M4 20h16v-2H4v2zm2-4h12l-1-9h-3l-1-3h-2l-1 3H7l-1 9zm5-4a2 2 0 1 1 4 0 2 2 0 0 1-4 0z',

  // Switches/outlets
  usb:        'M12 2 8 8h3v10h-2v-3H7a2 2 0 0 1-2-2v-2h1v-3H4v3h1v2a3 3 0 0 0 3 3h1v3h4v-6h1a3 3 0 0 0 3-3v-2h1V9h-2v3h1v2a2 2 0 0 1-2 2h-1V8h3l-4-6z',
  automation: 'M12 6V3l4 4-4 4V8a5 5 0 0 0-5 5H5a7 7 0 0 1 7-7zm0 15v-3a5 5 0 0 0 5-5h2a7 7 0 0 1-7 7l4-4-4-4v3l0 6z',

  // Doors/windows/covers
  blinds:     'M4 3h16v2H4V3zm0 3h16v3H4V6zm0 4h16v3H4v-3zm0 4h16v3H4v-3zm0 4h16v2H4v-2zm7 3h2v3h-2v-3z',
  awning:     'M4 4h16v2H4V4zm-1 3h18l-2 6H5L3 7zm4 8h10v6H7v-6zm2 2v2h6v-2H9z',
  keypad:     'M5 3h14v18H5V3zm2 2v3h4V5H7zm6 0v3h4V5h-4zM7 10v3h4v-3H7zm6 0v3h4v-3h-4zM7 15v3h4v-3H7zm6 0v3h4v-3h-4z',

  // Climate
  boiler:     'M5 3h14v18H5V3zm2 2v3h10V5H7zm0 5v9h10v-9H7zm3 2h4v5h-4v-5zm-2-9a1 1 0 1 1 2 0 1 1 0 0 1-2 0z',
  underfloor: 'M3 4h18v2H3V4zm0 4h18v2H3V8zm0 4h18v2H3v-2zm0 4h18v2H3v-2zm0 4h18v2H3v-2zM8 9h2v10H8V9zm4-4h2v14h-2V5zm4 4h2v10h-2V9z',
  'ceiling-fan':'M12 2a3 3 0 0 1 3 3v1h-6V5a3 3 0 0 1 3-3zm-9 8a7 7 0 0 1 7-7h4a7 7 0 0 1 7 7c-3 0-6-1-8-3v6a2 2 0 1 1-2 0V7c-2 2-5 3-8 3z',
  ventilation:'M4 4h16v6H4V4zm2 2v2h12V6H6zm-2 8h16v6H4v-6zm2 2v2h12v-2H6zm2-6 2 1-2 1v-2zm10 8-2-1 2-1v2z',
  purifier:   'M6 2h12v20H6V2zm2 2v3h8V4H8zm0 5v11h8V9H8zm3 1h2v2h-2v-2zm-1 4h4v1h-4v-1zm0 3h4v1h-4v-1z',
  humidifier: 'M12 2s-6 8-6 12a6 6 0 0 0 12 0c0-4-6-12-6-12zm-1 10a1 1 0 1 1 2 0 1 1 0 0 1-2 0zM8 20h8v2H8v-2z',
  dehumidifier:'M12 2s-6 8-6 12a6 6 0 0 0 12 0c0-4-6-12-6-12zM8 12h8v2H8v-2zm0 4h8v2H8v-2z',

  // Kitchen
  microwave:  'M2 5h20v14H2V5zm2 2v10h11V7H4zm13 0v10h3V7h-3zm-11 2h7v6H6V9zm12 1a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm0 3a1 1 0 1 1 0 2 1 1 0 0 1 0-2z',
  stove:      'M4 4h16v16H4V4zm2 2v12h12V6H6zm2 2h3v3H8V8zm5 0h3v3h-3V8zm-5 5h3v3H8v-3zm5 0h3v3h-3v-3z',
  freezer:    'M6 2h12v20H6V2zm2 2v6h8V4H8zm0 8v8h8v-8H8zm3 1v1h-1v1h1v3h1v-3h1v-1h-1v-1h-1zm-2-8h2v2H9V5z',
  blender:    'M8 2h8l-1 8H9L8 2zm1 10h6l-1 5h-4l-1-5zm2 6h2v4h-2v-4z',
  toaster:    'M4 8h16v9H4V8zm2 2v5h12v-5H6zm2 1h2v3H8v-3zm5 0h2v3h-2v-3zm-2-8v3h2V3h-2z',

  // Utility
  dryer:      'M5 3h14v18H5V3zm2 2v3h10V5H7zm5 4a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm-2 3a2 2 0 1 1 4 0v2a2 2 0 1 1-4 0v-2z',
  iron:       'M3 15v-3l3-6h13l-2 9H3zm2-1h13l1-6H7l-2 6zm-2 2h18v2H3v-2z',
  mop:        'M11 2h2v9h-2V2zM6 12h12l1 8H5l1-8zm2 2-1 4h10l-1-4H8z',

  // Media
  projector:  'M4 8h13a3 3 0 0 1 0 6H4V8zm11 3a2 2 0 1 0 0-2 2 2 0 0 0 0 2zm-4 4v3h-2v-3h2zm4 0v3h-2v-3h2z',
  speaker:    'M6 2h12v20H6V2zm2 2v3h8V4H8zm4 4a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm0-6a1 1 0 1 1 0 2 1 1 0 0 1 0-2z',
  headphones: 'M12 3a8 8 0 0 0-8 8v5h4V13H6v-2a6 6 0 1 1 12 0v2h-2v3h4v-5a8 8 0 0 0-8-8z',
  game:       'M6 8h12a4 4 0 0 1 0 8h-1l-2-2H9l-2 2H6a4 4 0 0 1 0-8zm2 3v2h2v-2H8zm7 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm-6 0v2H7v-2h2zm9 2a1 1 0 1 1 0-2 1 1 0 0 1 0 2z',
  printer:    'M6 3h12v5H6V3zm-2 6h16v9h-3v3H7v-3H4V9zm3 2a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm2 4h8v5H9v-5z',
  computer:   'M3 4h18v12H3V4zm2 2v8h14V6H5zm-1 12h16v2H4v-2z',
  laptop:     'M4 5h16v11H4V5zm2 2v7h12V7H6zm-4 10h20v2H2v-2z',
  phone:      'M7 2h10v20H7V2zm2 2v14h6V4H9zm2 15h2v1h-2v-1z',
  tablet:     'M5 3h14v18H5V3zm2 2v14h10V5H7zm4 12h2v1h-2v-1z',

  // Network
  server:     'M4 3h16v6H4V3zm0 8h16v6H4v-6zm0 8h16v2H4v-2zm3-14a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm0 8a1 1 0 1 1 0 2 1 1 0 0 1 0-2z',
  antenna:    'M12 2 5 20h2l1-3h8l1 3h2L12 2zm0 6 2 7h-4l2-7zm-1 10a1 1 0 1 1 2 0 1 1 0 0 1-2 0z',

  // Security
  presence:   'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm-6 12a6 6 0 0 1 12 0v6H6v-6z',
  smoke:      'M8 3h8v6h-3l1 3H7l1-3H5l3-6zm-1 12h10v2H7v-2zm2 4h6v2H9v-2z',
  co:         'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 2a7 7 0 1 1 0 14 7 7 0 0 1 0-14zm-3 5a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm6 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',
  leak:       'M12 2s-8 9-8 14 3.5 6 8 6 8-1 8-6-8-14-8-14zm-2 15c-2 0-4-1-4-3h2c0 1 1 1 2 1v2z',

  // Energy
  'solar-panel':'M3 5h18v14H3V5zm2 2v10h5V7H5zm7 0v10h7V7h-7zm-4 1v3h-3V8h3zm7 0v3h-4V8h4zm-7 5v3h-3v-3h3zm7 0v3h-4v-3h4z',
  wind:       'M4 8h9a3 3 0 1 1-3 3v0h9m-9 5h6a2 2 0 1 1-2 2v0h9',
  car:        'M4 12l2-5h12l2 5v6h-3v-2H7v2H4v-6zm3-3-1 3h12l-1-3H7zm-1 5a1 1 0 1 1 2 0 1 1 0 0 1-2 0zm10 0a1 1 0 1 1 2 0 1 1 0 0 1-2 0z',
  meter:      'M12 3a9 9 0 0 0-9 9h2a7 7 0 0 1 14 0h2a9 9 0 0 0-9-9zm-1 4v6l-3 3 1 1 4-4V7h-2z',
  gauge:      'M12 4a8 8 0 0 0-8 8h2a6 6 0 0 1 12 0h2a8 8 0 0 0-8-8zm-1 5v4l-2 2 1 1 4-4V9h-3z',
  bolt:       'M13 2 4 14h6l-1 8 10-13h-7l1-7z',

  // Outdoor
  tree:       'M12 2a6 6 0 0 0-6 6c0 3 2 5 4 6v2H6v2h5v4h2v-4h5v-2h-4v-2c2-1 4-3 4-6a6 6 0 0 0-6-6z',
  sprinkler:  'M11 2h2v6h-2V2zm-8 6h18v2H3V8zm2 3 3 5H4l1-5zm14 0 1 5h-4l3-5zm-8 0h2v11h-2V11z',
  mower:      'M4 12h4l1-4h6l1 4h4v6H4v-6zm3 2a2 2 0 1 1 4 0 2 2 0 0 1-4 0zm7 0a2 2 0 1 1 4 0 2 2 0 0 1-4 0z',
  pool:       'M3 15c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2v2c-2 0-2 2-4 2s-2-2-4-2-2 2-4 2-2-2-4-2v-2zm5-11h8v9h-8V4zm2 2v5h4V6h-4z',
  'hot-tub':  'M6 10h12v2H6v-2zm-2 3h16v6H4v-6zm2 2v2h12v-2H6zm3-11a2 2 0 1 1 4 0 2 2 0 0 1-4 0zm5 2a2 2 0 1 1 4 0 2 2 0 0 1-4 0z',
  grill:     'M6 3h12v3H6V3zM4 8h16l-1 4H5L4 8zm2 6h12l-1 4h-2v3h-2v-3h-2v3H9v-3H7l-1-4z',
  mailbox:   'M6 8h12a3 3 0 0 1 3 3v9H3V11a3 3 0 0 1 3-3zm0 2a1 1 0 0 0-1 1v7h5v-7a1 1 0 0 0-1-1H6zm2 2h2v2H8v-2zM6 2h6v6h-2V4H6V2z',
  flag:      'M5 3h1v18H5V3zm2 0h10l-2 4 2 4H7V3z',

  // Rooms
  shower:    'M7 3h10v3l3 3v11h-2v-9l-1-1H8L7 11v9H5V9l3-3V3zm2 2v2h6V5H9zm-1 8a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm3 3a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm3-2a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm-6-4a1 1 0 1 1 0 2 1 1 0 0 1 0-2z',
  toilet:    'M5 3h14v6H5V3zm2 2v2h10V5H7zm-2 5h14v3l-2 5h-2v3h-6v-3H7l-2-5v-3zm2 2v1l1 3h8l1-3v-1H7z',
  stairs:    'M3 21V3h18v4h-4v4h-4v4H9v4H3zm2-2h4v-4h4v-4h4V9h4V5H5v14z',
  workshop:  'M4 4h16v3H4V4zm1 5h14v11H5V9zm2 2v7h5v-7H7zm7 0 4 4-1 1-3-3v-2zm-2 5h4v2h-4v-2z',

  // Water
  valve:     'M11 2h2v4h-2V2zM4 10h16v4H4v-4zm2 2v2h12v-2H6zm5-6h2v4h-2V6zm-3 14h8v2H8v-2zm4-3v3h-2v-3h2zm2 0v3h-2v-3h2z',
  tank:      'M5 5h14v13a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V5zm2 2v11c0 .55.45 1 1 1h8c.55 0 1-.45 1-1V7H7zm2 2h6v2H9V9zm0 4h6v2H9v-2zm0 4h6v1H9v-1z',
  pump:      'M7 3h10v6h-4v2h5l3 3v7h-2v-6l-1-1H6l-1 1v6H3v-7l3-3h5V9H7V3zm2 2v2h6V5H9z',

  // Sensors / metrics
  weather:   'M6 15a4 4 0 0 1 1-8 5 5 0 0 1 9 1 4 4 0 0 1-1 8H6zm2 3h2v3H8v-3zm4 0h2v3h-2v-3zm4 0h2v3h-2v-3z',
  rain:      'M6 12a4 4 0 0 1 1-8 5 5 0 0 1 9 1 4 4 0 0 1-1 8H6zm2 3 1-3h1l-1 3H8zm3 3 1-3h1l-1 3h-1zm3-3 1-3h1l-1 3h-1z',
  snow:      'M12 2v20M2 12h20M4 4l16 16M20 4 4 20',
  'wind-sock':'M4 4v16h2v-6h2c4 0 6-2 6-5s-2-5-6-5H4zm2 2h2c2.5 0 4 1 4 3s-1.5 3-4 3H6V6zm10 3 6 3-6 3v-2h-3v-2h3V9z',
  compass:   'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 2a7 7 0 1 1 0 14 7 7 0 0 1 0-14zm-1 4 5-2-2 5 2 5-5-2-5 2 2-5-2-5 5 2z',
  clock:     'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 2a7 7 0 1 1 0 14 7 7 0 0 1 0-14zm-1 3v5l4 2 1-2-3-1V8h-2z',
  timer:     'M9 2h6v2H9V2zm-3 6 1-2 2 1 1-1a7 7 0 1 1-4 2zm5 3v4h5v-2h-3v-2h-2z',
  calendar:  'M4 5h16v16H4V5zm2 2v3h12V7H6zm0 5v7h12v-7H6zm2 1h2v2H8v-2zm4 0h2v2h-2v-2zm4 0h2v2h-2v-2zM8 2h2v3H8V2zm6 0h2v3h-2V2z',
  bell:      'M12 2a5 5 0 0 0-5 5v6l-2 2v1h14v-1l-2-2V7a5 5 0 0 0-5-5zm-2 17h4a2 2 0 1 1-4 0z',

  // Generic
  star:      'M12 2l2.4 6.7L21 10l-5 4.6L17.5 22 12 18.3 6.5 22 8 14.6 3 10l6.6-1.3z',
  heart:     'M12 21s-8-5-8-11a5 5 0 0 1 8-4 5 5 0 0 1 8 4c0 6-8 11-8 11z',
  gift:      'M4 12h16v9H4v-9zm7 0v9h2v-9h-2zM3 8h18v4H3V8zm7 0V6a2 2 0 1 1 2 0v2h-2zm4 0V6a2 2 0 1 1 2 2h-2z',
  question:  'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm-1 12h2v2h-2v-2zm2-2h-2c0-2 3-2 3-4a2 2 0 0 0-4 0H8a4 4 0 1 1 8 0c0 3-3 3-3 4z',
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

// Icons whose path is drawn as a stroked outline (thin-line style) rather
// than solid fill. Keeps outlets/wifi/sun/etc. legible at tile sizes.
const STROKE_ICONS = new Set([
  'sun', 'wifi', 'router', 'led-strip', 'wind', 'snow',
]);

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
  if (STROKE_ICONS.has(key)) {
    return (
      <svg viewBox="0 0 24 24">
        <path
          d={d}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
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
