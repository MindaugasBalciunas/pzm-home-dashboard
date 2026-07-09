import { useCallback, useEffect, useRef, useState } from 'react';

const POLL_MS = 4000;

// Alarm states we recognise from HA's alarm_control_panel entity.
const ARMED_STATES = new Set([
  'armed_home', 'armed_away', 'armed_night', 'armed_vacation', 'armed_custom_bypass',
]);

function labelForAlarmState(state) {
  if (!state) return 'Unknown';
  switch (state) {
    case 'disarmed':      return 'Disarmed';
    case 'armed_home':    return 'Armed · Home';
    case 'armed_away':    return 'Armed · Away';
    case 'armed_night':   return 'Armed · Night';
    case 'armed_vacation':return 'Armed · Vacation';
    case 'armed_custom_bypass': return 'Armed · Bypass';
    case 'arming':        return 'Arming…';
    case 'pending':       return 'Pending…';
    case 'triggered':     return 'ALARM!';
    default:              return state.replace(/_/g, ' ');
  }
}

function statusForAlarm(state) {
  if (!state) return 'unknown';
  if (state === 'triggered') return 'bad';
  if (state === 'disarmed') return 'ok';
  if (ARMED_STATES.has(state)) return 'armed';
  return 'pending';
}

// Contact sensors: normalise 'on'/'off' (HA convention: on = detected/open).
function contactOpen(state) {
  if (!state || !state.state) return null;
  const s = String(state.state).toLowerCase();
  if (s === 'on' || s === 'open' || s === 'opened') return true;
  if (s === 'off' || s === 'closed' || s === 'clear') return false;
  return null;
}

export default function SecurityCard({
  col, row, colSpan, rowSpan, editMode, onStartMove, onStartResize,
}) {
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState({});     // gateIndex -> boolean
  const [alarmBusy, setAlarmBusy] = useState(false);
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

  const sendAlarm = async (action) => {
    setAlarmBusy(true);
    try {
      let code = null;
      if (action === 'disarm') {
        // Prompt only if server hasn't got a code configured for us — most
        // panels require one. Sending an empty code lets the backend fall
        // back to `alarm_code` from options.
        const stored = window.sessionStorage.getItem('pzm-alarm-code') || '';
        code = window.prompt('Alarm PIN (leave blank if the add-on has one)', stored);
        if (code === null) { setAlarmBusy(false); return; } // cancelled
        if (code) window.sessionStorage.setItem('pzm-alarm-code', code);
      }
      const r = await fetch('api/ha/security/alarm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, code }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setTimeout(load, 800);
    } catch (e) {
      setError(String(e));
    } finally {
      setAlarmBusy(false);
    }
  };

  const style = {
    gridColumn: `${col} / span ${colSpan}`,
    gridRow: `${row} / span ${rowSpan}`,
  };

  const alarm = snapshot?.alarm ?? null;
  const gates = snapshot?.gates ?? [];
  const zones = snapshot?.zones ?? [];
  const alarmState = alarm?.state ?? null;
  const alarmStatus = statusForAlarm(alarmState);
  const configured = snapshot?.configured ?? false;

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

        {alarm && (
          <div className={`security-alarm security-alarm-${alarmStatus}`}>
            <div className="security-alarm-head">
              <span className="security-alarm-label">Alarm</span>
              <span className="security-alarm-state">{labelForAlarmState(alarmState)}</span>
            </div>
            <div className="security-alarm-actions">
              <button
                type="button"
                className="security-btn security-btn-disarm"
                disabled={alarmBusy || alarmState === 'disarmed'}
                onClick={() => sendAlarm('disarm')}
              >
                Disarm
              </button>
              <button
                type="button"
                className="security-btn security-btn-home"
                disabled={alarmBusy || alarmState === 'armed_home'}
                onClick={() => sendAlarm('arm_home')}
              >
                Arm · Home
              </button>
              <button
                type="button"
                className="security-btn security-btn-away"
                disabled={alarmBusy || alarmState === 'armed_away'}
                onClick={() => sendAlarm('arm_away')}
              >
                Arm · Away
              </button>
            </div>
          </div>
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
            const stateText = open === true ? 'Open'
              : open === false ? 'Closed'
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

        {zones.length > 0 && (
          <div className="security-zones">
            <div className="solar-section-title">Zones</div>
            <div className="zones-grid">
              {zones.map((z) => {
                const open = contactOpen(z.state);
                const cls = open === true ? 'bad' : open === false ? 'ok' : 'neutral';
                return (
                  <div key={z.entity} className={`zone-chip zone-chip-${cls}`}>
                    <span className="zone-name">{z.name || z.entity}</span>
                    <span className="zone-state">
                      {open === true ? 'Open' : open === false ? 'Closed' : (z.state?.state ?? '—')}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
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
  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%">
      <path fill="currentColor" d="M4 22V4h16v18h-2v-6h-4v6H4zm2-8h4V6H6v8zm8 0h4V6h-4v8z" />
    </svg>
  );
}
