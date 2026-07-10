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
        ? `${spec.entityId}\nTap to edit · hold to drag`
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
  { key: 'light',       aliases: 'bulb ceiling room lamp home', pack: 'lighting' },
  { key: 'lamp',        aliases: 'table floor bedside home', pack: 'lighting' },
  { key: 'desk-lamp',   aliases: 'reading office study work lamp', pack: 'lighting' },
  { key: 'torch',       aliases: 'wall outdoor flame home', pack: 'lighting' },
  { key: 'chandelier',  aliases: 'ceiling dining pendant crystal light', pack: 'lighting' },
  { key: 'led-strip',   aliases: 'ambient bar tape light ribbon', pack: 'lighting' },
  { key: 'nightlight',  aliases: 'kids nursery bedroom dim', pack: 'lighting' },
  { key: 'rgb',         aliases: 'color led ambient bulb home', pack: 'lighting' },
  { key: 'sign',        aliases: 'label plate street', pack: 'lighting' },
  { key: 'scene',       aliases: 'star mood preset lighting', pack: 'lighting' },

  // --- Switches / outlets ---
  { key: 'switch',      aliases: 'toggle outlet plug', pack: 'switches' },
  { key: 'outlet',      aliases: 'plug socket power point wall', pack: 'switches' },
  { key: 'usb',         aliases: 'plug charger device', pack: 'switches' },
  { key: 'button',      aliases: 'press dot round', pack: 'switches' },
  { key: 'script',      aliases: 'automation run play home', pack: 'switches' },
  { key: 'automation',  aliases: 'trigger routine schedule loop', pack: 'switches' },

  // --- Doors / windows / covers ---
  { key: 'door',        aliases: 'entry room home open', pack: 'doors' },
  { key: 'window',      aliases: 'glass pane sash home', pack: 'doors' },
  { key: 'cover',       aliases: 'blind shade curtain shutter roller', pack: 'doors' },
  { key: 'curtain',     aliases: 'drape cloth window home', pack: 'doors' },
  { key: 'blinds',      aliases: 'roller venetian window shade', pack: 'doors' },
  { key: 'awning',      aliases: 'terrace patio sun shade outdoor', pack: 'doors' },
  { key: 'garage',      aliases: 'car parking door home', pack: 'doors' },
  { key: 'gate',        aliases: 'fence yard entrance', pack: 'doors' },
  { key: 'lock',        aliases: 'door secure padlock home', pack: 'doors' },
  { key: 'keypad',      aliases: 'code pin access lock alarm', pack: 'doors' },

  // --- Climate / HVAC ---
  { key: 'thermostat',  aliases: 'heating ac climate temperature home', pack: 'climate' },
  { key: 'temperature', aliases: 'thermometer heat home climate', pack: 'climate' },
  { key: 'humidity',    aliases: 'moisture damp home comfort', pack: 'climate' },
  { key: 'ac',          aliases: 'air conditioning cool heat pump home', pack: 'climate' },
  { key: 'heat-pump',   aliases: 'heating cooling hvac home boiler', pack: 'climate' },
  { key: 'radiator',    aliases: 'heater warmth home comfort', pack: 'climate' },
  { key: 'boiler',      aliases: 'water hot heater tank home', pack: 'climate' },
  { key: 'underfloor',  aliases: 'floor heating warm feet', pack: 'climate' },
  { key: 'fan',         aliases: 'ventilator ceiling home cool', pack: 'climate' },
  { key: 'ceiling-fan', aliases: 'fan blade circulation cool', pack: 'climate' },
  { key: 'ventilation', aliases: 'exhaust fresh air recovery', pack: 'climate' },
  { key: 'purifier',    aliases: 'air quality filter clean', pack: 'climate' },
  { key: 'humidifier',  aliases: 'moisture add mist', pack: 'climate' },
  { key: 'dehumidifier',aliases: 'moisture remove dry basement', pack: 'climate' },

  // --- Kitchen ---
  { key: 'kitchen',     aliases: 'cook home stove', pack: 'kitchen' },
  { key: 'oven',        aliases: 'kitchen bake home', pack: 'kitchen' },
  { key: 'microwave',   aliases: 'reheat kitchen', pack: 'kitchen' },
  { key: 'stove',       aliases: 'cook hob induction kitchen', pack: 'kitchen' },
  { key: 'fridge',      aliases: 'refrigerator kitchen home cold', pack: 'kitchen' },
  { key: 'freezer',     aliases: 'kitchen frozen storage', pack: 'kitchen' },
  { key: 'dishwasher',  aliases: 'kitchen home', pack: 'kitchen' },
  { key: 'kettle',      aliases: 'boiler water hot kitchen home', pack: 'kitchen' },
  { key: 'coffee',      aliases: 'espresso kitchen home', pack: 'kitchen' },
  { key: 'blender',     aliases: 'kitchen smoothie mixer', pack: 'kitchen' },
  { key: 'toaster',     aliases: 'bread breakfast kitchen', pack: 'kitchen' },

  // --- Utility / laundry ---
  { key: 'washer',      aliases: 'laundry washing home', pack: 'utility' },
  { key: 'dryer',       aliases: 'laundry tumble clothes', pack: 'utility' },
  { key: 'iron',        aliases: 'laundry clothes press', pack: 'utility' },
  { key: 'vacuum',      aliases: 'robot cleaner home', pack: 'utility' },
  { key: 'mop',         aliases: 'floor clean bucket water', pack: 'utility' },

  // --- Media / office ---
  { key: 'tv',          aliases: 'television media home', pack: 'media' },
  { key: 'projector',   aliases: 'cinema movie beamer screen', pack: 'media' },
  { key: 'speaker',     aliases: 'sonos audio media music', pack: 'media' },
  { key: 'music',       aliases: 'speaker media audio home note', pack: 'media' },
  { key: 'headphones',  aliases: 'audio quiet listening', pack: 'media' },
  { key: 'game',        aliases: 'console controller playstation xbox', pack: 'media' },
  { key: 'printer',     aliases: 'office print paper', pack: 'media' },
  { key: 'computer',    aliases: 'pc desktop office', pack: 'media' },
  { key: 'laptop',      aliases: 'computer portable office', pack: 'media' },
  { key: 'phone',       aliases: 'mobile cell smart', pack: 'media' },
  { key: 'tablet',      aliases: 'ipad slate device', pack: 'media' },

  // --- Network ---
  { key: 'router',      aliases: 'wifi network internet home', pack: 'network' },
  { key: 'wifi',        aliases: 'network signal internet', pack: 'network' },
  { key: 'server',      aliases: 'nas rack network home lab', pack: 'network' },
  { key: 'antenna',     aliases: 'signal broadcast radio', pack: 'network' },

  // --- Security / sensors ---
  { key: 'camera',      aliases: 'security cctv home', pack: 'security' },
  { key: 'doorbell',    aliases: 'ring intercom home', pack: 'security' },
  { key: 'motion',      aliases: 'pir sensor movement home', pack: 'security' },
  { key: 'presence',    aliases: 'occupancy person home mmwave', pack: 'security' },
  { key: 'alarm',       aliases: 'siren security home', pack: 'security' },
  { key: 'shield',      aliases: 'protection security guard', pack: 'security' },
  { key: 'smoke',       aliases: 'alarm fire detector safety', pack: 'security' },
  { key: 'co',          aliases: 'carbon monoxide gas detector alarm', pack: 'security' },
  { key: 'leak',        aliases: 'water flood moisture damp sensor', pack: 'security' },

  // --- Energy / EV ---
  { key: 'sun',         aliases: 'solar day home', pack: 'energy' },
  { key: 'moon',        aliases: 'night sleep bedtime home', pack: 'energy' },
  { key: 'solar-panel', aliases: 'pv photovoltaic roof energy', pack: 'energy' },
  { key: 'wind',        aliases: 'turbine breeze weather generator', pack: 'energy' },
  { key: 'battery',     aliases: 'storage charge energy home', pack: 'energy' },
  { key: 'ev-charger',  aliases: 'car charging electric vehicle plug', pack: 'energy' },
  { key: 'car',         aliases: 'ev vehicle garage', pack: 'energy' },
  { key: 'meter',       aliases: 'electricity kwh utility gauge', pack: 'energy' },
  { key: 'gauge',       aliases: 'dial pressure level indicator', pack: 'energy' },
  { key: 'bolt',        aliases: 'power watt current electricity flash', pack: 'energy' },

  // --- Outdoor / garden ---
  { key: 'garden',      aliases: 'plant flower yard outdoor tree', pack: 'outdoor' },
  { key: 'tree',        aliases: 'plant garden outdoor forest', pack: 'outdoor' },
  { key: 'sprinkler',   aliases: 'irrigation water garden lawn', pack: 'outdoor' },
  { key: 'mower',       aliases: 'lawn robot garden grass', pack: 'outdoor' },
  { key: 'pool',        aliases: 'swim water outdoor spa', pack: 'outdoor' },
  { key: 'hot-tub',     aliases: 'spa jacuzzi outdoor water', pack: 'outdoor' },
  { key: 'grill',       aliases: 'bbq outdoor cook', pack: 'outdoor' },
  { key: 'mailbox',     aliases: 'post letter delivery outdoor', pack: 'outdoor' },
  { key: 'flag',        aliases: 'garden marker pole yard', pack: 'outdoor' },

  // --- Rooms / furniture ---
  { key: 'bed',         aliases: 'bedroom sleep home', pack: 'rooms' },
  { key: 'sofa',        aliases: 'living room couch home', pack: 'rooms' },
  { key: 'chair',       aliases: 'seat dining office home', pack: 'rooms' },
  { key: 'dining-table',aliases: 'table eat food kitchen', pack: 'rooms' },
  { key: 'desk',        aliases: 'workspace office table study', pack: 'rooms' },
  { key: 'wardrobe',    aliases: 'closet clothes bedroom storage', pack: 'rooms' },
  { key: 'bookshelf',   aliases: 'books library reading office', pack: 'rooms' },
  { key: 'photo-frame', aliases: 'picture art wall home', pack: 'rooms' },
  { key: 'fireplace',   aliases: 'chimney fire cozy heat living room', pack: 'rooms' },
  { key: 'bathroom',    aliases: 'shower bath home', pack: 'rooms' },
  { key: 'shower',      aliases: 'bath water bathroom', pack: 'rooms' },
  { key: 'toilet',      aliases: 'wc restroom bathroom', pack: 'rooms' },
  { key: 'stairs',      aliases: 'hallway floor level up down', pack: 'rooms' },
  { key: 'workshop',    aliases: 'tools shed garage diy', pack: 'rooms' },
  { key: 'wrench',      aliases: 'tool diy service maintenance', pack: 'rooms' },
  { key: 'plant',       aliases: 'houseplant pot leaf green home', pack: 'rooms' },
  { key: 'plant-pot',   aliases: 'pot succulent indoor plant', pack: 'rooms' },
  { key: 'aquarium',    aliases: 'fish tank pet water', pack: 'rooms' },

  // --- Lights: more variety ---
  { key: 'pendant',     aliases: 'ceiling hanging light kitchen dining', pack: 'lighting' },
  { key: 'spotlight',   aliases: 'downlight recessed ceiling light beam', pack: 'lighting' },
  { key: 'wall-light',  aliases: 'sconce lamp wall home', pack: 'lighting' },
  { key: 'floor-lamp',  aliases: 'standing lamp corner light', pack: 'lighting' },
  { key: 'garden-light',aliases: 'path outdoor lamp yard', pack: 'lighting' },

  // --- Pets / people ---
  { key: 'pet',         aliases: 'dog cat animal home', pack: 'pets' },
  { key: 'dog',         aliases: 'pet puppy paw home', pack: 'pets' },
  { key: 'cat',         aliases: 'pet kitten paw home', pack: 'pets' },
  { key: 'paw',         aliases: 'pet feeder cat dog', pack: 'pets' },
  { key: 'baby',        aliases: 'child kids nursery bedroom', pack: 'pets' },
  { key: 'stroller',    aliases: 'baby child kids outdoor', pack: 'pets' },

  // --- Household misc ---
  { key: 'broom',       aliases: 'cleaning sweep floor chore', pack: 'household' },
  { key: 'trash',       aliases: 'bin garbage waste recycle', pack: 'household' },
  { key: 'recycle',     aliases: 'trash bin recycling waste', pack: 'household' },
  { key: 'candle',      aliases: 'ambient flame cozy scent', pack: 'household' },
  { key: 'gift-box',    aliases: 'present holiday party', pack: 'household' },

  // --- Variants: alternative styles for common concepts ---
  // Lights
  { key: 'bulb-edison', aliases: 'lightbulb filament vintage bulb light', pack: 'lighting' },
  { key: 'bulb-round',  aliases: 'globe orb bulb round light', pack: 'lighting' },
  { key: 'bulb-flame',  aliases: 'chandelier candle flame bulb light', pack: 'lighting' },
  { key: 'panel-light', aliases: 'led flat panel ceiling office', pack: 'lighting' },
  { key: 'string-light',aliases: 'fairy party outdoor string light', pack: 'lighting' },
  // Doors
  { key: 'door-double', aliases: 'french door pair entry', pack: 'doors' },
  { key: 'door-sliding',aliases: 'patio sliding glass door', pack: 'doors' },
  { key: 'door-glass',  aliases: 'balcony transparent glass door', pack: 'doors' },
  // Locks
  { key: 'lock-smart',  aliases: 'digital keyless smart lock', pack: 'security' },
  { key: 'padlock',     aliases: 'padlock outdoor secure lock', pack: 'security' },
  { key: 'deadbolt',    aliases: 'bolt lock front door', pack: 'security' },
  // Beds
  { key: 'bed-single',  aliases: 'twin single bed kids', pack: 'rooms' },
  { key: 'bed-double',  aliases: 'queen king double bed master', pack: 'rooms' },
  { key: 'crib',        aliases: 'baby cot nursery', pack: 'rooms' },
  // Vehicles
  { key: 'car-side',    aliases: 'sedan ev garage side view', pack: 'transport' },
  { key: 'car-front',   aliases: 'ev vehicle front headlights', pack: 'transport' },
  { key: 'suv',         aliases: 'van bigger vehicle family', pack: 'transport' },
  { key: 'bicycle',     aliases: 'bike sport outdoor', pack: 'transport' },
  { key: 'scooter',     aliases: 'e-scooter kick urban', pack: 'transport' },
  // Cameras
  { key: 'camera-dome', aliases: 'ceiling dome cctv surveillance', pack: 'security' },
  { key: 'camera-bullet',aliases: 'bullet outdoor cctv wall', pack: 'security' },
  { key: 'camera-ptz',  aliases: 'pan tilt zoom cctv', pack: 'security' },
  // Sensors
  { key: 'sensor',      aliases: 'chip module generic sensor', pack: 'security' },
  { key: 'radar',       aliases: 'mmwave presence radar', pack: 'security' },
  // Windows / rooms
  { key: 'window-round',aliases: 'porthole round window', pack: 'rooms' },
  { key: 'skylight',    aliases: 'roof ceiling skylight', pack: 'rooms' },
  // Furniture variants
  { key: 'armchair',    aliases: 'lounge chair living', pack: 'rooms' },
  { key: 'stool',       aliases: 'bar stool kitchen', pack: 'rooms' },
  { key: 'bench',       aliases: 'entry hall outdoor bench', pack: 'rooms' },
  // Drinkware
  { key: 'mug',         aliases: 'tea cup coffee mug hot', pack: 'kitchen' },
  { key: 'glass',       aliases: 'water drink glass', pack: 'kitchen' },
  { key: 'wine',        aliases: 'glass drink dinner alcohol', pack: 'kitchen' },
  // Plant variants
  { key: 'flower',      aliases: 'blossom bloom plant garden', pack: 'outdoor' },
  { key: 'cactus',      aliases: 'succulent desert plant', pack: 'outdoor' },
  { key: 'palm',        aliases: 'tropical tree outdoor plant', pack: 'outdoor' },
  // Tools
  { key: 'screwdriver', aliases: 'tool diy', pack: 'household' },
  { key: 'hammer',      aliases: 'tool diy build', pack: 'household' },
  { key: 'toolbox',     aliases: 'diy tools maintenance', pack: 'household' },
  // Weather variants
  { key: 'cloud',       aliases: 'sky weather overcast', pack: 'weather' },
  { key: 'thunder',     aliases: 'storm weather lightning', pack: 'weather' },
  { key: 'fog',         aliases: 'mist weather visibility', pack: 'weather' },
  { key: 'umbrella',    aliases: 'rain outdoor weather cover', pack: 'weather' },
  // Recreation / outdoor
  { key: 'bbq',         aliases: 'grill outdoor cook meat', pack: 'outdoor' },
  { key: 'firepit',     aliases: 'campfire outdoor patio', pack: 'outdoor' },
  { key: 'hammock',     aliases: 'outdoor rest garden', pack: 'outdoor' },
  // Notifications
  { key: 'phone-ring',  aliases: 'call ringing dial', pack: 'misc' },
  { key: 'message',     aliases: 'chat sms bubble', pack: 'misc' },
  { key: 'envelope',    aliases: 'mail email letter', pack: 'misc' },

  // --- Water / sensors ---
  { key: 'water',       aliases: 'droplet leak humidity home', pack: 'sensors' },
  { key: 'valve',       aliases: 'water gas shutoff pipe', pack: 'sensors' },
  { key: 'tank',        aliases: 'level waste rainwater cistern', pack: 'sensors' },
  { key: 'pump',        aliases: 'water pressure boost pool', pack: 'sensors' },

  // --- Sensors / metrics ---
  { key: 'weather',     aliases: 'forecast outside cloud rain sun', pack: 'sensors' },
  { key: 'rain',        aliases: 'weather cloud precipitation', pack: 'sensors' },
  { key: 'snow',        aliases: 'weather cold winter', pack: 'sensors' },
  { key: 'wind-sock',   aliases: 'weather speed direction outdoor', pack: 'sensors' },
  { key: 'compass',     aliases: 'direction navigation orientation', pack: 'sensors' },
  { key: 'clock',       aliases: 'time schedule timer', pack: 'sensors' },
  { key: 'timer',       aliases: 'countdown clock stopwatch', pack: 'sensors' },
  { key: 'calendar',    aliases: 'schedule date planner', pack: 'sensors' },
  { key: 'bell',        aliases: 'notification alert ring doorbell', pack: 'sensors' },

  // --- Generic ---
  { key: 'fire',        aliases: 'flame stove alarm heat', pack: 'misc' },
  { key: 'star',        aliases: 'favorite bookmark preset scene', pack: 'misc' },
  { key: 'heart',       aliases: 'favorite health love', pack: 'misc' },
  { key: 'gift',        aliases: 'holiday present party', pack: 'misc' },
  { key: 'question',    aliases: 'unknown help placeholder', pack: 'misc' },
  { key: 'power',       aliases: 'on off electricity default', pack: 'misc' },

  // --- Transport (beyond the car variants above) ---
  { key: 'bus',         aliases: 'coach shuttle public school', pack: 'transport' },
  { key: 'train',       aliases: 'rail metro subway commute', pack: 'transport' },
  { key: 'plane',       aliases: 'flight travel airport holiday', pack: 'transport' },
  { key: 'boat',        aliases: 'sail ship yacht water', pack: 'transport' },
  { key: 'truck',       aliases: 'lorry delivery van cargo', pack: 'transport' },

  // --- Holidays / seasonal ---
  { key: 'xmas-tree',   aliases: 'christmas holiday winter season fir', pack: 'holidays' },
  { key: 'snowflake',   aliases: 'winter frost christmas cold season', pack: 'holidays' },
  { key: 'snowman',     aliases: 'winter christmas holiday season', pack: 'holidays' },
  { key: 'pumpkin',     aliases: 'halloween autumn harvest season', pack: 'holidays' },
  { key: 'fireworks',   aliases: 'new year party celebration burst', pack: 'holidays' },
  { key: 'balloon',     aliases: 'birthday party celebration kids', pack: 'holidays' },

  // --- Fitness / health ---
  { key: 'dumbbell',    aliases: 'gym weights workout exercise', pack: 'fitness' },
  { key: 'running',     aliases: 'jog exercise treadmill sport', pack: 'fitness' },
  { key: 'pulse',       aliases: 'heartbeat health rate monitor ecg', pack: 'fitness' },
  { key: 'pill',        aliases: 'medicine medication health capsule', pack: 'fitness' },
  { key: 'first-aid',   aliases: 'medical kit emergency health cross', pack: 'fitness' },

  // --- Food & drink ---
  { key: 'burger',      aliases: 'food fast dinner snack takeaway', pack: 'food' },
  { key: 'cake',        aliases: 'birthday dessert party candle', pack: 'food' },
  { key: 'beer',        aliases: 'drink pint pub lager alcohol', pack: 'food' },
  { key: 'cocktail',    aliases: 'drink martini bar party alcohol', pack: 'food' },
  { key: 'ice-cream',   aliases: 'dessert cone gelato summer', pack: 'food' },

  // --- Security extras ---
  { key: 'siren',       aliases: 'alarm horn strobe security sound', pack: 'security' },
  { key: 'key',         aliases: 'unlock access door spare', pack: 'security' },
  { key: 'safe',        aliases: 'vault valuables lock storage', pack: 'security' },
  { key: 'fence',       aliases: 'perimeter yard boundary picket', pack: 'security' },
  { key: 'intercom',    aliases: 'doorphone entry audio talk', pack: 'security' },
  { key: 'contact',     aliases: 'door window magnet reed sensor', pack: 'security' },
  { key: 'vibration',   aliases: 'shake shock tamper sensor', pack: 'security' },
  { key: 'sound',       aliases: 'noise audio level decibel sensor', pack: 'security' },

  // --- Energy extras ---
  { key: 'pylon',       aliases: 'grid power line utility transmission electricity', pack: 'energy' },
  { key: 'generator',   aliases: 'backup power engine petrol diesel', pack: 'energy' },
  { key: 'power-strip', aliases: 'extension sockets outlets multi plug', pack: 'energy' },

  // --- Lighting extras ---
  { key: 'street-lamp', aliases: 'pole outdoor path drive light', pack: 'lighting' },
  { key: 'ceiling-light',aliases: 'flush mount dome plafond light', pack: 'lighting' },

  // --- Outdoor extras ---
  { key: 'greenhouse',  aliases: 'garden plants glass grow house', pack: 'outdoor' },
  { key: 'well',        aliases: 'water borehole pump garden', pack: 'outdoor' },
  { key: 'fountain',    aliases: 'water feature pond garden', pack: 'outdoor' },
  { key: 'swing',       aliases: 'playground kids garden play', pack: 'outdoor' },
  { key: 'doghouse',    aliases: 'kennel dog pet outdoor', pack: 'outdoor' },

  // --- Kitchen / rooms extras ---
  { key: 'range-hood',  aliases: 'extractor kitchen vent cooker exhaust', pack: 'kitchen' },
  { key: 'balcony',     aliases: 'terrace railing outdoor room', pack: 'rooms' },
  { key: 'mirror',      aliases: 'dressing bathroom hallway glass', pack: 'rooms' },
  { key: 'home',        aliases: 'house main building dashboard', pack: 'rooms' },

  // --- Media extras ---
  { key: 'remote',      aliases: 'control tv media buttons', pack: 'media' },
  { key: 'radio',       aliases: 'fm receiver tuner music', pack: 'media' },
  { key: 'microphone',  aliases: 'mic voice assistant record', pack: 'media' },

  // --- Misc extras ---
  { key: 'robot',       aliases: 'bot assistant ai android automation', pack: 'misc' },
  { key: 'map-pin',     aliases: 'location gps place marker zone', pack: 'misc' },
];

