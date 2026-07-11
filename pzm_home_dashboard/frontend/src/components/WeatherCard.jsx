import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { startPolling } from '../lib/poll.js';
import { tilePlacementStyle } from '../lib/placement.js';

// Forecast barely moves hour to hour and the backend caches upstream for
// 15 min anyway — poll gently.
const POLL_MS = 10 * 60 * 1000;

// WMO weather code (Open-Meteo) → icon kind.
function kindFor(code, night) {
  if (code === 0) return night ? 'moon' : 'sun';
  if (code === 1 || code === 2) return night ? 'moon-cloud' : 'sun-cloud';
  if (code === 3) return 'cloud';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'storm';
  return 'cloud';
}

const CLOUD_D = 'M25 22H10a5 5 0 1 1 1.2-9.86A7 7 0 0 1 24.6 13.9 4.6 4.6 0 0 1 25 22z';

function Sun({ small }) {
  const c = small ? { x: 11, y: 11, r: 4 } : { x: 16, y: 16, r: 6 };
  const rays = [];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const r1 = c.r + 2;
    const r2 = c.r + (small ? 4 : 5);
    rays.push(
      <line
        key={i}
        x1={(c.x + Math.cos(a) * r1).toFixed(2)}
        y1={(c.y + Math.sin(a) * r1).toFixed(2)}
        x2={(c.x + Math.cos(a) * r2).toFixed(2)}
        y2={(c.y + Math.sin(a) * r2).toFixed(2)}
      />,
    );
  }
  return (
    <g className="wx-sun">
      <g className="wx-rays" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">{rays}</g>
      <circle className="wx-core" cx={c.x} cy={c.y} r={c.r} fill="currentColor" />
    </g>
  );
}

function Moon({ small }) {
  const s = small ? 'translate(4.5 4.5) scale(0.62)' : undefined;
  return (
    <g className="wx-moon" transform={s}>
      <path
        className="wx-core"
        fill="currentColor"
        d="M21.5 18.6A8.3 8.3 0 0 1 12.9 6.4a1 1 0 0 0-1.2-1.3 9.6 9.6 0 1 0 11.1 14.7 1 1 0 0 0-1.3-1.2z"
      />
    </g>
  );
}

function Drops({ n, drizzle }) {
  const xs = n === 2 ? [13, 20] : [11.5, 16.5, 21.5];
  return (
    <g stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" className="wx-drops">
      {xs.map((x, i) => (
        <line key={x} className={`wx-drop wx-drop-${i}`} x1={x} y1={24.5} x2={x - 1} y2={drizzle ? 26.5 : 28} />
      ))}
    </g>
  );
}

function Flakes() {
  return (
    <g fill="currentColor" className="wx-flakes">
      {[11.5, 16.5, 21.5].map((x, i) => (
        <circle key={x} className={`wx-flake wx-flake-${i}`} cx={x} cy={25} r={1.3} />
      ))}
    </g>
  );
}

// Layered, CSS-animated weather glyph. Colour comes from CSS classes so
// day/night/precipitation each read distinctly at kiosk distance.
function WeatherIcon({ code, night }) {
  const kind = kindFor(code, night);
  return (
    <svg className={`wx-icon wx-kind-${kind}`} viewBox="0 0 32 32" aria-hidden>
      {kind === 'sun' && <Sun />}
      {kind === 'moon' && <Moon />}
      {(kind === 'sun-cloud' || kind === 'moon-cloud') && (
        <>
          <g className="wx-behind">{kind === 'sun-cloud' ? <Sun small /> : <Moon small />}</g>
          <path className="wx-cloud" fill="currentColor" d={CLOUD_D} transform="translate(1 3) scale(0.92)" />
        </>
      )}
      {(kind === 'cloud' || kind === 'fog' || kind === 'drizzle' || kind === 'rain'
        || kind === 'snow' || kind === 'storm') && (
        <path className="wx-cloud" fill="currentColor" d={CLOUD_D} />
      )}
      {kind === 'fog' && (
        <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="wx-fog">
          <line className="wx-fog-line wx-fog-0" x1="8" y1="25" x2="24" y2="25" />
          <line className="wx-fog-line wx-fog-1" x1="10" y1="28" x2="22" y2="28" />
        </g>
      )}
      {kind === 'drizzle' && <Drops n={3} drizzle />}
      {kind === 'rain' && <Drops n={3} />}
      {kind === 'snow' && <Flakes />}
      {kind === 'storm' && (
        <>
          <Drops n={2} />
          <path className="wx-bolt" fill="currentColor" d="M17 20l-4.4 6.4h2.9l-1.6 5.4 5.9-7.6h-3l2.2-4.2z" />
        </>
      )}
    </svg>
  );
}

