import { useEffect, useRef, useState } from 'react';

// Curated palette for quick colour picks. The user can also tune a
// brightness slider — hue is picked from these swatches so we avoid
// building a full HSV wheel that would be fiddly on touch.
const COLOR_SWATCHES = [
  { name: 'Warm white',  rgb: [255, 214, 170] },
  { name: 'Cool white',  rgb: [200, 220, 255] },
  { name: 'Red',         rgb: [255,  30,  30] },
  { name: 'Orange',      rgb: [255, 140,  20] },
  { name: 'Yellow',      rgb: [255, 235,  59] },
  { name: 'Lime',        rgb: [150, 255,  90] },
  { name: 'Green',       rgb: [ 40, 200, 100] },
  { name: 'Teal',        rgb: [  0, 200, 200] },
  { name: 'Sky',         rgb: [ 74, 163, 255] },
  { name: 'Blue',        rgb: [ 40,  80, 255] },
  { name: 'Purple',      rgb: [160,  70, 255] },
  { name: 'Magenta',     rgb: [255,  60, 200] },
  { name: 'Pink',        rgb: [255, 130, 180] },
  { name: 'Peach',       rgb: [255, 180, 120] },
];

// Modal that surfaces brightness + colour controls for a light entity.
// Sends throttled `light.turn_on` calls so the bulb reflects the user's
// current slider position without spamming HA.
export default function LightControl({ entityId, name, initial, onClose, onChanged }) {
  const [brightness, setBrightness] = useState(() => {
    const b = initial?.light?.brightness;
    return Number.isFinite(b) ? Math.round((b / 255) * 100) : 100;
  });
  const [rgb, setRgb] = useState(() => initial?.light?.rgb || null);
  const [busy, setBusy] = useState(false);

  const supportsBrightness = !!initial?.light?.supportsBrightness;
  const supportsColor = !!initial?.light?.supportsColor;

  const sendTimer = useRef(null);
  const pendingRef = useRef({});

  const flushSend = async () => {
    const data = pendingRef.current;
    pendingRef.current = {};
    if (!Object.keys(data).length) return;
    setBusy(true);
    try {
      await fetch('api/ha/entity/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityId,
          domain: 'light',
          service: 'turn_on',
          data,
        }),
      });
      onChanged?.();
    } catch { /* transient */ }
    finally {
      setTimeout(() => setBusy(false), 250);
    }
  };

  const schedule = (patch, delay = 150) => {
    pendingRef.current = { ...pendingRef.current, ...patch };
    if (sendTimer.current) clearTimeout(sendTimer.current);
    sendTimer.current = setTimeout(flushSend, delay);
  };

  useEffect(() => () => {
    if (sendTimer.current) clearTimeout(sendTimer.current);
  }, []);

  const applyBrightness = (pct) => {
    setBrightness(pct);
    schedule({ brightness: Math.round((pct / 100) * 255) }, 180);
  };

  const applyColor = (swatch) => {
    setRgb(swatch);
    schedule({ rgb_color: swatch }, 0);
  };

  const turnOff = () => {
    if (sendTimer.current) clearTimeout(sendTimer.current);
    pendingRef.current = {};
    fetch('api/ha/entity/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entityId,
        domain: 'light',
        service: 'turn_off',
        data: {},
      }),
    }).then(() => onChanged?.()).finally(() => onClose());
  };

  const currentHex = rgbToHex(rgb);
  const previewStyle = rgb ? { background: `rgb(${rgb.join(',')})`, opacity: Math.max(0.15, brightness / 100) } : {};

  return (
    <div className="picker-scrim" onClick={onClose}>
      <div className="picker light-control" onClick={(e) => e.stopPropagation()}>
        <div className="picker-header">
          <span className="picker-title">{name || entityId}</span>
          <button
            type="button"
            className="side-menu-close"
            onClick={onClose}
            aria-label="Close"
          >×</button>
        </div>

        <div className="light-preview">
          <div className="light-preview-swatch" style={previewStyle} />
          <div className="light-preview-info">
            <div className="light-preview-hex">{currentHex || '—'}</div>
            {supportsBrightness && (
              <div className="light-preview-brightness">{brightness}%</div>
            )}
          </div>
        </div>

        {supportsBrightness && (
          <div className="light-section">
            <label htmlFor="brightness-slider">Brightness</label>
            <input
              id="brightness-slider"
              type="range"
              min="1"
              max="100"
              step="1"
              value={brightness}
              onChange={(e) => applyBrightness(Number(e.target.value))}
              className="light-slider"
            />
          </div>
        )}

        {supportsColor && (
          <div className="light-section">
            <label>Color</label>
            <div className="color-swatches">
              {COLOR_SWATCHES.map((s) => {
                const active = rgb && rgb[0] === s.rgb[0] && rgb[1] === s.rgb[1] && rgb[2] === s.rgb[2];
                return (
                  <button
                    key={s.name}
                    type="button"
                    className={`color-swatch ${active ? 'is-active' : ''}`}
                    style={{ background: `rgb(${s.rgb.join(',')})` }}
                    onClick={() => applyColor(s.rgb)}
                    title={s.name}
                    aria-label={s.name}
                  />
                );
              })}
            </div>
          </div>
        )}

        {!supportsBrightness && !supportsColor && (
          <div className="picker-form">
            <div className="side-menu-note">
              This light exposes no dimming or colour attributes — use the
              tile tap to toggle it.
            </div>
          </div>
        )}

        <div className="picker-actions" style={{ justifyContent: 'space-between' }}>
          <button
            type="button"
            className="side-menu-btn-ghost is-danger"
            onClick={turnOff}
            disabled={busy}
          >Turn off</button>
          <button
            type="button"
            className="side-menu-btn-primary"
            onClick={onClose}
          >Done</button>
        </div>
      </div>
    </div>
  );
}

function rgbToHex(rgb) {
  if (!rgb) return null;
  return '#' + rgb.map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase();
}
