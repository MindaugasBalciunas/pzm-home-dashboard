import { memo, useEffect, useRef, useState } from 'react';
import { startPolling } from '../lib/poll.js';
import { tilePlacementStyle } from '../lib/placement.js';

const POLL_MS = 4000;

// Contact sensors: normalise the raw HA state into a boolean (detected /
// open). HA convention is `on` = triggered / open / motion for the whole
// binary_sensor domain regardless of device_class, so we treat anything
// non-off/closed/clear as truthy. A missing / empty state string (which
// really can happen if HA restarted) reads as null (neutral), not off —
// otherwise a booted-but-not-yet-populated sensor looked "OK" incorrectly.
function contactOpen(state) {
  if (state == null) return null;
  const raw = state.state;
  if (raw == null || raw === '' || raw === 'unknown' || raw === 'unavailable') return null;
  const s = String(raw).toLowerCase();
  if (s === 'off' || s === 'closed' || s === 'clear'
      || s === 'idle' || s === 'not_detected' || s === 'no_motion'
      || s === 'locked' || s === 'safe' || s === 'dry' || s === 'ok') return false;
  // Anything else (on, open, opened, detected, motion, wet, alarm, tampered,
  // problem, unsafe, unlocked, …) counts as triggered / bad.
  return true;
}

// Localise a zone/contact state (on/off) into a status label whose wording
// matches what the sensor actually measures. `kind` is a hint from options;
// anything unknown falls back to a generic active/idle pair.
function zoneStateLabel(kind, isOn) {
  if (isOn == null) return '—';
  const k = String(kind || '').toLowerCase();
  switch (k) {
    case 'contact':
    case 'door':
    case 'window':
    case 'gate':
    case 'garage':
    case 'garage_door':
    case 'opening':
      return isOn ? 'Open' : 'Closed';
    case 'motion':
    case 'occupancy':
    case 'presence':
    case 'pir':
      return isOn ? 'Motion' : 'Quiet';
    case 'fire':
    case 'smoke':
    case 'heat':
      return isOn ? 'Fire!' : 'Clear';
    case 'gas':
    case 'carbon_monoxide':
    case 'co':
      return isOn ? 'Leak!' : 'Clear';
    case 'glass':
    case 'glass_break':
    case 'sound':
    case 'vibration':
      return isOn ? 'Break!' : 'Clear';
    case 'flood':
    case 'moisture':
    case 'water':
      return isOn ? 'Water!' : 'Dry';
    case 'safety':
    case 'tamper':
      return isOn ? 'Alarm!' : 'OK';
    case 'lock':
      // HA convention for a lock binary_sensor: on = unlocked, off = locked.
      return isOn ? 'Unlocked' : 'Locked';
    default:
      return isOn ? 'Active' : 'Idle';
  }
}

