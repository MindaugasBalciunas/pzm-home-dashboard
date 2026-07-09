import { useEffect, useRef, useState } from 'react';
import { TileIcon } from './SimpleTile.jsx';

const HISTORY_LEN = 80;
const POLL_MS = 3000;

const POWER_METRICS = [
  { key: 'pvTotal',  label: 'PV Total', accent: 'good' },
  { key: 'houseUse', label: 'House',    accent: 'neutral' },
  { key: 'import',   label: 'Import',   accent: 'bad' },
  { key: 'export',   label: 'Export',   accent: 'good' },
  { key: 'pv1',      label: 'PV 1',     accent: 'neutral' },
  { key: 'pv2',      label: 'PV 2',     accent: 'neutral' },
];

const ENERGY_METRICS = [
  { key: 'todaySolar',  label: 'Today Solar',  accent: 'good' },
  { key: 'pv1',         label: 'PV 1',         accent: 'good' },
  { key: 'pv2',         label: 'PV 2',         accent: 'good' },
  { key: 'todayExport', label: 'Today Export', accent: 'good' },
  { key: 'todayImport', label: 'Today Import', accent: 'bad' },
  { key: 'totalSolar',  label: 'Total Solar',  accent: 'good' },
];

const HEALTH_METRICS = [
  // runMode is rendered as a pill overlaid on the house image; don't duplicate here.
  { key: 'gridRuntime', label: 'Runtime' },
];

function toNumber(state) {
  if (!state || state.state == null) return null;
  if (state.state === 'unknown' || state.state === 'unavailable') return null;
  const n = Number(state.state);
  return Number.isFinite(n) ? n : null;
}

function formatValue(v, unit) {
  if (v == null) return { text: '—', unit: '' };
  if (unit === 'W' && Math.abs(v) >= 1000) return { text: (v / 1000).toFixed(2), unit: 'kW' };
  if (unit === 'W')   return { text: v.toFixed(0), unit: 'W' };
  if (unit === 'kW')  return { text: v.toFixed(2), unit: 'kW' };
  if (unit === 'kWh') return { text: v >= 100 ? v.toFixed(0) : v.toFixed(2), unit: 'kWh' };
  if (unit === 'V')   return { text: v.toFixed(1), unit: 'V' };
  if (unit === 'A')   return { text: v.toFixed(2), unit: 'A' };
  if (unit === '°C' || unit === '°F') return { text: v.toFixed(1), unit };
  if (unit === 'Hz')  return { text: v.toFixed(2), unit: 'Hz' };
  return { text: String(v), unit: unit || '' };
}

function formatRuntimeHours(state) {
  const n = toNumber(state);
  if (n == null) {
    return state?.state && state.state !== 'unknown' && state.state !== 'unavailable'
      ? String(state.state)
      : '—';
  }
  const unit = (state?.unit || '').toLowerCase();
  let hours = n;
  if (unit === 'min' || unit === 'minutes') hours = n / 60;
  else if (unit === 's' || unit === 'seconds') hours = n / 3600;
  else if (unit === 'days' || unit === 'd') hours = n * 24;
  if (hours < 1) return `${(hours * 60).toFixed(0)} min`;
  if (hours < 48) return `${hours.toFixed(0)} h`;
  return `${Math.floor(hours / 24)} d`;
}

function formatMode(state) {
  if (!state || state.state == null) return '—';
  if (state.state === 'unknown' || state.state === 'unavailable') return '—';
  const s = String(state.state);
  return s.length ? s.charAt(0).toUpperCase() + s.slice(1) : '—';
}

function formatPvPair(voltageState, currentState) {
  const v = toNumber(voltageState);
  const a = toNumber(currentState);
  if (v == null && a == null) return '—';
  const vText = v != null ? `${v.toFixed(0)} V` : '—';
  const aText = a != null ? `${a.toFixed(2)} A` : '—';
  return `${vText} · ${aText}`;
}

