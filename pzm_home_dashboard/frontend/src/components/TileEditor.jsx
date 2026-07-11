import { useEffect, useRef, useState } from 'react';
import IconPicker from './IconPicker.jsx';

// Icon motion effects. Buttons animate only while the entity is ON;
// number tiles animate continuously (their icon is a passive glyph).
const ICON_FX = [
  { key: 'none',   label: 'Static' },
  { key: 'spin',   label: 'Spin' },
  { key: 'pulse',  label: 'Pulse' },
  { key: 'glow',   label: 'Glow' },
  { key: 'bounce', label: 'Bounce' },
];

// Preset tile backgrounds — subtle tints that sit well on both themes.
// null = default panel background.
const TILE_BG_PRESETS = [
  { key: null,                          label: 'Default' },
  // Same translucent glass as the Electricity callout cards, so tiles
  // overlaid on the house photo read as part of the same family.
  { key: 'glass',                       label: 'Glass' },
  // 22% tints: strong enough to clearly read as the chosen colour on the
  // dark theme (the old 10% ones were near-invisible), translucent enough
  // that on/off state tinting still shows through.
  { key: 'rgba(74, 163, 255, 0.22)',    label: 'Blue' },
  { key: 'rgba(87, 211, 140, 0.22)',    label: 'Green' },
  { key: 'rgba(255, 193, 7, 0.22)',     label: 'Amber' },
  { key: 'rgba(255, 107, 107, 0.22)',   label: 'Red' },
  { key: 'rgba(186, 104, 200, 0.24)',   label: 'Purple' },
  { key: 'rgba(0, 188, 212, 0.22)',     label: 'Teal' },
  { key: '#000000',                     label: 'Black' },
];

// Preset border colours. null = default (theme border + on/off state
// tinting); 'transparent' = borderless, for tiles laid over cards/video.
const TILE_BORDER_PRESETS = [
  { key: null,                        label: 'Default' },
  { key: 'transparent',               label: 'None' },
  { key: 'rgba(255, 255, 255, 0.35)', label: 'White' },
  { key: '#4aa3ff',                   label: 'Blue' },
  { key: '#57d38c',                   label: 'Green' },
  { key: '#f5a623',                   label: 'Amber' },
  { key: '#ff6b6b',                   label: 'Red' },
];

const DISPLAY_MODES = [
  { key: 'value', label: 'Value',       hint: 'Big number only' },
  { key: 'graph', label: 'Today graph', hint: 'Sparkline of today’s history' },
  { key: 'bar',   label: 'Progress bar', hint: 'Fill between min and max' },
];

// Decimal places for the big number. null = automatic (magnitude-based).
const DECIMAL_CHOICES = [
  { key: null, label: 'Auto' },
  { key: 0,    label: '0' },
  { key: 1,    label: '1' },
  { key: 2,    label: '2' },
  { key: 3,    label: '3' },
];