function SecurityCard({
  col, row, colSpan, rowSpan, editMode, onStartMove, onStartResize,
  showZones = true, showPir = true,
}) {
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState({});     // gateIndex -> boolean
  // Compare raw payload text so an all-quiet poll (no zone changed) skips
  // the setState — the card stops re-rendering every 4 s.
  const lastPayloadRef = useRef('');

  const loadRef = useRef(null);
  loadRef.current = async () => {
    try {
      const r = await fetch('api/ha/security', { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const text = await r.text();
      setError(null);
      if (text === lastPayloadRef.current) return;
      lastPayloadRef.current = text;
      setSnapshot(JSON.parse(text));
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => startPolling(() => loadRef.current(), POLL_MS), []);

  const triggerGate = async (index) => {
    setPending((p) => ({ ...p, [index]: true }));
    try {
      const r = await fetch(`api/ha/security/gate/${index}`, { method: 'POST' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      // Refresh a little later — most Eldes outputs pulse and don't
      // change any observable state, but a contact sensor might.
      setTimeout(() => loadRef.current(), 1200);
    } catch (e) {
      setError(String(e));
    } finally {
      setTimeout(() => {
        setPending((p) => {
          const next = { ...p }; delete next[index]; return next;
        });
      }, 900);
    }
  };

  const style = tilePlacementStyle(col, row, colSpan, rowSpan);

  const gates = snapshot?.gates ?? [];
  const zones = snapshot?.zones ?? [];
  const configured = snapshot?.configured ?? false;
  const motionZones = zones.filter((z) => String(z.kind || '').toLowerCase() === 'motion');
  const otherZones  = zones.filter((z) => String(z.kind || '').toLowerCase() !== 'motion');
  // Section presence drives the card's internal grid: the CSS container
  // queries only carve out a column/area for sections that actually render,
  // so hiding Zones/PIR (or having no such sensors) frees the space for the
  // rest instead of leaving a blank region.
  const hasZones = showZones && otherZones.length > 0;
  const hasPir   = showPir && motionZones.length > 0;

  return (
    <div
      className={`tile solar-tile security-tile ${editMode ? 'tile-editing' : ''}`}
      style={style}
      {...(editMode
        ? { onPointerDown: (e) => e.button === 0 && onStartMove(e) }
        : {})}
    >
      <div
        className="solar-inner security-inner"
        data-zones={hasZones ? '' : undefined}
        data-pir={hasPir ? '' : undefined}
      >
        {error && <div className="solar-note solar-note-error">{error}</div>}
        {!error && !configured && (
          <div className="solar-note">Home Assistant not configured.</div>
        )}

        <div className="gates-grid">
          {gates.length === 0 && (
            <div className="solar-note">
              No gates configured. Add entities under
              <code> home_assistant.security.gates</code>.
            </div>
          )}
          {gates.map((g, i) => {
            const open = contactOpen(g.contactState);
            const busy = !!pending[i];
            const stateText = open != null
              ? zoneStateLabel(g.contactKind || 'contact', open)
              : (g.state?.state && g.state.state !== 'unknown' && g.state.state !== 'unavailable')
                ? String(g.state.state)
                : '—';
            const stateAccent = open === true ? 'bad' : open === false ? 'ok' : 'neutral';
            return (
              <button
                key={g.entity || i}
                type="button"
                className={`gate-btn gate-btn-${stateAccent} ${busy ? 'gate-btn-busy' : ''}`}
                disabled={busy || !g.entity}
                onClick={() => triggerGate(i)}
                title={g.entity || ''}
              >
                <div className="gate-icon" aria-hidden>
                  <GateIcon icon={g.icon} />
                </div>
                <div className="gate-body">
                  <div className="gate-name">{g.name || `Gate ${i + 1}`}</div>
                  <div className={`gate-state gate-state-${stateAccent}`}>
                    {busy ? 'Triggering…' : stateText}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {hasZones && <ZoneSection title="Zones" zones={otherZones} variant="zones" />}
        {hasPir && <ZoneSection title="PIR" zones={motionZones} variant="pir" />}
      </div>

      {editMode && (
        <>
          <div className="tile-edit-top">
            <div className="tile-edit-name">Security · tap to configure</div>
            <div className="tile-edit-size">{colSpan}×{rowSpan}</div>
          </div>
          <div
            className="tile-resize"
            onPointerDown={(e) => e.button === 0 && onStartResize(e)}
          />
        </>
      )}
    </div>
  );
}

export default memo(SecurityCard);

function ZoneSection({ title, zones, variant }) {
  return (
    <div className={`security-zones security-zones--${variant || 'zones'}`}>
      <div className="solar-section-title">{title}</div>
      <div className="zones-grid">
        {zones.map((z) => (
          <ZoneChip key={z.entity} zone={z} />
        ))}
      </div>
    </div>
  );
}

// Individual zone cell. Mirrors the gate buttons' anatomy (tinted icon
// box, name over a small state line, coloured left edge) so the whole
// panel reads as one system — but it's an indicator, not a button.
// Degrades via CSS container queries when the cell gets too narrow:
// the state line goes first (colour still carries it), then the text
// entirely. Container queries are stable: no measurement loop, no React
// re-render flicker as the layout settles.
function ZoneChip({ zone }) {
  const open = contactOpen(zone.state);
  const cls = open === true ? 'bad' : open === false ? 'ok' : 'neutral';
  const kindKey = String(zone.kind || '').toLowerCase();
  const label = zone.name || zone.entity;
  const stateText = zoneStateLabel(zone.kind, open);

  return (
    <div
      className={`zone-chip zone-chip-${cls}`}
      title={`${label}\n${zone.entity}\n${stateText}`}
    >
      <span className="zone-icon" aria-hidden>
        <ZoneKindIcon kind={kindKey} name={label} open={open} />
      </span>
      <span className="zone-body">
        <span className="zone-name">{label}</span>
        <span className={`zone-state zone-state-${cls}`}>{stateText}</span>
      </span>
    </div>
  );
}

// Compact inline glyphs keyed to the sensor's kind. Kept in this file
// alongside the security-specific chip styles so they stay in sync with
// the SecurityCard's palette without hopping into SimpleTile's catalog.
// For motion/PIR sensors we look at the zone name to pick a room-flavoured
// glyph (bed, sofa, kitchen…) instead of a single generic "motion" icon.
function ZoneKindIcon({ kind, name, open }) {
  const k = String(kind || '').toLowerCase();
  if (k === 'motion' || k === 'occupancy' || k === 'presence' || k === 'pir') {
    return <PirRoomIcon name={name} />;
  }
  if (k === 'door') {
    return (
      <svg viewBox="0 0 24 24" width="100%" height="100%">
        <path fill="currentColor" d={open
          ? "M4 21V4h6l8-2v20l-8-2H4zm2-2h4V6H6v13zm6-13v12l4 1V3l-4 1zm-3 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2z"
          : "M6 2h12v20H6V2zm2 2v16h8V4H8zm5 8v2h1v-2h-1z"} />
      </svg>
    );
  }
  if (k === 'window') {
    return (
      <svg viewBox="0 0 24 24" width="100%" height="100%">
        <path fill="currentColor" d="M4 3h16v18H4V3zm2 2v7h5V5H6zm7 0v7h5V5h-5zM6 14v5h5v-5H6zm7 0v5h5v-5h-5z" />
      </svg>
    );
  }
  if (k === 'fire' || k === 'smoke' || k === 'heat') {
    return (
      <svg viewBox="0 0 24 24" width="100%" height="100%">
        <path fill="currentColor" d="M13 3s3 4 3 8a4 4 0 1 1-8 0c0-2 1-3 1-3s-2 5 2 7c0 0-3-2-1-6 1-2 3-6 3-6z" />
      </svg>
    );
  }
  if (k === 'gas' || k === 'carbon_monoxide' || k === 'co') {
    return (
      <svg viewBox="0 0 24 24" width="100%" height="100%">
        <path fill="currentColor" d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 2a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM9 9a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm6 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4z" />
      </svg>
    );
  }
  if (k === 'glass' || k === 'glass_break' || k === 'sound' || k === 'vibration') {
    return (
      <svg viewBox="0 0 24 24" width="100%" height="100%">
        <path fill="currentColor" d="M4 3h16v18H4V3zm2 2v14h5l4-14H6zm7 0-4 14h9V5h-5z" />
      </svg>
    );
  }
  if (k === 'flood' || k === 'moisture' || k === 'water') {
    return (
      <svg viewBox="0 0 24 24" width="100%" height="100%">
        <path fill="currentColor" d="M12 2.5s-6.5 7.5-6.5 12.5a6.5 6.5 0 1 0 13 0C18.5 10 12 2.5 12 2.5z" />
      </svg>
    );
  }
  if (k === 'lock') {
    return (
      <svg viewBox="0 0 24 24" width="100%" height="100%">
        <path fill="currentColor" d="M12 2a5 5 0 0 0-5 5v3H5v12h14V10h-2V7a5 5 0 0 0-5-5zm-3 8V7a3 3 0 0 1 6 0v3H9z" />
      </svg>
    );
  }
  // Contact / opening / generic — a small round marker so the chip still
  // has a visual anchor when other kinds don't match.
  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%">
      <circle cx="12" cy="12" r="5" fill="currentColor" />
    </svg>
  );
}

// Dispatch a PIR / motion / presence zone to a room-flavoured glyph based
// on the zone name. Falls through to the generic "walking figure" motion
// icon when no room keyword matches, so every PIR still gets *something*.
function PirRoomIcon({ name }) {
  const n = String(name || '').toLowerCase();
  const has = (needles) => needles.some((s) => n.includes(s));

  if (has(['entrance', 'entry', 'hall', 'iejim', 'hallway', 'foyer', 'lobby'])) {
    return (
      <svg viewBox="0 0 24 24" width="100%" height="100%">
        <path fill="currentColor" d="M6 2h12v20H6V2zm2 2v16h8V4H8zm5 8v2h1v-2h-1z" />
      </svg>
    );
  }
  if (has(['living', 'lounge', 'sale', 'sofa', 'sitting'])) {
    return (
      <svg viewBox="0 0 24 24" width="100%" height="100%">
        <path fill="currentColor" d="M3 11a2 2 0 0 1 4 0v3h10v-3a2 2 0 1 1 4 0v6h-2v2h-2v-2H7v2H5v-2H3v-6zm4 3v-2a4 4 0 0 1 4-4h2a4 4 0 0 1 4 4v2H7z" />
      </svg>
    );
  }
  if (has(['kitchen', 'virtuv', 'cook', 'pantry'])) {
    return (
      <svg viewBox="0 0 24 24" width="100%" height="100%">
        <path fill="currentColor" d="M4 4h16v16H4V4zm2 2v12h12V6H6zm2 2h3v3H8V8zm5 0h3v3h-3V8zm-5 5h3v3H8v-3zm5 0h3v3h-3v-3z" />
      </svg>
    );
  }
  if (has(['office', 'darbo', 'study', 'work', 'desk'])) {
    return (
      <svg viewBox="0 0 24 24" width="100%" height="100%">
        <path fill="currentColor" d="M3 4h18v12H3V4zm2 2v8h14V6H5zm-1 12h16v2H4v-2z" />
      </svg>
    );
  }
  if (has(['bedroom', 'bed', 'miegam', 'kids', 'nursery'])) {
    return (
      <svg viewBox="0 0 24 24" width="100%" height="100%">
        <path fill="currentColor" d="M3 8h11a4 4 0 0 1 4 4v3h3v5h-2v-2H5v2H3V8zm2 2v5h11v-3a2 2 0 0 0-2-2H5zm2 1a2 2 0 1 1 4 0 2 2 0 0 1-4 0z" />
      </svg>
    );
  }
  if (has(['bath', 'shower', 'wc', 'toilet', 'vonia'])) {
    return (
      <svg viewBox="0 0 24 24" width="100%" height="100%">
        <path fill="currentColor" d="M6 4a3 3 0 0 1 6 0v6H4v3a5 5 0 0 0 4 4.9V21h2v-3.1a5 5 0 0 0 4-4.9v-3H8a1 1 0 0 1 0-2h2V7H8a3 3 0 0 1-2-3zm14 0h2v9h-2V4z" />
      </svg>
    );
  }
  if (has(['garage', 'garaz', 'workshop', 'shed'])) {
    return (
      <svg viewBox="0 0 24 24" width="100%" height="100%">
        <path fill="currentColor" d="M3 21V9l9-6 9 6v12h-4v-6H7v6H3zm6-2h2v-2H9v2zm4 0h2v-2h-2v2zM9 15h2v-2H9v2zm4 0h2v-2h-2v2z" />
      </svg>
    );
  }
  if (has(['upstairs', '2nd', 'second floor', '2 a', 'stairs', 'stair', 'floor'])) {
    return (
      <svg viewBox="0 0 24 24" width="100%" height="100%">
        <path fill="currentColor" d="M3 21V3h18v4h-4v4h-4v4H9v4H3zm2-2h4v-4h4v-4h4V9h4V5H5v14z" />
      </svg>
    );
  }
  if (has(['dining', 'valgom'])) {
    return (
      <svg viewBox="0 0 24 24" width="100%" height="100%">
        <path fill="currentColor" d="M3 10h18v3H3v-3zm2 5h14v6H5v-6zm2 2v2h10v-2H7zM8 3h1v6H8V3zm3 0h1v6h-1V3zm3 0h1v6h-1V3zm3 0h1v6h-1V3z" />
      </svg>
    );
  }
  if (has(['garden', 'yard', 'sod', 'lauk', 'outdoor', 'terrace', 'patio', 'teras'])) {
    return (
      <svg viewBox="0 0 24 24" width="100%" height="100%">
        <path fill="currentColor" d="M12 2a6 6 0 0 0-6 6c0 3 2 5 4 6v2H6v2h5v4h2v-4h5v-2h-4v-2c2-1 4-3 4-6a6 6 0 0 0-6-6z" />
      </svg>
    );
  }
  // Fallback — the classic "person + movement lines" glyph so the chip
  // still reads as motion even when the room can't be inferred.
  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%">
      <path fill="currentColor" d="M13 2a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM5 22l3-9 3 2 3-4 5 5-1 1-4-3-3 4-3-2-1 6H5z" />
    </svg>
  );
}

// Tiny inline SVG icons keyed to the mdi:* hint from options. Falls back to
// a generic gate silhouette. We keep them inline so no external font is needed.
function GateIcon({ icon }) {
  const kind = String(icon || '').replace(/^mdi:/, '');
  if (kind === 'garage' || kind === 'garage-open') {
    return (
      <svg viewBox="0 0 24 24" width="100%" height="100%">
        <path fill="currentColor" d="M3 21V9l9-6 9 6v12h-4v-6H7v6H3zm6-2h2v-2H9v2zm4 0h2v-2h-2v2zM9 15h2v-2H9v2zm4 0h2v-2h-2v2z" />
      </svg>
    );
  }
  if (kind === 'gate' || kind === 'fence-electric' || kind === 'fence') {
    return (
      <svg viewBox="0 0 24 24" width="100%" height="100%">
        <path fill="currentColor" d="M3 20V6h2v3h4V6h2v3h2V6h2v3h4V6h2v14H3zm2-2h4v-7H5v7zm6 0h2v-7h-2v7zm4 0h4v-7h-4v7z" />
      </svg>
    );
  }
  if (kind === 'door' || kind === 'door-closed' || kind === 'door-open' || kind === 'fence-door') {
    // A pedestrian gate through a fence: two flanking fence posts with a
    // distinct door panel and handle between them.
    return (
      <svg viewBox="0 0 24 24" width="100%" height="100%">
        <path fill="currentColor" d="M3 4v16h2V4H3zm16 0v16h2V4h-2zM7 4v16h10V4H7zm2 2h6v12H9V6zm5 5v2h1v-2h-1z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%">
      <path fill="currentColor" d="M4 22V4h16v18h-2v-6h-4v6H4zm2-8h4V6H6v8zm8 0h4V6h-4v8z" />
    </svg>
  );
}