function Sparkline({ values, accent, metricKey }) {
  if (!values || values.length < 2) return null;
  const w = 100, h = 40;
  let min = Infinity, max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min > 0) min = min * 0.95;
  if (max <= min) max = min + 1;
  const range = max - min;
  const step = w / (values.length - 1);
  
  let linePoints = [];
  for (let i = 0; i < values.length; i++) {
    const x = i * step;
    const y = h - ((values[i] - min) / range) * h;
    linePoints.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  
  const strokePath = `M ${linePoints.join(' L ')}`;
  const fillPath = `${strokePath} L ${w},${h} L 0,${h} Z`;

  const gradientId = `spark-grad-${metricKey}`;
  
  let strokeColor = 'var(--accent)';
  if (accent === 'good') strokeColor = 'var(--ok)';
  if (accent === 'bad') strokeColor = 'var(--danger)';

  return (
    <svg className="sparkline-bg" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={strokeColor} stopOpacity="0.20" />
          <stop offset="100%" stopColor={strokeColor} stopOpacity="0.0" />
        </linearGradient>
      </defs>
      <path d={fillPath} fill={`url(#${gradientId})`} />
      <path d={strokePath} fill="none" stroke={strokeColor} strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function flowDur(v) {
  const w = Math.max(50, Math.min(6000, Math.abs(v || 0)));
  return `${Math.max(0.4, 2.6 - Math.log10(w) * 0.4).toFixed(2)}s`;
}

function FlowDiagram({
  pvState,
  importState,
  exportState,
  houseState,
  batteryPowerState,
  batterySocState,
  pv1State,
  pv2State,
  runModeText,
}) {
  const pv = toNumber(pvState) ?? 0;
  const imp = toNumber(importState) ?? 0;
  const exp = toNumber(exportState) ?? 0;
  const house = toNumber(houseState) ?? 0;
  const batPower = toNumber(batteryPowerState) ?? 0;
  const batSoc = toNumber(batterySocState);
  const pv1 = toNumber(pv1State);
  const pv2 = toNumber(pv2State);
  const active = (v) => (v || 0) > 5;

  const solarVal = formatValue(pv, pvState?.unit || 'W');
  const houseVal = formatValue(house, houseState?.unit || 'W');
  
  let gridVal = { text: '0', unit: 'W' };
  let isImporting = false;
  let isExporting = false;
  if (exp > 5) {
    gridVal = formatValue(exp, exportState?.unit || 'W');
    isExporting = true;
  } else if (imp > 5) {
    gridVal = formatValue(imp, importState?.unit || 'W');
    isImporting = true;
  }

  let gridValColor = 'var(--text)';
  if (isExporting) gridValColor = 'var(--ok)';
  if (isImporting) gridValColor = 'var(--danger)';

  const batteryConfigured = batterySocState && batterySocState.state != null;
  const isCharging = batPower < -5;
  const isDischarging = batPower > 5;
  const batPowerVal = formatValue(Math.abs(batPower), batteryPowerState?.unit || 'W');

  let pvTotalVal = pv;
  let pv1Val = pv1;
  let pv2Val = pv2;
  let pv1Pct = 0;
  let pv2Pct = 0;
  if (pvTotalVal > 0 && pv1Val != null && pv2Val != null) {
    pv1Pct = Math.round((pv1Val / pvTotalVal) * 100);
    pv2Pct = Math.round((pv2Val / pvTotalVal) * 100);
  }

  return (
    <svg className="flow-svg" viewBox="0 0 320 280" preserveAspectRatio="xMidYMid meet">
      <defs>
        <filter id="glow-solar" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#f59f00" floodOpacity="0.4" />
        </filter>
        <filter id="glow-grid" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#339af0" floodOpacity="0.4" />
        </filter>
        <filter id="glow-house" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#845ef7" floodOpacity="0.4" />
        </filter>

        <linearGradient id="interior-glow" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#ffd8a8" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0.0" />
        </linearGradient>
        <linearGradient id="solar-panel-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#1c2533" />
          <stop offset="100%" stopColor="#0a0f18" />
        </linearGradient>
      </defs>

      {/* Sky/Ambient rain lines */}
      <g stroke="rgba(74, 163, 255, 0.08)" strokeWidth="0.8" strokeDasharray="3 15" strokeLinecap="round">
        <line x1="30" y1="10" x2="15" y2="40" />
        <line x1="90" y1="15" x2="75" y2="45" />
        <line x1="160" y1="8" x2="145" y2="38" />
        <line x1="220" y1="18" x2="205" y2="48" />
        <line x1="280" y1="10" x2="265" y2="40" />
        <line x1="60" y1="50" x2="45" y2="80" />
        <line x1="120" y1="65" x2="105" y2="95" />
        <line x1="180" y1="58" x2="165" y2="88" />
        <line x1="240" y1="68" x2="225" y2="98" />
      </g>

      {/* ISOMETRIC HOUSE DRAWING */}
      {/* 3D Walls */}
      {/* Left Wall */}
      <polygon points="95,250 160,220 160,145 127,105 95,175" fill="var(--house-wall)" stroke="var(--house-border)" strokeWidth="0.5" />
      {/* Right Wall */}
      <polygon points="160,220 225,250 225,175 160,145" fill="var(--house-shadow)" stroke="var(--house-border)" strokeWidth="0.5" />

      {/* Roof Left Slope */}
      <polygon points="127,105 192,142 160,212 95,175" fill="var(--roof-color)" stroke="var(--roof-border)" strokeWidth="0.5" />
      {/* Roof Right Slope */}
      <polygon points="127,105 192,142 225,182 160,145" fill="var(--roof-shadow)" stroke="var(--roof-border)" strokeWidth="0.5" />

      {/* Solar Panels on Right Roof Slope */}
      <g>
        {/* Panel 1 */}
        <polygon points="135,115 160,129 178,152 153,138" fill="url(#solar-panel-grad)" stroke="#4aa3ff" strokeWidth="0.8" />
        {/* Panel 2 */}
        <polygon points="163,130 188,144 206,167 181,153" fill="url(#solar-panel-grad)" stroke="#4aa3ff" strokeWidth="0.8" />
        {/* Panel details / lines */}
        <line x1="147" y1="122" x2="165" y2="145" stroke="rgba(74, 163, 255, 0.25)" strokeWidth="0.5" />
        <line x1="175" y1="137" x2="193" y2="160" stroke="rgba(74, 163, 255, 0.25)" strokeWidth="0.5" />
      </g>

      {/* Living Room Glass Window with Interior warm glow */}
      <polygon points="105,190 150,170 150,148 127,128 105,158" fill="url(#interior-glow)" stroke="rgba(255, 255, 255, 0.1)" strokeWidth="0.5" />

      {/* Garage / Carport cavity */}
      <polygon points="105,245 150,225 150,195 105,215" fill="#0b0f14" stroke="var(--house-border)" strokeWidth="0.5" />
      {/* Sleek Electric Car inside garage */}
      <g transform="translate(126, 218) scale(0.68)">
        <path d="M-12,5 Q-12,-4 -7,-6 Q0,-8 7,-6 Q12,-4 12,5 Z" fill="#ffffff" opacity="0.85" />
        {/* Windshield */}
        <path d="M-8,-2 L8,-2 L5,-5 L-5,-5 Z" fill="#1e293b" opacity="0.8" />
        {/* Headlights */}
        <circle cx="-7" cy="2" r="1.5" fill="#fffbeb" />
        <circle cx="7" cy="2" r="1.5" fill="#fffbeb" />
      </g>

      {/* Heat Pump / AC unit on the left ground */}
      <g transform="translate(70, 240)">
        <rect x="-8" y="-12" width="16" height="14" rx="2" fill="var(--house-shadow)" stroke="var(--house-border)" strokeWidth="0.5" />
        <circle cx="0" cy="-5" r="4" fill="none" stroke="var(--muted)" strokeWidth="1" />
        <line x1="-2" y1="-5" x2="2" y2="-5" stroke="var(--muted)" strokeWidth="0.8" />
        <line x1="0" y1="-7" x2="0" y2="-3" stroke="var(--muted)" strokeWidth="0.8" />
      </g>

      {/* Inverter Box on right wall */}
      <rect x="202" y="195" width="12" height="12" rx="2" fill="var(--house-wall)" stroke="var(--house-border)" strokeWidth="0.5" />
      <line x1="205" y1="201" x2="211" y2="201" stroke="var(--muted)" strokeWidth="1" />

      {/* Solax Battery Box on right wall (if configured) */}
      {batteryConfigured && (
        <g transform="translate(208, 235)">
          <rect x="-8" y="-16" width="16" height="32" rx="2" fill="#0c1722" stroke="#00d8b4" strokeWidth="1.2" />
          <line x1="-5" y1="-10" x2="5" y2="-10" stroke="#00d8b4" strokeWidth="2" />
          <line x1="-5" y1="-4" x2="5" y2="-4" stroke="#00d8b4" strokeWidth="2" />
          <line x1="-5" y1="2" x2="5" y2="2" stroke="#00d8b4" strokeWidth="2" />
          <line x1="-5" y1="8" x2="5" y2="8" stroke="#00d8b4" strokeWidth="2" opacity={batSoc > 40 ? 1 : 0.2} />
        </g>
      )}

      {/* CONNECTING POWER FLOW LINES */}
      {/* Background/Inactive Paths */}
      <path d="M 175 145 L 208 162 L 208 195" className="flow-line-bg" />
      <path d="M 208 201 L 175 184 L 140 184" className="flow-line-bg" />
      <path d="M 208 201 L 208 245 L 195 252" className="flow-line-bg" />
      {batteryConfigured && <path d="M 208 205 L 208 219" className="flow-line-bg" />}

      {/* Active Flows */}
      {/* Solar to Inverter */}
      <path d="M 175 145 L 208 162 L 208 195"
            className={`flow-line ${active(pv) ? 'flow-forward' : ''}`}
            stroke="#f59f00"
            style={active(pv) ? { animationDuration: flowDur(pv), opacity: 1 } : { opacity: 0 }} />

      {/* Inverter to Home */}
      <path d="M 208 201 L 175 184 L 140 184"
            className={`flow-line ${active(house) ? 'flow-forward' : ''}`}
            stroke="var(--accent)"
            style={active(house) ? { animationDuration: flowDur(house), opacity: 1 } : { opacity: 0 }} />

      {/* Inverter to Grid (Export) vs Grid to Inverter (Import) */}
      {isExporting && (
        <path d="M 208 201 L 208 245 L 195 252"
              className="flow-line flow-forward"
              stroke="var(--ok)"
              style={{ animationDuration: flowDur(exp) }} />
      )}
      {isImporting && (
        <path d="M 195 252 L 208 245 L 208 201"
              className="flow-line flow-forward"
              stroke="var(--danger)"
              style={{ animationDuration: flowDur(imp) }} />
      )}

      {/* Inverter to Battery (Charge) vs Battery to Inverter (Discharge) */}
      {batteryConfigured && isCharging && (
        <path d="M 208 205 L 208 219"
              className="flow-line flow-forward"
              stroke="#00d8b4"
              style={{ animationDuration: flowDur(Math.abs(batPower)) }} />
      )}
      {batteryConfigured && isDischarging && (
        <path d="M 208 219 L 208 205"
              className="flow-line flow-forward"
              stroke="#00d8b4"
              style={{ animationDuration: flowDur(Math.abs(batPower)) }} />
      )}

      {/* Status Pill (Normal / Inverter Status) */}
      <g transform="translate(15, 20)">
        {runModeText && runModeText !== '—' && (
          <g>
            <rect x="0" y="0" width="54" height="16" rx="8" fill="rgba(87, 211, 140, 0.12)" />
            <text x="27" y="11" textAnchor="middle" fill="var(--ok)" fontSize="8" fontWeight="700">
              {runModeText}
            </text>
          </g>
        )}
      </g>

      {/* GLASSMORPHIC FLOATING STATS CARDS */}
      {/* Solar Card */}
      <g className="svg-card" transform="translate(195, 20)">
        <rect x="0" y="0" width="105" height="48" rx="6" fill="var(--card-bg)" stroke="var(--card-border)" strokeWidth="1" />
        <text x="8" y="15" className="card-val" fill="var(--text)">{solarVal.text}<tspan className="card-unit"> {solarVal.unit}</tspan></text>
        <text x="8" y="27" className="card-lbl" fill="var(--muted)">Solar</text>
      </g>

      {/* Home Card */}
      <g className="svg-card" transform="translate(15, 115)">
        <rect x="0" y="0" width="75" height="36" rx="6" fill="var(--card-bg)" stroke="var(--card-border)" strokeWidth="1" />
        <text x="8" y="16" className="card-val" fill="var(--text)">{houseVal.text}<tspan className="card-unit"> {houseVal.unit}</tspan></text>
        <text x="8" y="28" className="card-lbl" fill="var(--muted)">Home</text>
      </g>

      {/* Grid Card */}
      <g className="svg-card" transform="translate(195, 222)">
        <rect x="0" y="0" width="80" height="36" rx="6" fill="var(--card-bg)" stroke="var(--card-border)" strokeWidth="1" />
        <text x="8" y="16" className="card-val" fill={gridValColor}>{gridVal.text}<tspan className="card-unit"> {gridVal.unit}</tspan></text>
        <text x="8" y="28" className="card-lbl" fill="var(--muted)">
          {isExporting ? 'Grid (Export)' : isImporting ? 'Grid (Import)' : 'Grid'}
        </text>
      </g>

      {/* Battery Card (if configured) */}
      {batteryConfigured && (
        <g className="svg-card" transform="translate(230, 160)">
          <rect x="0" y="0" width="78" height="48" rx="6" fill="var(--card-bg)" stroke="var(--card-border)" strokeWidth="1" />
          <text x="8" y="15" className="card-val" fill="var(--text)">{batPowerVal.text}<tspan className="card-unit"> {batPowerVal.unit}</tspan></text>
          <text x="8" y="27" className="card-lbl" fill="var(--muted)">
            {isCharging ? 'Battery (Chg)' : isDischarging ? 'Battery (Dischg)' : 'Battery'}
          </text>
          <text x="8" y="39" className="card-sub-lbl-bat" fill="#00d8b4">{batSoc}%</text>
        </g>
      )}
    </svg>
  );
}

function HouseView({
  pvState,
  pv1State,
  pv2State,
  importState,
  exportState,
  houseState,
  runModeText,
}) {
  const pv = toNumber(pvState) ?? 0;
  const pv1 = toNumber(pv1State) ?? 0;
  const pv2 = toNumber(pv2State) ?? 0;
  const imp = toNumber(importState) ?? 0;
  const exp = toNumber(exportState) ?? 0;
  const house = toNumber(houseState) ?? 0;

  const active = (v) => (v || 0) > 5;
  const isImporting = imp > 5;
  const isExporting = exp > 5;

  const sum = pv1 + pv2;
  const pv1Pct = sum > 5 ? Math.round((pv1 / sum) * 100) : 0;
  const pv2Pct = sum > 5 ? Math.round((pv2 / sum) * 100) : 0;

  const pvFmt   = formatValue(pv,   pvState?.unit   || 'W');
  const pv1Fmt  = formatValue(pv1,  pv1State?.unit  || 'W');
  const pv2Fmt  = formatValue(pv2,  pv2State?.unit  || 'W');
  const houseFmt = formatValue(house, houseState?.unit || 'W');
  const gridPow = isExporting ? exp : imp;
  const gridFmt = formatValue(gridPow, (isExporting ? exportState?.unit : importState?.unit) || 'W');

  // Colors keyed to what's flowing on each leg.
  const solarColor  = '#f59f00';
  const houseColor  = 'var(--accent)';   // blue
  const exportColor = 'var(--ok)';       // green
  const importColor = 'var(--danger)';   // red
  const idleStroke  = undefined;         // fall through to .hv-line default

  const pv2Line = active(pv2) ? { animationDuration: flowDur(pv2), stroke: solarColor, color: solarColor } : idleStroke;
  const pv1Line = active(pv1) ? { animationDuration: flowDur(pv1), stroke: solarColor, color: solarColor } : idleStroke;
  const solarBusLine = active(pv) ? { animationDuration: flowDur(pv), stroke: solarColor, color: solarColor } : idleStroke;
  const houseLine = active(house) ? { animationDuration: flowDur(house), stroke: houseColor, color: houseColor } : idleStroke;
  const gridLine = isExporting
    ? { animationDuration: flowDur(exp), stroke: exportColor, color: exportColor }
    : isImporting
      ? { animationDuration: flowDur(imp), stroke: importColor, color: importColor }
      : idleStroke;

  return (
    <div className="house-view">
      {/* Background is set inline so the URL resolves against the document base
          rather than the CSS file location — under HAOS ingress the stylesheet
          lives in /assets/, but house.png sits next to index.html. */}
      <div
        className="house-view-bg"
        style={{ backgroundImage: "url('house.png')" }}
      />

      {/*
        Straight vertical/horizontal segments only, junction at (63, 55) near the
        garage. Roof panel anchors: PV 2 ≈ (37,31), PV 1 ≈ (52,30).
        House body flow terminus ≈ (44, 66). Grid corner ≈ (85, 78).
      */}
      <svg className="house-view-flow" viewBox="0 0 100 100" preserveAspectRatio="none">
        {/* Bubble centres (0–100 units): PV 2 ≈ (34, 11), PV 1 ≈ (56, 11),
            Home ≈ (89, 35), Grid ≈ (89, 91). Junction stays at (78, 50).
            PV lines are short vertical drops to the roof (~15 units ≈ ~50px);
            the shared "solar bus" carries the total across to the junction. */}
        <path d="M 34 11 V 26"
              className={`hv-line ${active(pv2) ? 'hv-line-active' : ''}`}
              style={pv2Line} />
        <path d="M 56 11 V 26"
              className={`hv-line ${active(pv1) ? 'hv-line-active' : ''}`}
              style={pv1Line} />
        <path d="M 34 26 H 78 V 50"
              className={`hv-line ${active(pv) ? 'hv-line-active' : ''}`}
              style={solarBusLine} />
        <path d="M 78 50 H 89 V 35"
              className={`hv-line ${active(house) ? 'hv-line-active' : ''}`}
              style={houseLine} />
        <path d={isImporting ? "M 89 91 V 50 H 78" : "M 78 50 V 91 H 89"}
              className={`hv-line ${(isExporting || isImporting) ? 'hv-line-active' : ''}`}
              style={gridLine} />
      </svg>

      {/* Solar (PV Total) — top-left, with PV 1 / PV 2 breakdown lines. */}
      <div className="hv-callout hv-callout-pv-total">
        <div className="hv-callout-value">
          <span className="hv-callout-num">{pvFmt.text}</span>
          {pvFmt.unit && <span className="hv-callout-unit">{pvFmt.unit}</span>}
        </div>
        <div className="hv-callout-label">Solar</div>
      </div>

      {/* PV 2 — top-left, near left panels */}
      <div className="hv-callout hv-callout-pv2">
        <div className="hv-callout-value">
          <span className="hv-callout-num">{pv2Fmt.text}</span>
          {pv2Fmt.unit && <span className="hv-callout-unit">{pv2Fmt.unit}</span>}
        </div>
        <div className="hv-callout-label">
          <span>PV 2</span>
          <span className="hv-callout-pct">{sum > 5 ? `${pv2Pct}%` : '—'}</span>
        </div>
      </div>

      {/* PV 1 — top-right, near right panels */}
      <div className="hv-callout hv-callout-pv1">
        <div className="hv-callout-value">
          <span className="hv-callout-num">{pv1Fmt.text}</span>
          {pv1Fmt.unit && <span className="hv-callout-unit">{pv1Fmt.unit}</span>}
        </div>
        <div className="hv-callout-label">
          <span>PV 1</span>
          <span className="hv-callout-pct">{sum > 5 ? `${pv1Pct}%` : '—'}</span>
        </div>
      </div>

      {/* Home — over the house body */}
      <div className="hv-callout hv-callout-home">
        <div className="hv-callout-value">
          <span className="hv-callout-num">{houseFmt.text}</span>
          {houseFmt.unit && <span className="hv-callout-unit">{houseFmt.unit}</span>}
        </div>
        <div className="hv-callout-label">Home</div>
      </div>

      {/* Grid — bottom-right corner */}
      <div className={`hv-callout hv-callout-grid ${isExporting ? 'hv-good' : isImporting ? 'hv-bad' : ''}`}>
        <div className="hv-callout-value">
          <span className="hv-callout-num">{gridFmt.text}</span>
          {gridFmt.unit && <span className="hv-callout-unit">{gridFmt.unit}</span>}
        </div>
        <div className="hv-callout-label">
          {isExporting ? 'Export' : isImporting ? 'Import' : 'Grid'}
        </div>
      </div>

      {/* Operation mode — small pill on the bottom of the image */}
      {runModeText && runModeText !== '—' && (
        <div className="hv-mode-pill">{runModeText}</div>
      )}
    </div>
  );
}

function EnergyCell({ metric, state }) {
  const v = toNumber(state);
  const { text, unit } = formatValue(v, state?.unit);
  return (
    <div className={`energy-cell energy-accent-${metric.accent}`}>
      <div className="energy-label">{metric.label}</div>
      <div className="energy-value">
        <span className="energy-num">{text}</span>
        {unit && <span className="energy-unit">{unit}</span>}
      </div>
    </div>
  );
}

function EnergyChip({ metric, state, samples, monthly }) {
  const v = toNumber(state);
  const { text, unit } = formatValue(v, state?.unit);
  const useMonthly = metric.key === 'totalSolar' && monthly && monthly.length > 0;

  let maxLabel = null;
  let maxTitle = '24h peak';
  if (useMonthly) {
    let maxV = -Infinity;
    for (const m of monthly) if (Number.isFinite(m.v) && m.v > maxV) maxV = m.v;
    if (Number.isFinite(maxV)) {
      const { text: mt, unit: mu } = formatValue(maxV, state?.unit || 'kWh');
      maxLabel = mu ? `${mt} ${mu}` : mt;
    }
    maxTitle = 'Best month (last 12)';
  } else if (samples && samples.length > 0) {
    let maxV = -Infinity;
    for (const s of samples) {
      const val = typeof s === 'number' ? s : s.v;
      if (Number.isFinite(val) && val > maxV) maxV = val;
    }
    if (Number.isFinite(maxV)) {
      const { text: mt, unit: mu } = formatValue(maxV, state?.unit);
      maxLabel = mu ? `${mt} ${mu}` : mt;
    }
  }

  return (
    <div className={`energy-chip energy-accent-${metric.accent}`}>
      {useMonthly ? (
        <MonthlyBars monthly={monthly} accent={metric.accent} />
      ) : (
        samples && samples.length >= 2 && (
          <TodayGraph samples={samples} accent={metric.accent} />
        )
      )}
      <div className="energy-chip-inner">
        <div className="energy-chip-header">
          <span className="energy-chip-label">{metric.label}</span>
          {maxLabel && <span className="energy-chip-max" title={maxTitle}>↑ {maxLabel}</span>}
        </div>
        <div className="energy-chip-value">
          <span className="energy-chip-num">{text}</span>
          {unit && <span className="energy-chip-unit">{unit}</span>}
        </div>
      </div>
    </div>
  );
}

function MonthlyBars({ monthly, accent }) {
  if (!monthly || monthly.length === 0) return null;
  const w = 100, h = 30;
  let maxV = 0;
  for (const m of monthly) if (m.v > maxV) maxV = m.v;
  if (maxV <= 0) maxV = 1;
  const slot = w / monthly.length;
  const pad = 0.18;
  const barW = slot * (1 - 2 * pad);
  return (
    <svg
      className={`today-graph today-graph-${accent}`}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
    >
      {monthly.map((m, i) => {
        const barH = (m.v / maxV) * (h - 1);
        const x = i * slot + slot * pad;
        const y = h - barH;
        return (
          <rect
            key={`${m.year}-${m.month}`}
            className="today-graph-bar"
            x={x.toFixed(2)}
            y={y.toFixed(2)}
            width={barW.toFixed(2)}
            height={barH.toFixed(2)}
            rx="0.4"
          />
        );
      })}
    </svg>
  );
}

function TodayGraph({ samples, accent }) {
  if (!samples || samples.length < 2) return null;
  const w = 100, h = 30;
  const values = samples.map((s) => (typeof s === 'number' ? s : s.v));
  let min = Infinity, max = -Infinity;
  for (const v of values) { if (v < min) min = v; if (v > max) max = v; }
  if (min > 0) min = 0;
  if (max <= min) max = min + 1;
  const range = max - min;
  const n = values.length;
  const step = w / (n - 1);
  let linePath = '';
  for (let i = 0; i < n; i++) {
    const x = (i * step).toFixed(1);
    const y = (h - ((values[i] - min) / range) * (h - 1) - 0.5).toFixed(1);
    linePath += (i === 0 ? 'M' : ' L') + x + ',' + y;
  }
  const areaPath = linePath + ` L ${w},${h} L 0,${h} Z`;
  return (
    <svg
      className={`today-graph today-graph-${accent}`}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
    >
      <path d={areaPath} className="today-graph-fill" />
      <path d={linePath} className="today-graph-line" fill="none" />
    </svg>
  );
}

export default function SolarCard({
  col, row, colSpan, rowSpan, editMode,
  onStartMove, onStartResize,
}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState({});
  const [history24h, setHistory24h] = useState({});
  const [monthly, setMonthly] = useState([]);
  const timerRef = useRef(null);
  const historyTimerRef = useRef(null);
  const monthlyTimerRef = useRef(null);
  // Ref so children (Loads) can request a refresh after toggling a switch
  // without wiring the loader through props from mount.
  const loadRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch('api/ha/solar');
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (cancelled) return;
        setData(j);
        setError(null);
        setHistory((prev) => {
          const next = { ...prev };
          for (const m of POWER_METRICS) {
            const n = toNumber(j[m.key]);
            if (n == null) continue;
            const arr = next[m.key] ? next[m.key].slice() : [];
            arr.push(n);
            if (arr.length > HISTORY_LEN) arr.shift();
            next[m.key] = arr;
          }
          return next;
        });
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    };
    loadRef.current = load;
    load();
    timerRef.current = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timerRef.current);
      loadRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadHistory = async () => {
      try {
        // Fetch enough hours to definitely span midnight-to-now in local time.
        const now = new Date();
        const midnight = new Date(now);
        midnight.setHours(0, 0, 0, 0);
        const hoursSinceMidnight = Math.max(
          1,
          Math.ceil((now.getTime() - midnight.getTime()) / 3_600_000),
        );
        const r = await fetch(`api/ha/solar/history?hours=${hoursSinceMidnight + 1}`);
        if (!r.ok) return;
        const j = await r.json();
        if (cancelled) return;
        // Trim any samples from before midnight (they can slip in because
        // HA history returns the last state before the window as an anchor).
        const midnightMs = midnight.getTime();
        const trimmed = {};
        for (const [k, v] of Object.entries(j || {})) {
          if (!Array.isArray(v)) { trimmed[k] = v; continue; }
          trimmed[k] = v.filter((s) => (s && typeof s.t === 'number' ? s.t >= midnightMs : true));
        }
        setHistory24h(trimmed);
      } catch { /* transient — retry on the next tick */ }
    };
    loadHistory();
    historyTimerRef.current = setInterval(loadHistory, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(historyTimerRef.current); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadMonthly = async () => {
      try {
        const r = await fetch('api/ha/solar/monthly?months=12');
        if (!r.ok) return;
        const j = await r.json();
        if (cancelled) return;
        setMonthly(Array.isArray(j?.months) ? j.months : []);
      } catch { /* transient */ }
    };
    loadMonthly();
    monthlyTimerRef.current = setInterval(loadMonthly, 60 * 60 * 1000);
    return () => { cancelled = true; clearInterval(monthlyTimerRef.current); };
  }, []);

  const handleTileDown = (e) => {
    if (!editMode) return;
    if (e.button !== 0) return;
    if (e.target.closest('button')) return;
    if (e.target.closest('.tile-resize')) return;
    onStartMove?.(e);
  };
  const handleResizeDown = (e) => {
    if (!editMode) return;
    if (e.button !== 0) return;
    onStartResize?.(e);
  };

  const style = {
    gridColumn: `${col} / span ${colSpan}`,
    gridRow: `${row} / span ${rowSpan}`,
  };

  const configured = data ? data.configured !== false : true;
  const pv = toNumber(data?.pvTotal) ?? 0;
  const imp = toNumber(data?.import) ?? 0;
  const exp = toNumber(data?.export) ?? 0;
  const house = toNumber(data?.houseUse) ?? 0;
  const batPower = toNumber(data?.batteryPower) ?? 0;
  const batSoc = toNumber(data?.batterySoc);
  const pv1 = toNumber(data?.pv1);
  const pv2 = toNumber(data?.pv2);

  const solarVal = formatValue(pv, data?.pvTotal?.unit || 'W');
  const houseVal = formatValue(house, data?.houseUse?.unit || 'W');

  let gridVal = { text: '0', unit: 'W' };
  let isImporting = false;
  let isExporting = false;
  if (exp > 5) {
    gridVal = formatValue(exp, data?.export?.unit || 'W');
    isExporting = true;
  } else if (imp > 5) {
    gridVal = formatValue(imp, data?.import?.unit || 'W');
    isImporting = true;
  }

  const batteryConfigured = data?.batterySoc && data.batterySoc.state != null;
  const isCharging = batPower < -5;
  const isDischarging = batPower > 5;
  const batPowerVal = formatValue(Math.abs(batPower), data?.batteryPower?.unit || 'W');

  let pvTotalVal = pv;
  let pv1Val = pv1;
  let pv2Val = pv2;
  let pv1Pct = 0;
  let pv2Pct = 0;
  if (pvTotalVal > 0 && pv1Val != null && pv2Val != null) {
    pv1Pct = Math.round((pv1Val / pvTotalVal) * 100);
    pv2Pct = Math.round((pv2Val / pvTotalVal) * 100);
  }

  return (
    <div
      className={`tile solar-tile${editMode ? ' tile-editing' : ''}`}
      style={style}
      onPointerDown={handleTileDown}
    >
      <div className="solar-inner">
        <div className="solar-title">Electricity</div>
        {error && <div className="solar-note solar-note-error">Fetch error</div>}
        {!error && !configured && (
          <div className="solar-note">Set Home Assistant token in appsettings.json to see live data.</div>
        )}

        <div className="solar-flow solar-flow-photo">
          <HouseView
            pvState={data?.pvTotal}
            pv1State={data?.pv1}
            pv2State={data?.pv2}
            importState={data?.import}
            exportState={data?.export}
            houseState={data?.houseUse}
            runModeText={data?.runMode ? formatMode(data.runMode) : null}
          />
        </div>

        <div className="energy-strip">
          {ENERGY_METRICS.map((m) => (
            <EnergyChip
              key={m.key}
              metric={m}
              state={data?.[m.key]}
              samples={history24h?.[m.key]}
              monthly={m.key === 'totalSolar' ? monthly : null}
            />
          ))}
        </div>

        {(data?.p1ImportTotal || data?.p1ExportTotal
          || data?.p1ImportT1 || data?.p1ImportT2
          || data?.p1ExportT1 || data?.p1ExportT2) && (
          <GridMeter data={data} />
        )}

        {Array.isArray(data?.controls) && data.controls.length > 0 && (
          <ElectricControls
            controls={data.controls}
            onChanged={() => loadRef.current?.()}
          />
        )}

        {(data?.runMode || data?.gridRuntime
          || data?.pv1Voltage || data?.pv2Voltage
          || data?.pv1Current || data?.pv2Current) && (
          <div className="health-row">
            {data?.pv1Voltage || data?.pv1Current ? (
              <span className="health-chip">
                <span className="health-label">PV 1</span>
                <span className="health-value">{formatPvPair(data?.pv1Voltage, data?.pv1Current)}</span>
              </span>
            ) : null}
            {data?.pv2Voltage || data?.pv2Current ? (
              <span className="health-chip">
                <span className="health-label">PV 2</span>
                <span className="health-value">{formatPvPair(data?.pv2Voltage, data?.pv2Current)}</span>
              </span>
            ) : null}
            {HEALTH_METRICS.map((m) => {
              const state = data?.[m.key];
              if (!state || state.state == null) return null;
              const text = m.key === 'gridRuntime'
                ? formatRuntimeHours(state)
                : m.key === 'runMode'
                  ? formatMode(state)
                  : formatValue(toNumber(state), state?.unit).text;
              return (
                <span key={m.key} className="health-chip">
                  <span className="health-label">{m.label}</span>
                  <span className="health-value">{text}</span>
                </span>
              );
            })}
          </div>
        )}
      </div>
      {editMode && (
        <>
          <div className="tile-edit-top">
            <span className="tile-edit-name">Electricity</span>
            <span className="tile-edit-size">{colSpan}×{rowSpan}</span>
          </div>
          <div className="tile-resize" onPointerDown={handleResizeDown} title="Drag to resize" />
        </>
      )}
    </div>
  );
}