export const TILE_ICON_KEYS = TILE_ICONS.map((i) => i.key);

const ICON_PATHS = {
  light:      'M9 22h6v-2H9v2zm3-20a7 7 0 0 0-4 12.7V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.3A7 7 0 0 0 12 2zm-2 15v-2.9l-.5-.4a5 5 0 1 1 5 0l-.5.4V17h-4z',
  lamp:       'M7 2h10l-2 7H9L7 2zm2 8h6v6h2v3h1v2H6v-2h1v-3h2v-6zm2 2v4h2v-4h-2z',
  torch:      'M8 2h8l-1 4h-6L8 2zm-1 5h10v4l-5 13-5-13V7zm2 2v2h6V9H9z',
  sign:       'M6 3h12l3 4-3 4H6V3zm0 10h9l3 4-3 4H6v-8zM4 3h1v18H4V3z',
  switch_on:  'M17 6H7a6 6 0 0 0 0 12h10a6 6 0 0 0 0-12zm0 10a4 4 0 1 1 0-8 4 4 0 0 1 0 8z',
  switch_off: 'M7 6a6 6 0 0 0 0 12h10a6 6 0 0 0 0-12H7zm0 10a4 4 0 1 1 0-8 4 4 0 0 1 0 8z',
  outlet:     'M5 3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H5zm4 5h2v4H9V8zm4 0h2v4h-2V8zm-1 6a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',
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
  garage:     'M12 3 3 9v12h4v-9h10v9h4V9l-9-6zm-4 11v6h8v-6H8zm1 1h6v1H9v-1zm0 2h6v1H9v-1zm0 2h6v1H9v-1z',
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
  bed:        'M2 8v11h2v-2h16v2h2v-6a4 4 0 0 0-4-4h-7v5H4V8H2zm5 3a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z',
  kitchen:    'M5 2v20h14V2H5zm2 2h10v6H7V4zm0 8h10v8H7v-8zm2 1v6h6v-6H9zm1 1h4v1h-4v-1zm0 2h4v1h-4v-1zm2-11a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z',
  bathroom:   'M6 4a3 3 0 0 1 6 0v6H4v3a5 5 0 0 0 4 4.9V21h2v-3.1a5 5 0 0 0 4-4.9v-3H8a1 1 0 0 1 0-2h2V7H8a3 3 0 0 1-2-3zm14 0h2v9h-2V4z',
  sofa:       'M4 10a3 3 0 0 0-3 3v6h2v-2h18v2h2v-6a3 3 0 0 0-3-3 3 3 0 0 0-3 3v2H7v-2a3 3 0 0 0-3-3zm4 4h8v-3a2 2 0 0 1 2-2H8a2 2 0 0 1 2 2v3z',
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
  stairs:    'M2 22V15h4v-4h4V7h4V3h8v2h-6v4h-4v4H8v4H4v3H2v2z',
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

  // Rooms / furniture
  chair:        'M5 21v-4h14v4h-2v-2H7v2H5zm2-6V6h10v9H7zm2-7v5h6V8H9z',
  'dining-table':'M3 8h18v2H3V8zm1 3h16v2H4v-2zm0 4h2v6H4v-6zm14 0h2v6h-2v-6z',
  desk:         'M3 6h18v3H3V6zm1 4h4v11H7v-8H4V10zm12 0h4v3h-3v8h-1V10zM4 14h4v2H4v-2z',
  wardrobe:     'M4 3h16v18h-2v-2H6v2H4V3zm2 2v12h5V5H6zm7 0v12h5V5h-5zm-3 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm4 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2z',
  bookshelf:    'M3 3h18v18H3V3zm2 2v4h14V5H5zm0 6v4h14v-4H5zm0 6v2h14v-2H5zM7 6h1v2H7V6zm2 0h1v2H9V6zm2 0h2v2h-2V6zm-4 6h1v2H7v-2zm2 0h3v2H9v-2zm5 0h2v2h-2v-2z',
  'photo-frame':'M3 4h18v16H3V4zm2 2v12h14V6H5zm2 2h10v3h-3l-2 3-2-2-3 3V8z',
  fireplace:    'M3 3h18v3h-2v13H5V6H3V3zm4 5v11h10V8h-2c-.5 3-2 4-3 4s-2.5-1-3-4H7zm3.5 2c.5 2 1 3 1.5 3s1-1 1.5-3c-.6.5-1.1.5-1.5.5s-.9 0-1.5-.5z',
  wrench:       'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4L15 12l-3-3 2.7-2.7z',
  plant:        'M6 21v-4c0-3 2-5 5-5v-2C7 10 4 13 4 17v4h2zm7-16c0 3-2 5-5 5 0-3 2-5 5-5zm7 4c0 3-2 5-5 5 0-3 2-5 5-5zm-8 8v4h2v-4h-2z',
  'plant-pot':  'M8 8h8l-1 3H9L8 8zm-2 4h12l-1 8H7l-1-8zm4-6a2 2 0 1 1 4 0 2 2 0 0 1-4 0z',
  aquarium:     'M3 5h18v14H3V5zm2 2v10h14V7H5zm3 4a3 3 0 0 1 6 0 3 3 0 0 1-6 0zm10 0 3-1v2l-3-1zM5 15c1 0 1 1 3 1s2-1 4-1 2 1 4 1 2-1 3-1v1c-1 0-1 1-3 1s-2-1-4-1-2 1-4 1-2-1-3-1v-1z',

  // Lights: more variety
  pendant:      'M11 2h2v3h-2V2zm-3 4h8l2 5h-4v3h1v3h-2v3h-2v-3H9v-3h1v-3H6l2-5z',
  spotlight:    'M4 4h16v6H4V4zm2 2v2h12V6H6zm2 6h8l-1 10h-6l-1-10zm2 2 .5 6h3l.5-6h-4z',
  'wall-light': 'M4 3h4v18H4V3zm2 2v14h1V5H6zm3 6h6l1 4h-8l1-4zm-1 5h9l-2 3v3H10v-3l-2-3z',
  'floor-lamp': 'M9 2h6l1 8H8l1-8zm2 10h2v8h3v2H8v-2h3v-8z',
  'garden-light':'M10 2h4v4h-4V2zm-1 5h6l1 4H8l1-4zm2 5h2v9h3v2H9v-2h2v-9z',

  // Pets / people
  pet:          'M5 8a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm4-4a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm6 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm4 4a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm-7 5a5 5 0 0 1 4 8h-8a5 5 0 0 1 4-8z',
  dog:          'M4 6h4l2 3h4l2-3h4l-1 5-2 1v5a2 2 0 0 1-2 2h-1v-3h-4v3H9a2 2 0 0 1-2-2v-5l-2-1-1-5zm5 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm6 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2z',
  cat:          'M4 4l3 4h10l3-4v10a5 5 0 0 1-5 5h-6a5 5 0 0 1-5-5V4zm5 7a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm6 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm-4 4h2l-1 2-1-2z',
  paw:          'M6 6a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm4-3a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm4 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm4 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm-6 6a4 4 0 0 1 3 7h-6a4 4 0 0 1 3-7z',
  baby:         'M12 2a3 3 0 0 1 3 3c0 2-1.5 3-3 3s-3-1-3-3a3 3 0 0 1 3-3zm-5 9h10l-1 4h1v6H7v-6h1l-1-4zm4 4v2h2v-2h-2z',
  stroller:     'M4 5h4l2 6h9l-2 6H8l-1-3-3-4V5zm3 12a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm10 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',

  // Household misc
  broom:        'M17 3l4 4-8 8-4-4 8-8zm-9 9 4 4-3 6-6-1 5-9z',
  trash:        'M6 4h4l1-1h2l1 1h4v2H6V4zm1 4h10l-1 12H8L7 8zm3 2v8h1v-8h-1zm3 0v8h1v-8h-1z',
  recycle:      'M12 3l4 5h-3v4h-2V8H8l4-5zm8 8-2 6-4-2 2-3-3-1-1 2-2-6 5 1-1 2 6 1zm-12 8 2-6 4 2-2 3 3 1 1-2 2 6-5-1 1-2-6-1z',
  candle:       'M11 2c0 2-2 2-2 4a3 3 0 1 0 6 0c0-2-2-2-2-4-1 1-1 2-2 0zm-3 9h8v9H8v-9zm2 2v5h4v-5h-4z',
  'gift-box':   'M3 8h8V6a2 2 0 1 1 2 0v2h8v4H3V8zm1 6h16v7H4v-7zm7 0v7h2v-7h-2z',

  // Light variants
  'bulb-edison':'M12 2a6 6 0 0 0-4 10.5V14a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-1.5A6 6 0 0 0 12 2zM11 8a1 1 0 1 1 2 0v4a1 1 0 1 1-2 0V8zM9 16h6v2H9v-2zm1 3h4v2h-4v-2z',
  'bulb-round': 'M12 2a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM9 18h6v2H9v-2zm1 3h4v1h-4v-1z',
  'bulb-flame': 'M12 2c-1 3-3 3-3 6a3 3 0 0 0 6 0c0-3-2-3-3-6zm-3 12h6v3H9v-3zm2 4h2v3h-2v-3z',
  'panel-light':'M3 3h18v10H3V3zm2 2v6h14V5H5zm3 12v3h8v-3H8z',
  'string-light':'M2 4c2 4 4 4 6 0M8 4c2 4 4 4 6 0M14 4c2 4 4 4 6 0M5 7a2 2 0 1 1 2 2v3l-2 3v-8zm6 0a2 2 0 1 1 2 2v3l-2 3v-8zm6 0a2 2 0 1 1 2 2v3l-2 3v-8z',

  // Door variants
  'door-double':  'M3 3h8v18H3V3zm10 0h8v18h-8V3zM5 5v14h4V5H5zm10 0v14h4V5h-4zm-6 8v2h1v-2H9zm6 0v2h1v-2h-1z',
  'door-sliding': 'M3 3h18v18H3V3zm2 2v14h6V5H5zm8 0v14h6V5h-6zM9 12v2h1v-2H9zm4 0v2h1v-2h-1zM3 21h18v1H3v-1z',
  'door-glass':   'M6 2h12v20H6V2zm2 2v16h8V4H8zm1 2h6v10H9V6zm5 8v2h1v-2h-1z',

  // Lock variants
  'lock-smart': 'M12 2a5 5 0 0 0-5 5v3H5v12h14V10h-2V7a5 5 0 0 0-5-5zm-3 8V7a3 3 0 0 1 6 0v3H9zm-1 4h8v2H8v-2zm0 3h8v1H8v-1z',
  padlock:      'M12 2a5 5 0 0 0-5 5v3H5v12h14V10h-2V7a5 5 0 0 0-5-5zm-3 8V7a3 3 0 0 1 6 0v3H9zm3 3a2 2 0 0 1 1 3.7V19h-2v-2.3A2 2 0 0 1 12 13z',
  deadbolt:     'M12 2a5 5 0 0 0-5 5v3H5v12h14V10h-2V7a5 5 0 0 0-5-5zm-3 8V7a3 3 0 0 1 6 0v3H9zm3 3h4v2h-4v-2z',

  // Bed variants
  'bed-single': 'M4 8h8a4 4 0 0 1 4 4v3h2v5h-2v-2H6v2H4V8zm2 2v5h8v-3a2 2 0 0 0-2-2H6zm2 1a2 2 0 1 1 4 0 2 2 0 0 1-4 0z',
  'bed-double': 'M2 8v11h2v-2h16v2h2v-6a4 4 0 0 0-4-4h-6a2 2 0 0 0-2 2h-2a2 2 0 0 0-2-2H4V8H2zm3 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm14 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',
  crib:         'M4 4h1v16H4V4zm15 0h1v16h-1V4zM6 8h12v10H6V8zm2 2v6h1v-6H8zm3 0v6h1v-6h-1zm3 0v6h1v-6h-1zm3 0v6h1v-6h-1z',

  // Vehicle variants
  'car-side':   'M2 15v3h2v1h3v-1h10v1h3v-1h2v-3l-2-5h-4l-3-2H8L5 12H2v3zm5-5h4l1-2H8l-1 2zm5 0h4l1 2h-6l1-2zM5 15a1 1 0 1 1 2 0 1 1 0 0 1-2 0zm12 0a1 1 0 1 1 2 0 1 1 0 0 1-2 0z',
  'car-front':  'M4 8h16v6l-2 2v3h-3v-3H9v3H6v-3l-2-2V8zm2 2v3h12v-3H6zm2 5a1 1 0 1 1 2 0 1 1 0 0 1-2 0zm8 0a1 1 0 1 1 2 0 1 1 0 0 1-2 0zm-3-9h2v2h-2V6z',
  suv:          'M2 14v4h2v1h3v-1h10v1h3v-1h2v-4l-3-6H8L5 12H2v2zm4-2 1-2h4v2H6zm6-2h4l1 2h-5v-2zM5 16a2 2 0 1 1 4 0 2 2 0 0 1-4 0zm10 0a2 2 0 1 1 4 0 2 2 0 0 1-4 0z',
  bicycle:      'M6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm12 0a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM8 8h3l4 6-2 1-3-4-1 4H7l1-7zM15 5h4v2h-3l1 4h-2l-2 5-1-1 3-5-2-3z',
  scooter:      'M4 16a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm14 0a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM14 4h6v2h-4l-2 8h-3l-2-3h-3v-2h4l1 3h1l2-8z',

  // Camera variants
  'camera-dome':   'M12 3a9 5 0 0 0-9 5v3h18V8a9 5 0 0 0-9-5zm-3 4a2 2 0 1 1 4 0 2 2 0 0 1-4 0zM3 12v3h18v-3H3zm2 5v4h4v-4H5zm10 0v4h4v-4h-4z',
  'camera-bullet': 'M3 8h4l1-2h10l1 2h2v8h-2l-1 2H8l-1-2H3V8zm2 2v4h2l1 2h8l1-2h2v-4h-2l-1-2H8L7 10H5zm5 2a2 2 0 1 1 4 0 2 2 0 0 1-4 0z',
  'camera-ptz':    'M3 6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6zm2 0v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H6a1 1 0 0 0-1 1zm3 4a3 3 0 1 1 6 0 3 3 0 0 1-6 0zM7 20h10v2H7v-2z',

  // Sensors
  sensor:  'M4 4h16v16H4V4zm2 2v12h12V6H6zm2 2h8v2H8V8zm0 3h8v2H8v-2zm0 3h5v2H8v-2z',
  radar:   'M12 3a9 9 0 1 0 9 9h-2a7 7 0 1 1-7-7V3zm0 3a6 6 0 1 0 6 6h-2a4 4 0 1 1-4-4V6zm0 3a3 3 0 1 0 3 3h-2a1 1 0 1 1-1-1V9z',

  // Window variants
  'window-round': 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 2a7 7 0 1 1 0 14 7 7 0 0 1 0-14zm-1 1v12h2V6h-2zm-5 5h12v2H6v-2z',
  skylight:       'M3 4h18v3H3V4zm2 5h14v11H5V9zm2 2v7h4v-7H7zm6 0v7h4v-7h-4z',

  // Furniture variants
  armchair: 'M4 8a3 3 0 0 1 3 3v3h10v-3a3 3 0 1 1 3 3v6h-2v-2H6v2H4v-6a3 3 0 0 1 0-6zm3 6h10v-2a3 3 0 0 0-3-3h-4a3 3 0 0 0-3 3v2z',
  stool:    'M6 4h12v3l-3 4-3-4-3 4-3-4V4zm5 8h2v6h4v2H7v-2h4v-6z',
  bench:    'M2 10h20v3H2v-3zm3 3v6h2v-4h10v4h2v-6H5z',

  // Drinkware
  mug:      'M4 6h12v11a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V6zm2 2v9a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V8H6zm10 2h2a3 3 0 0 1 0 6h-1v-2h1a1 1 0 0 0 0-2h-2v-2z',
  glass:    'M6 3h12l-1 17a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 3zm2 2 .5 8h7L16 5H8zm1 10 .5 5h5l.5-5H9z',
  wine:     'M8 3h8l-1 6a3 3 0 0 1-3 3 3 3 0 0 1-3-3l-1-6zm2 2 .7 4h4.6L16 5h-6zm2 8v6H9v2h6v-2h-3v-6z',

  // Plants variants
  flower:  'M12 2a3 3 0 0 0-2.5 4.7A3 3 0 0 0 7 12a3 3 0 0 0 5 2 3 3 0 0 0 5-2 3 3 0 0 0-2.5-5.3A3 3 0 0 0 12 2zm-1 12h2v8h-2v-8z',
  cactus:  'M9 21v-3H6a2 2 0 0 1-2-2v-4a2 2 0 0 1 4 0v3h1v-9a3 3 0 0 1 6 0v6h1v-2a2 2 0 0 1 4 0v3a2 2 0 0 1-2 2h-3v6h-2v-6h-2v3H9z',
  palm:    'M12 3c-4 0-6 2-6 5 2-2 4-2 6-2s4 0 6 2c0-3-2-5-6-5zm-1 5v14h2V8h-2zM3 8c1-1 3-1 6 0-2 0-4 0-6 2v-2zm12 0c3-1 5-1 6 0v2c-2-2-4-2-6-2z',

  // Tools
  screwdriver: 'M14 3l7 4-9 9-3-1-1 3-2-2 3-1-1-3 6-6zm-2 4 2 2 5-3-2-2-5 3z',
  hammer:      'M13 2l7 7-3 3-4-4-1 1 6 6-2 2-6-6-1 1 3 3-2 2-3-3 6-6-4-4 4-2z',
  toolbox:     'M8 3h8v3h4v14H4V6h4V3zm2 2v1h4V5h-4zM6 8v10h12V8H6zm2 2h2v2H8v-2zm4 0h2v2h-2v-2z',

  // Weather variants
  cloud:    'M6 18a4 4 0 0 1 1-8 5 5 0 0 1 9 1 4 4 0 0 1-1 8H6z',
  thunder:  'M6 15a4 4 0 0 1 1-8 5 5 0 0 1 9 1 4 4 0 0 1-1 8H6zm5 3h3l-4 5 1-4H8l3-1z',
  fog:      'M3 8h18v2H3V8zm2 4h14v2H5v-2zm-2 4h18v2H3v-2zm2 4h14v2H5v-2z',
  umbrella: 'M12 3a9 8 0 0 0-9 8h4a5 5 0 0 1 5-5 5 5 0 0 1 5 5h4a9 8 0 0 0-9-8zm-1 8v8a1 1 0 0 0 2 0v-8h-2z',

  // Recreation
  bbq:      'M4 4h16v3l-2 3H6L4 7V4zm2 2v1l1 1h10l1-1V6H6zm-1 6h14l-1 4h-3v4h-2v-4h-2v4H8v-4H6l-1-4z',
  firepit:  'M12 3s-2 3-2 6a2 2 0 1 0 4 0c0-3-2-6-2-6zm-3 9h6l1 3H8l1-3zm-6 4h18l-2 4H5l-2-4z',
  hammock:  'M3 6l3 4 6-1 6 1 3-4M3 6a3 3 0 0 1 5 0M16 6a3 3 0 0 1 5 0M6 10c2 3 4 4 6 4s4-1 6-4',

  // Notifications
  'phone-ring': 'M4 4h6l1 6-3 2a11 11 0 0 0 4 4l2-3 6 1v6a2 2 0 0 1-2 2A16 16 0 0 1 2 6a2 2 0 0 1 2-2zm14-2 3 3-1 1-3-3 1-1zm-1 4 3 3-1 1-3-3 1-1z',
  message:      'M3 4h18v14H8l-4 4V4zm2 2v11l2-2h12V6H5zm2 2h10v1H7V8zm0 3h10v1H7v-1zm0 3h6v1H7v-1z',
  envelope:     'M3 5h18v14H3V5zm2 2v10h14V7H5zm0 0 7 5 7-5v2l-7 5-7-5V7z',
  // Transport
  bus:          'M4 3h16v13a2 2 0 0 1-1 1.73V20h-3v-2H8v2H5v-2.27A2 2 0 0 1 4 16V3zm2 2v6h12V5H6zm1.5 8a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm9 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z',
  train:        'M6 2h12a2 2 0 0 1 2 2v12a3 3 0 0 1-3 3l2 3h-2.2l-2-3H9.2l-2 3H5l2-3a3 3 0 0 1-3-3V4a2 2 0 0 1 2-2zm0 4v5h5V6H6zm7 0v5h5V6h-5zm-4.5 7a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm7 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z',
  plane:        'M21.5 15.5v-2l-8-5v-5a1.5 1.5 0 0 0-3 0v5l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13.5 19v-5.5l8 2z',
  boat:         'M13 2l6 10h-6V2zm-2 3v7H6l5-7zM4 15h16l-2 5H6l-2-5z',
  truck:        'M2 5h12v10H2V5zm14 3h3.5l2.5 4v3h-2.05a2.75 2.75 0 0 0-5.4 0H16V8zM7 15.5a2.75 2.75 0 1 1 0 5.5 2.75 2.75 0 0 1 0-5.5zm10.75 0a2.75 2.75 0 1 1 0 5.5 2.75 2.75 0 0 1 0-5.5z',
  // Holidays / seasonal
  'xmas-tree':  'M12 2l4.5 6H14l4 5.5h-3L18.5 19h-5v3h-3v-3h-5L9 13.5H6L10 8H7.5L12 2z',
  snowflake:    'M12 2v20M4.3 6.5l15.4 11M19.7 6.5 4.3 17.5',
  snowman:      'M12 2.5a3.5 3.5 0 0 1 2.7 5.7 6.5 6.5 0 1 1-5.4 0A3.5 3.5 0 0 1 12 2.5z',
  pumpkin:      'M10 2h4v3h-4V2zm-3 4h10c2.8 0 5 3 5 7.5S19.8 21 17 21c-1 0-1.9-.4-2.7-1-.7.6-1.5 1-2.3 1s-1.6-.4-2.3-1c-.8.6-1.7 1-2.7 1-2.8 0-5-3-5-7.5S4.2 6 7 6z',
  fireworks:    'M12 9.5V5m1.8 5.2 3.2-3.2m-2.5 5H19m-4.2 1.8 3.2 3.2M12 14.5V19m-1.8-5.2-3.2 3.2m2.5-5H5m4.2-1.8L6 7',
  balloon:      'M12 2c3.3 0 6 2.7 6 6.5 0 3.3-2.4 5.9-4.8 6.4l.8 1.6h-4l.8-1.6C8.4 14.4 6 11.8 6 8.5 6 4.7 8.7 2 12 2zm.5 15.5 1 4.5h-3l1-4.5h1z',
  // Fitness / health
  dumbbell:     'M1 10h2V7h3v10H3v-3H1v-4zm22 0h-2V7h-3v10h3v-3h2v-4zM8 10.5h8v3H8v-3z',
  running:      'M14.5 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM9 22H6.5l2-7L6 13l1.5-5L12 6l3 2.5 3.5 1.5-.7 2-3.3-1.3-1.5 3.3 3 2.5-1 5.5h-2l.7-4.3-2.7-2L9 22z',
  pulse:        'M3 12h4l2.5-6 4 12L16 12h5',
  pill:         'M15.5 2.5a6 6 0 0 1 4.2 10.3l-6.9 6.9A6 6 0 1 1 4.3 11.2l6.9-6.9a6 6 0 0 1 4.3-1.8zm-2.9 3.2-3 3 5.7 5.7 3-3a4 4 0 1 0-5.7-5.7z',
  'first-aid':  'M9 3h6a2 2 0 0 1 2 2v1h3a2 2 0 0 1 2 2v12H2V8a2 2 0 0 1 2-2h3V5a2 2 0 0 1 2-2zm0 3h6V5H9v1zm2 4v3H8v2h3v3h2v-3h3v-2h-3v-3h-2z',
  // Food & drink
  burger:       'M4 8a8 4.5 0 0 1 16 0H4zm0 2h16v2.5H4V10zm0 4.5h16V16a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-1.5z',
  cake:         'M11 2h2v4h-2V2zM5 8h14v5H5V8zm-2 7h18v7H3v-7z',
  beer:         'M5 3h11v18H5V3zm2 2v14h7V5H7zm9 3h2.5A2.5 2.5 0 0 1 21 10.5v5a2.5 2.5 0 0 1-2.5 2.5H16V8zm2 2v6h.5a.5.5 0 0 0 .5-.5v-5a.5.5 0 0 0-.5-.5H18zM8 7h2v10H8V7zm3.5 0h2v10h-2V7z',
  cocktail:     'M3 4h18l-8 9v7h4v2H7v-2h4v-7L3 4z',
  'ice-cream':  'M12 2a5 5 0 0 1 5 5v1H7V7a5 5 0 0 1 5-5zM7.5 10h9L12 22 7.5 10z',

  // Security extras
  siren:        'M12 3a6 6 0 0 1 6 6v8H6V9a6 6 0 0 1 6-6zm0 2a4 4 0 0 0-4 4v6h8V9a4 4 0 0 0-4-4zm-1 2h2v4h-2V7zM4 18h16v3H4v-3z',
  key:          'M14 4h6v6h-4l-8 8v3H4v-4l8-8V4h2zm4 2h-2v2h2V6z',
  safe:         'M3 4h18v14H3V4zm2 2v10h14V6H5zm4 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm0 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm7-2h2v6h-2V8zM5 19h4v2H5v-2zm10 0h4v2h-4v-2z',
  fence:        'M5 3 7 6v14H3V6l2-3zm7 0 2 3v14h-4V6l2-3zm7 0 2 3v14h-4V6l2-3zM3 10h18v2H3v-2z',
  intercom:     'M7 2h10v20H7V2zm2 2v16h6V4H9zm1 2h4v5h-4V6zm2 7a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z',
  contact:      'M4 3h7v18H4V3zm2 2v14h3V5H6zm8-2h6v8h-6V3zm2 2v4h2V5h-2zm-2 8h6v8h-6v-8zm2 2v4h2v-4h-2z',
  vibration:    'M8 4h8v16H8V4zm2 2v12h4V6h-4zM2 7l2 2.5L2 12l2 2.5L2 17V7zm20 0v10l-2-2.5 2-2.5-2-2.5L22 7z',
  sound:        'M4 9h4l5-4v14l-5-4H4V9zM16 8c2 1.5 2 6.5 0 8M19 5c3.5 3 3.5 11 0 14',

  // Energy extras
  pylon:        'M11 2h2v2h5v2h-5v1.5l7 12.5h-2.3L12 12l-5.7 8H4L11 7.5V6H6V4h5V2z',
  generator:    'M3 6h18v12H3V6zm2 2v8h14V8H5zm2 2h4v4H7v-4zm7 0h4v1.5h-4V10zm0 2.5h4V14h-4v-1.5zM2 20h20v2H2v-2z',
  'power-strip':'M2 8h20v8H2V8zm2 2v4h11v-4H4zm2 1h2v2H6v-2zm4 0h2v2h-2v-2zm7-1v4h3v-4h-3z',

  // Lighting extras
  'street-lamp':'M8 2h8l2 5H6l2-5zm3 6h2v12h3v2H8v-2h3V8z',
  'ceiling-light':'M3 3h18v2H3V3zm4 3h10v2a5 5 0 0 1-10 0V6z',

  // Outdoor extras
  greenhouse:   'M12 2l9 7v13H3V9l9-7zm0 2.5L5 10v10h2v-7h10v7h2V10l-7-5.5zM9 15h2v5H9v-5zm4 0h2v5h-2v-5z',
  well:         'M12 2l8 5v2h-3v7h-2V9H9v7H7V9H4V7l8-5zm-1 8h2v3h-2v-3zM5 17h14l1 4H4l1-4z',
  fountain:     'M11 2h2v5h-2V2zM7 4l1.4 1.4L7 6.8 5.6 5.4 7 4zm10 0 1.4 1.4L17 6.8l-1.4-1.4L17 4zM9 8h6v2a3 3 0 0 1-6 0V8zm-3 4h12v2H6v-2zm-2 3h16l-2 6H6l-2-6z',
  swing:        'M4 3h16v2h-1v16h-2V5H7v16H5V5H4V3zm5 2h1v8H9V5zm5 0h1v8h-1V5zm-6 8h8v2H8v-2z',
  doghouse:     'M12 2l9 7v12H3V9l9-7zm3 19v-8H9v8h6z',

  // Kitchen / rooms extras
  'range-hood': 'M10 2h4v4h-4V2zM6 7h12l3 7H3l3-7zm-1 9h14v2H5v-2z',
  balcony:      'M6 3h12v4h-2V5H8v2H6V3zM3 8h18v2H3V8zm1 3h2v5H4v-5zm4 0h2v5H8v-5zm4 0h2v5h-2v-5zm4 0h2v5h-2v-5zM3 17h18v3H3v-3z',
  mirror:       'M12 2a7 9 0 0 1 7 9 7 9 0 0 1-6 8.9V21h3v2H8v-2h3v-1.1A7 9 0 0 1 5 11a7 9 0 0 1 7-9zm0 2a5 7 0 0 0-5 7 5 7 0 0 0 10 0 5 7 0 0 0-5-7z',
  home:         'M12 3l9 8h-2v10h-5v-6h-4v6H5V11H3l9-8z',

  // Media extras
  remote:       'M8 2h8v20H8V2zm2 2v16h4V4h-4zm1 1h2v2h-2V5zm-.5 4a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm3 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2z',
  radio:        'M17 3l1 1.7L8 7.4 7.5 5.6 17 3zM3 8h18v13H3V8zm2 2v9h14v-9H5zm2 1h5v2H7v-2zm0 4h5v2H7v-2zm9-4a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm0 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2z',
  microphone:   'M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3zM6 11h2a4 4 0 0 0 8 0h2a6 6 0 0 1-5 5.9V20h3v2H8v-2h3v-3.1A6 6 0 0 1 6 11z',

  // Misc extras
  robot:        'M11 2h2v3h-2V2zM5 7h14v10H5V7zm2 2v6h10V9H7zm1 1h2v2H8v-2zm6 0h2v2h-2v-2zM2 9h2v6H2V9zm18 0h2v6h-2V9zM8 19h8v3H8v-3z',
  'map-pin':    'M12 2a7 7 0 0 1 7 7c0 5-7 13-7 13S5 14 5 9a7 7 0 0 1 7-7zm0 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
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
  'string-light', 'hammock',
  'snowflake', 'fireworks', 'pulse',
  'sound',
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

// Number tile icon. If the user explicitly picked an icon in the tile
// editor we honour that first; otherwise fall back to heuristic dispatch
// (unit → temp / humidity, name/entity id → tank / door / contact) so
// every number tile still gets a glyph next to the label.
function NumberTileIcon({ spec, unit }) {
  if (spec.icon && spec.icon !== 'auto') {
    return (
      <span className="custom-num-icon" aria-hidden>
        <TileIcon iconKey={spec.icon} domain={spec.domain} on={true} />
      </span>
    );
  }
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