// Modal shown after a long-press on a custom / template tile. Buttons get
// name + icon + effect; numbers add display mode, range and thresholds.
// Delete removes the tile outright.
export default function TileEditor({ id, entry, onSave, onDelete, onCancel }) {
  const spec = entry?.spec || {};
  const [name, setName] = useState(spec.name || '');
  const [icon, setIcon] = useState(spec.icon || 'auto');
  const [iconFx, setIconFx] = useState(spec.iconFx || 'none');
  const [bg, setBg] = useState(spec.bg || null);
  const [borderColor, setBorderColor] = useState(spec.borderColor || null);
  const [opacity, setOpacity] = useState(
    Number.isFinite(Number(spec.opacity)) && spec.opacity != null ? Number(spec.opacity) : 1
  );
  const [display, setDisplay] = useState(spec.display || 'value');
  const [decimals, setDecimals] = useState(Number.isFinite(Number(spec.decimals)) && spec.decimals != null ? Number(spec.decimals) : null);
  const [unit, setUnit] = useState(spec.unit ?? '');
  const [min, setMin] = useState(spec.min ?? '');
  const [max, setMax] = useState(spec.max ?? '');
  const [warnAbove, setWarnAbove] = useState(spec.warnAbove ?? '');
  const [alertAbove, setAlertAbove] = useState(spec.alertAbove ?? '');
  // Guard against a synthetic click from the long-press touchend landing on
  // the scrim and instantly closing us. Ignore clicks in the first ~350 ms.
  const openedAtRef = useRef(Date.now());

  useEffect(() => {
    setName(spec.name || '');
    setIcon(spec.icon || 'auto');
    setIconFx(spec.iconFx || 'none');
    setBg(spec.bg || null);
    setBorderColor(spec.borderColor || null);
    setOpacity(Number.isFinite(Number(spec.opacity)) && spec.opacity != null ? Number(spec.opacity) : 1);
    setDisplay(spec.display || 'value');
    setDecimals(Number.isFinite(Number(spec.decimals)) && spec.decimals != null ? Number(spec.decimals) : null);
    setUnit(spec.unit ?? '');
    setMin(spec.min ?? '');
    setMax(spec.max ?? '');
    setWarnAbove(spec.warnAbove ?? '');
    setAlertAbove(spec.alertAbove ?? '');
    openedAtRef.current = Date.now();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleScrimClick = () => {
    if (Date.now() - openedAtRef.current < 350) return;
    onCancel();
  };

  const isNumber = spec.kind === 'number';
  const canSave = name.trim().length > 0;

  // Numeric spec fields persist as numbers; blank inputs remove the key so
  // saved layouts stay minimal.
  const numOrOmit = (v) => {
    if (v === '' || v == null) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  const save = () => {
    if (!canSave) return;
    const nextSpec = { ...spec, name: name.trim(), icon };
    const assign = (key, value) => {
      if (value === undefined || value === null || value === 'none') delete nextSpec[key];
      else nextSpec[key] = value;
    };
    assign('iconFx', iconFx);
    assign('bg', bg);
    assign('borderColor', borderColor);
    // Full opacity is the default — keep saved layouts minimal.
    assign('opacity', opacity >= 0.995 ? undefined : Math.round(opacity * 100) / 100);
    if (isNumber) {
      assign('display', display === 'value' ? undefined : display);
      assign('decimals', decimals);
      // Blank = automatic (live HA unit); text = override; whitespace-only
      // = deliberate "no unit" (persists as a single space).
      assign('unit', unit === '' ? undefined : (unit.trim() === '' ? ' ' : unit.trim()));
      assign('min', numOrOmit(min));
      assign('max', numOrOmit(max));
      assign('warnAbove', numOrOmit(warnAbove));
      assign('alertAbove', numOrOmit(alertAbove));
    }
    onSave(id, nextSpec);
  };

  // Two-column grid dialog: related fields sit side by side so the whole
  // form is visible without scrolling on a tablet/desktop; .form-span rows
  // (notes, swatches, icon picker) take the full width. Collapses to one
  // column on narrow screens via .picker-form-grid's media query.
  return (
    <div className="picker-scrim" onClick={handleScrimClick}>
      <div className="picker picker-wide picker-scrolls" onClick={(e) => e.stopPropagation()}>
        <div className="picker-header">
          <span className="picker-title">
            Edit {spec.kind === 'button' ? 'button' : 'number'} tile
          </span>
          <button
            type="button"
            className="side-menu-close"
            onClick={onCancel}
            aria-label="Close"
          >×</button>
        </div>

        <div className="picker-form picker-form-grid">
          <div className="form-field">
            <label htmlFor="tileedit-name">Display name</label>
            <input
              id="tileedit-name"
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="form-field">
            <label>Entity</label>
            <div className="picker-preview-id" style={{ padding: '0.5rem 0', maxWidth: '100%' }}>
              {spec.entityId || '—'}
            </div>
          </div>

          {isNumber && (
            <>
              <div className="form-field">
                <label>Display as</label>
                <div className="chip-row">
                  {DISPLAY_MODES.map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      className={`opt-chip ${display === m.key ? 'is-active' : ''}`}
                      title={m.hint}
                      onClick={() => setDisplay(m.key)}
                    >{m.label}</button>
                  ))}
                </div>
              </div>

              <div className="form-field">
                <label>Decimal places</label>
                <div className="chip-row">
                  {DECIMAL_CHOICES.map((d) => (
                    <button
                      key={d.label}
                      type="button"
                      className={`opt-chip ${decimals === d.key ? 'is-active' : ''}`}
                      onClick={() => setDecimals(d.key)}
                    >{d.label}</button>
                  ))}
                </div>
              </div>

              <div className="form-field">
                <label htmlFor="tileedit-unit">Unit</label>
                <input
                  id="tileedit-unit"
                  type="text"
                  placeholder="auto — from Home Assistant"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                />
                <div className="side-menu-note">
                  Blank = sensor’s own unit; type to override, space to hide.
                </div>
              </div>

              {display === 'bar' && (
                <div className="form-field">
                  <div className="field-pair">
                    <div>
                      <label htmlFor="tileedit-min">Min</label>
                      <input
                        id="tileedit-min"
                        type="number"
                        placeholder="0"
                        value={min}
                        onChange={(e) => setMin(e.target.value)}
                      />
                    </div>
                    <div>
                      <label htmlFor="tileedit-max">Max</label>
                      <input
                        id="tileedit-max"
                        type="number"
                        placeholder="100"
                        value={max}
                        onChange={(e) => setMax(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="form-field">
                <div className="field-pair">
                  <div>
                    <label htmlFor="tileedit-warn">Warn above</label>
                    <input
                      id="tileedit-warn"
                      type="number"
                      placeholder="—"
                      value={warnAbove}
                      onChange={(e) => setWarnAbove(e.target.value)}
                    />
                  </div>
                  <div>
                    <label htmlFor="tileedit-alert">Alert above</label>
                    <input
                      id="tileedit-alert"
                      type="number"
                      placeholder="—"
                      value={alertAbove}
                      onChange={(e) => setAlertAbove(e.target.value)}
                    />
                  </div>
                </div>
                <div className="side-menu-note">
                  Above these values the number, bar and graph turn amber / red.
                </div>
              </div>
            </>
          )}

          <div className="form-field form-span">
            <label>Icon effect</label>
            <div className="chip-row">
              {ICON_FX.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className={`opt-chip ${iconFx === f.key ? 'is-active' : ''}`}
                  onClick={() => setIconFx(f.key)}
                >{f.label}</button>
              ))}
            </div>
            {spec.kind === 'button' && iconFx !== 'none' && (
              <div className="side-menu-note">Buttons animate while the entity is on.</div>
            )}
          </div>

          <div className="form-field">
            <label>Tile background</label>
            <div className="swatch-row">
              {TILE_BG_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  className={`bg-swatch ${bg === p.key ? 'is-active' : ''} ${p.key == null ? 'bg-swatch-none' : ''} ${p.key === 'glass' ? 'bg-swatch-glass' : ''}`}
                  style={p.key && p.key !== 'glass' ? { background: p.key } : undefined}
                  title={p.label}
                  aria-label={`Background: ${p.label}`}
                  onClick={() => setBg(p.key)}
                />
              ))}
              <input
                type="color"
                className="bg-swatch bg-swatch-custom"
                title="Custom colour"
                aria-label="Custom background colour"
                value={typeof bg === 'string' && bg.startsWith('#') ? bg : '#1a2230'}
                onChange={(e) => setBg(e.target.value)}
              />
            </div>
          </div>

          <div className="form-field">
            <label>Border colour</label>
            <div className="swatch-row">
              {TILE_BORDER_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  className={`bg-swatch ${borderColor === p.key ? 'is-active' : ''} ${p.key == null ? 'bg-swatch-none' : ''} ${p.key === 'transparent' ? 'bg-swatch-transparent' : ''}`}
                  style={p.key && p.key !== 'transparent' ? { background: p.key } : undefined}
                  title={p.label}
                  aria-label={`Border: ${p.label}`}
                  onClick={() => setBorderColor(p.key)}
                />
              ))}
              <input
                type="color"
                className="bg-swatch bg-swatch-custom"
                title="Custom border colour"
                aria-label="Custom border colour"
                value={typeof borderColor === 'string' && borderColor.startsWith('#') ? borderColor : '#4aa3ff'}
                onChange={(e) => setBorderColor(e.target.value)}
              />
            </div>
          </div>

          <div className="form-field form-span">
            <label htmlFor="tileedit-opacity">
              Background opacity <span className="field-value">{Math.round(opacity * 100)}%</span>
            </label>
            <input
              id="tileedit-opacity"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
            />
            <div className="side-menu-note">
              Fades only the tile’s background — the label, value and icon
              stay solid. Great laid over the Electricity card or a camera
              (drag with “Snap to grid” off).
            </div>
          </div>

          <div className="form-field form-span">
            <label>Icon</label>
            <IconPicker
              value={icon}
              onChange={setIcon}
              domain={spec.domain}
            />
          </div>
        </div>

        <div className="picker-actions" style={{ justifyContent: 'space-between' }}>
          <button
            type="button"
            className="side-menu-btn-ghost is-danger"
            onClick={() => {
              if (window.confirm('Delete this tile?')) onDelete(id);
            }}
          >Delete</button>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              className="side-menu-btn-ghost"
              onClick={onCancel}
            >Cancel</button>
            <button
              type="button"
              className="side-menu-btn-primary"
              disabled={!canSave}
              onClick={save}
            >Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}
