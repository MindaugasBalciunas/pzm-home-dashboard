import { useCallback, useEffect, useRef, useState } from 'react';

const POLL_MS = 4000;

// Contact sensors: normalise 'on'/'off' (HA convention: on = detected/open).
function contactOpen(state) {
  if (!state || !state.state) return null;
  const s = String(state.state).toLowerCase();
  if (s === 'on' || s === 'open' || s === 'opened') return true;
  if (s === 'off' || s === 'closed' || s === 'clear') return false;
  return null;
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

export default function SecurityCard({
  col, row, colSpan, rowSpan, editMode, onStartMove, onStartResize,
}) {
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState({});     // gateIndex -> boolean
  const abortRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('api/ha/security', { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setSnapshot(data);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const triggerGate = async (index) => {
    setPending((p) => ({ ...p, [index]: true }));
    try {
      const r = await fetch(`api/ha/security/gate/${index}`, { method: 'POST' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      // Refresh a little later — most Eldes outputs pulse and don't
      // change any observable state, but a contact sensor might.
      setTimeout(load, 1200);
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

  const style = {
    gridColumn: `${col} / span ${colSpan}`,
    gridRow: `${row} / span ${rowSpan}`,
  };

  const gates = snapshot?.gates ?? [];
  const zones = snapshot?.zones ?? [];
  const configured = snapshot?.configured ?? false;
  const motionZones = zones.filter((z) => String(z.kind || '').toLowerCase() === 'motion');
  const otherZones  = zones.filter((z) => String(z.kind || '').toLowerCase() !== 'motion');

  return (
    <div
      className={`tile solar-tile security-tile ${editMode ? 'tile-editing' : ''}`}
      style={style}
      {...(editMode
        ? { onPointerDown: (e) => e.button === 0 && onStartMove(e) }
        : {})}
    >
      <div className="solar-inner security-inner">
        <div className="solar-title">Home Security</div>

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

        {otherZones.length > 0 && (
          <ZoneSection title="Zones" zones={otherZones} variant="zones" />
        )}
        {motionZones.length > 0 && (
          <ZoneSection title="PIR" zones={motionZones} variant="pir" />
        )}
      </div>

      {editMode && (
        <>
          <div className="tile-edit-top">
            <div className="tile-edit-name">Security</div>
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

function ZoneSection({ title, zones, variant }) {
  return (
    <div className={`security-zones security-zones--${variant || 'zones'}`}>
      <div className="solar-section-title">{title}</div>
      <div className="zones-grid">
        {zones.map((z) => {
          const open = contactOpen(z.state);
          const cls = open === true ? 'bad' : open === false ? 'ok' : 'neutral';
          return (
            <div
              key={z.entity}
              className={`zone-chip zone-chip-${cls}`}
              title={`${z.name || z.entity}\n${z.entity}`}
            >
              <span className="zone-name">{z.name || z.entity}</span>
              {open === true && (
                <span className="zone-alert">{zoneStateLabel(z.kind, true)}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
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