// Sunrise / sunset strip cell glyph: half sun on the horizon with an
// up/down arrow.
function SunEventIcon({ type }) {
  const up = type === 'sunrise';
  return (
    <svg className={`wx-icon wx-kind-${type}`} viewBox="0 0 32 32" aria-hidden>
      <g className={up ? 'wx-sun-rise' : 'wx-sun-set'}>
        <path fill="currentColor" d="M10 21a6 6 0 0 1 12 0z" />
        <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <line x1="16" y1="9.5" x2="16" y2="12.5" />
          <line x1="8.2" y1="13.4" x2="10.3" y2="15.5" />
          <line x1="23.8" y1="13.4" x2="21.7" y2="15.5" />
        </g>
      </g>
      <line x1="6" y1="23.5" x2="26" y2="23.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path
        fill="currentColor"
        d={up ? 'M16 26l-2.6 3h5.2z' : 'M16 30.5l-2.6-3h5.2z'}
        transform="translate(0 -1)"
      />
    </svg>
  );
}

function WindArrow({ dir }) {
  // Open-Meteo reports the direction wind comes FROM; point the arrow
  // where it blows TO.
  const rot = ((Number(dir) || 0) + 180) % 360;
  return (
    <svg className="wx-wind-arrow" viewBox="0 0 12 12" style={{ transform: `rotate(${rot}deg)` }} aria-hidden>
      <path fill="currentColor" d="M6 0.8 L9 8.2 L6 6.6 L3 8.2 Z" />
    </svg>
  );
}