// P1 utility meter — grid-side lifetime totals with per-tariff breakdown.
// Distinct from Solax's inverter counters (which are the strip above); the
// values here are what the DSO bills.
function GridMeter({ data }) {
  const fmt = (state) => {
    const n = toNumber(state);
    if (n == null) return { text: '—', unit: '' };
    return formatValue(n, state?.unit || 'kWh');
  };
  const imp = fmt(data?.p1ImportTotal);
  const impT1 = fmt(data?.p1ImportT1);
  const impT2 = fmt(data?.p1ImportT2);
  const exp = fmt(data?.p1ExportTotal);
  const expT1 = fmt(data?.p1ExportT1);
  const expT2 = fmt(data?.p1ExportT2);
  return (
    <div className="grid-meter">
      <div className="grid-meter-title">Grid meter</div>
      <div className="grid-meter-rows">
        <MeterRow label="Import" accent="bad" total={imp} t1={impT1} t2={impT2} />
        <MeterRow label="Export" accent="good" total={exp} t1={expT1} t2={expT2} />
      </div>
    </div>
  );
}

// Electric loads — one-tap toggle chips inside the Electricity tile. Domain
// dispatch (switch/light/input_boolean/script/cover/lock) is done server-side
// in /api/ha/entity/action; we just POST the entityId and let it figure the
// right service out.
function ElectricControls({ controls, onChanged }) {
  const [pending, setPending] = useState({});

  const trigger = async (entity) => {
    if (!entity || pending[entity]) return;
    setPending((p) => ({ ...p, [entity]: true }));
    try {
      await fetch('api/ha/entity/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityId: entity }),
      });
      setTimeout(() => onChanged?.(), 700);
    } catch { /* transient */ }
    finally {
      setTimeout(() => setPending((p) => { const n = { ...p }; delete n[entity]; return n; }), 900);
    }
  };

  return (
    <div className="electric-loads">
      <div className="solar-section-title">Loads</div>
      <div className="electric-loads-grid">
        {controls.map((c) => {
          const s = c.state?.state;
          const on = s === 'on' || s === 'open' || s === 'playing' || s === 'unlocked';
          const off = s === 'off' || s === 'closed' || s === 'idle' || s === 'locked' || s === 'paused';
          const busy = !!pending[c.entity];
          const cls = on ? 'is-on' : off ? 'is-off' : 'is-unknown';
          const domain = (c.entity || '').split('.')[0];
          return (
            <button
              key={c.entity}
              type="button"
              className={`electric-load ${cls} ${busy ? 'is-busy' : ''}`}
              onClick={() => trigger(c.entity)}
              disabled={busy}
              title={c.entity}
            >
              <span className="electric-load-icon">
                <TileIcon iconKey={c.icon} domain={domain} on={on} />
              </span>
              <span className="electric-load-name">{c.name || c.entity}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MeterRow({ label, accent, total, t1, t2 }) {
  return (
    <div className={`grid-meter-row grid-meter-${accent}`}>
      <div className="grid-meter-side">
        <div className="grid-meter-label">{label}</div>
        <div className="grid-meter-total">
          <span className="grid-meter-num">{total.text}</span>
          <span className="grid-meter-unit">{total.unit}</span>
        </div>
      </div>
      <div className="grid-meter-tariffs">
        <span className="grid-meter-tariff">
          <span className="grid-meter-tariff-label">T1</span>
          <span className="grid-meter-tariff-val">{t1.text}</span>
        </span>
        <span className="grid-meter-tariff">
          <span className="grid-meter-tariff-label">T2</span>
          <span className="grid-meter-tariff-val">{t2.text}</span>
        </span>
      </div>
    </div>
  );
}