function hhmm(tSec) {
  return new Date(tSec * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Wide hourly-forecast card: next 24 h in a horizontally scrollable strip
// with sunrise/sunset cells slotted in chronologically. Data comes from
// the backend's Open-Meteo proxy keyed to HA's home coordinates.
function WeatherCard({ col, row, colSpan, rowSpan, editMode, onStartMove, onStartResize }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const lastPayloadRef = useRef('');

  useEffect(() => startPolling(async () => {
    try {
      const r = await fetch('api/ha/weather');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const text = await r.text();
      setError(null);
      if (text === lastPayloadRef.current) return;
      lastPayloadRef.current = text;
      setData(JSON.parse(text));
    } catch (e) {
      setError(String(e));
    }
  }, POLL_MS), []);

  const cells = useMemo(() => {
    const hours = Array.isArray(data?.hours) ? data.hours : [];
    const sun = Array.isArray(data?.sun) ? [...data.sun].sort((a, b) => a.t - b.t) : [];
    // Night when the latest sun event at or before t is a sunset (or,
    // before any known event, when the next one is a sunrise).
    const isNight = (t) => {
      let last = null;
      for (const e of sun) {
        if (e.t <= t) last = e;
        else break;
      }
      if (last) return last.type === 'sunset';
      const next = sun.find((e) => e.t > t);
      return next ? next.type === 'sunrise' : false;
    };
    const out = hours.map((h) => ({ ...h, kind: 'hour', night: isNight(h.t) }));
    if (out.length > 0) {
      const t0 = out[0].t;
      const t1 = out[out.length - 1].t;
      for (const e of sun) {
        if (e.t > t0 && e.t <= t1) out.push({ kind: e.type, t: e.t });
      }
    }
    out.sort((a, b) => a.t - b.t);
    return out;
  }, [data]);

  const nextSun = useMemo(() => {
    const sun = Array.isArray(data?.sun) ? [...data.sun].sort((a, b) => a.t - b.t) : [];
    const now = Date.now() / 1000;
    const rise = sun.find((e) => e.type === 'sunrise' && e.t >= now);
    const set = sun.find((e) => e.type === 'sunset' && e.t >= now);
    return { rise, set };
  }, [data]);

  const style = tilePlacementStyle(col, row, colSpan, rowSpan);
  const configured = data ? data.configured !== false : true;
  const nowHour = cells.find((c) => c.kind === 'hour');

  return (
    <div
      className={`tile weather-tile${editMode ? ' tile-editing' : ''}`}
      style={style}
      onPointerDown={editMode ? (e) => e.button === 0 && onStartMove(e) : undefined}
      title="Hourly forecast (Open-Meteo, HA home location)"
    >
      <div className="wx-inner">
        <div className="wx-head">
          <span className="wx-title">Weather</span>
          {nowHour && Number.isFinite(nowHour.temp) && (
            <span className="wx-now">
              {Math.round(nowHour.temp)}°
            </span>
          )}
          <span className="wx-head-spacer" />
          {nextSun.rise && (
            <span className="wx-sun-chip" title="Sunrise">
              <SunEventIcon type="sunrise" />{hhmm(nextSun.rise.t)}
            </span>
          )}
          {nextSun.set && (
            <span className="wx-sun-chip" title="Sunset">
              <SunEventIcon type="sunset" />{hhmm(nextSun.set.t)}
            </span>
          )}
        </div>
        {error && <div className="solar-note solar-note-error">Fetch error</div>}
        {!error && !configured && (
          <div className="solar-note">Weather needs the Home Assistant connection (home coordinates).</div>
        )}
        {!error && configured && data && cells.length === 0 && (
          <div className="solar-note">No forecast available right now.</div>
        )}
        {cells.length > 0 && (
          <div className="wx-strip">
            {cells.map((c, i) => (c.kind === 'hour' ? (
              <div className={`wx-cell ${c.night ? 'wx-night' : ''}`} key={`h-${c.t}`}>
                <span className="wx-cell-time">
                  {i === 0 ? 'Now' : `${new Date(c.t * 1000).getHours()}:00`}
                </span>
                <span className="wx-cell-icon"><WeatherIcon code={c.code} night={c.night} /></span>
                <span className="wx-cell-temp">
                  {Number.isFinite(c.temp) ? `${Math.round(c.temp)}°` : '—'}
                </span>
                <span className="wx-cell-wind">
                  <WindArrow dir={c.windDir} />
                  {Number.isFinite(c.wind) ? Math.round(c.wind) : '—'}
                  <span className="wx-wind-unit">m/s</span>
                </span>
                <span className={`wx-cell-precip ${Number.isFinite(c.precip) && c.precip >= 20 ? '' : 'wx-precip-quiet'}`}>
                  {Number.isFinite(c.precip) && c.precip >= 20 ? `${Math.round(c.precip)}%` : ' '}
                </span>
              </div>
            ) : (
              <div className={`wx-cell wx-cell-sun wx-cell-${c.kind}`} key={`s-${c.kind}-${c.t}`}>
                <span className="wx-cell-time">{hhmm(c.t)}</span>
                <span className="wx-cell-icon"><SunEventIcon type={c.kind} /></span>
                <span className="wx-cell-sunlabel">{c.kind === 'sunrise' ? 'Sunrise' : 'Sunset'}</span>
              </div>
            )))}
          </div>
        )}
      </div>
      {editMode && (
        <>
          <div className="tile-edit-top">
            <span className="tile-edit-name">Weather</span>
            <span className="tile-edit-size">{colSpan}×{rowSpan}</span>
          </div>
          <div className="tile-resize" onPointerDown={(e) => e.button === 0 && onStartResize(e)} />
        </>
      )}
    </div>
  );
}

export default memo(WeatherCard);
