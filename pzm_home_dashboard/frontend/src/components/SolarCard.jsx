import { useEffect, useRef, useState } from 'react';

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

// Today Import / Export moved into the Grid callout and Total Solar into
// the Solar callout (top section), so the strip is down to three chips.
const ENERGY_METRICS = [
  { key: 'todaySolar',  label: 'Today Solar',  accent: 'good' },
  { key: 'pv1',         label: 'PV 1',         accent: 'good' },
  { key: 'pv2',         label: 'PV 2',         accent: 'good' },
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

function formatMode(state) {
  if (!state || state.state == null) return '—';
  if (state.state === 'unknown' || state.state === 'unavailable') return '—';
  const s = String(state.state);
  return s.length ? s.charAt(0).toUpperCase() + s.slice(1) : '—';
}

function formatPvSubBits(voltageState, currentState) {
  const v = toNumber(voltageState);
  const a = toNumber(currentState);
  return {
    v: v != null ? `${v.toFixed(0)} V` : null,
    a: a != null ? `${a.toFixed(2)} A` : null,
    any: v != null || a != null,
  };
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
  pv1VoltageState,
  pv2VoltageState,
  pv1CurrentState,
  pv2CurrentState,
  importState,
  exportState,
  houseState,
  p1ImportTotal,
  p1ExportTotal,
  p1ImportT1,
  p1ImportT2,
  p1ExportT1,
  p1ExportT2,
  todaySolarState,
  totalSolarState,
  todayImportState,
  todayExportState,
  solaxTodayImportState,
  solaxTodayExportState,
  solaxTodayHouseState,
  hourlyGrid,
  daily,
  pvPeakW,
  impPeakW,
  expPeakW,
  runModeText,
}) {
  const pv = toNumber(pvState) ?? 0;
  const pv1 = toNumber(pv1State) ?? 0;
  const pv2 = toNumber(pv2State) ?? 0;
  const imp = toNumber(importState) ?? 0;
  const exp = toNumber(exportState) ?? 0;
  const house = toNumber(houseState) ?? 0;
  const pv1Sub = formatPvSubBits(pv1VoltageState, pv1CurrentState);
  const pv2Sub = formatPvSubBits(pv2VoltageState, pv2CurrentState);
  const p1ImpFmt = p1ImportTotal ? formatValue(toNumber(p1ImportTotal), p1ImportTotal?.unit || 'kWh') : null;
  const p1ExpFmt = p1ExportTotal ? formatValue(toNumber(p1ExportTotal), p1ExportTotal?.unit || 'kWh') : null;
  const fmtOrNull = (s) => (s ? formatValue(toNumber(s), s?.unit || 'kWh') : null);
  const p1ImpT1Fmt = fmtOrNull(p1ImportT1);
  const p1ImpT2Fmt = fmtOrNull(p1ImportT2);
  const p1ExpT1Fmt = fmtOrNull(p1ExportT1);
  const p1ExpT2Fmt = fmtOrNull(p1ExportT2);
  const hasImpTariff = (p1ImpT1Fmt && p1ImpT1Fmt.text !== '—') || (p1ImpT2Fmt && p1ImpT2Fmt.text !== '—');
  const hasExpTariff = (p1ExpT1Fmt && p1ExpT1Fmt.text !== '—') || (p1ExpT2Fmt && p1ExpT2Fmt.text !== '—');

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
        {/* Home callout was moved up to (top: 3%, right: 2%) — its bottom
            edge sits around y≈18. The Home flow line now stops at
            (78, 18) so it clearly "arrives" at the callout's left edge
            instead of running underneath a larger callout. Junction
            still at (78, 50), PV bus horizontal at y=26, grid at y=91. */}
        <path d="M 34 11 V 26"
              className={`hv-line ${active(pv2) ? 'hv-line-active' : ''}`}
              style={pv2Line} />
        <path d="M 56 11 V 26"
              className={`hv-line ${active(pv1) ? 'hv-line-active' : ''}`}
              style={pv1Line} />
        <path d="M 34 26 H 78 V 50"
              className={`hv-line ${active(pv) ? 'hv-line-active' : ''}`}
              style={solarBusLine} />
        <path d="M 78 50 V 20 H 84"
              className={`hv-line ${active(house) ? 'hv-line-active' : ''}`}
              style={houseLine} />
        <path d={isImporting ? "M 89 91 V 50 H 78" : "M 78 50 V 91 H 89"}
              className={`hv-line ${(isExporting || isImporting) ? 'hv-line-active' : ''}`}
              style={gridLine} />
      </svg>

      {/* Solar (PV Total) — top-left. Live PV wattage as the marquee
          number; today's cumulative harvest as a small sub-line so the
          "how much did we make today so far" question is answered
          without leaving the diagram. */}
      <div className="hv-callout hv-callout-pv-total">
        <div className="hv-callout-value">
          <span className="hv-callout-num">{pvFmt.text}</span>
          {pvFmt.unit && <span className="hv-callout-unit">{pvFmt.unit}</span>}
        </div>
        <div className="hv-callout-label">
          <span>Solar</span>
          {pvPeakW != null && (() => {
            const p = formatValue(pvPeakW, pvState?.unit || 'W');
            return <span className="hv-peak" title="Peak PV today">Peak↑ {p.text} {p.unit}</span>;
          })()}
        </div>
        {(() => {
          const t = todaySolarState ? formatValue(toNumber(todaySolarState), todaySolarState?.unit || 'kWh') : null;
          const tot = totalSolarState ? formatValue(toNumber(totalSolarState), totalSolarState?.unit || 'kWh') : null;
          const hasT = t && t.text !== '—';
          const hasTot = tot && tot.text !== '—';
          if (!hasT && !hasTot) return null;
          return (
            <div className="hv-cols">
              {hasT && (
                <div className="hv-cell">
                  <span className="hv-cell-tag hv-tag-amber">Today</span>
                  <span className="hv-cell-val hv-val-amber">{t.text}<span className="hv-cell-unit"> {t.unit}</span></span>
                </div>
              )}
              {hasTot && (
                <div className="hv-cell">
                  <span className="hv-cell-tag">Total</span>
                  <span className="hv-cell-val">{tot.text}<span className="hv-cell-unit"> {tot.unit}</span></span>
                </div>
              )}
            </div>
          );
        })()}
        {daily && daily.length > 0 && (
          <>
            <div className="hv-mini-chart" title="Generation, last 7 days">
              <BarChart items={daily} accent="solar" keyPrefix="cd" />
            </div>
            <div className="hv-mini-day-labels">
              {daily.map((d) => <span key={d.key}>{dayInitial(d)}</span>)}
            </div>
            {(() => {
              let maxV = -Infinity, minV = Infinity;
              for (const d of daily) {
                if (d.v > maxV) maxV = d.v;
                if (d.v < minV) minV = d.v;
              }
              if (!Number.isFinite(maxV) || maxV <= 0) return null;
              const mx = formatValue(maxV, 'kWh');
              const mn = formatValue(Math.max(0, minV), 'kWh');
              return (
                <div className="hv-mini-stats">
                  <span className="hv-stat-max" title="Best day (last 7)">↑ {mx.text} {mx.unit}</span>
                  <span className="hv-stat-min" title="Lowest day (last 7)">↓ {mn.text} {mn.unit}</span>
                </div>
              );
            })()}
          </>
        )}
      </div>

      {/* PV 2 — top-left, near left panels. V/A rendered as compact sub-line. */}
      <div className="hv-callout hv-callout-pv2">
        <div className="hv-callout-value">
          <span className="hv-callout-num">{pv2Fmt.text}</span>
          {pv2Fmt.unit && <span className="hv-callout-unit">{pv2Fmt.unit}</span>}
        </div>
        <div className="hv-callout-label">
          <span>PV 2</span>
          <span className="hv-callout-pct">{sum > 5 ? `${pv2Pct}%` : '—'}</span>
        </div>
        {pv2Sub.any && (
          <div className="hv-callout-sub">
            {pv2Sub.v && <span className="hv-sub-chip">{pv2Sub.v}</span>}
            {pv2Sub.a && <span className="hv-sub-chip">{pv2Sub.a}</span>}
          </div>
        )}
      </div>

      {/* PV 1 — top-right, near right panels. V/A rendered as compact sub-line. */}
      <div className="hv-callout hv-callout-pv1">
        <div className="hv-callout-value">
          <span className="hv-callout-num">{pv1Fmt.text}</span>
          {pv1Fmt.unit && <span className="hv-callout-unit">{pv1Fmt.unit}</span>}
        </div>
        <div className="hv-callout-label">
          <span>PV 1</span>
          <span className="hv-callout-pct">{sum > 5 ? `${pv1Pct}%` : '—'}</span>
        </div>
        {pv1Sub.any && (
          <div className="hv-callout-sub">
            {pv1Sub.v && <span className="hv-sub-chip">{pv1Sub.v}</span>}
            {pv1Sub.a && <span className="hv-sub-chip">{pv1Sub.a}</span>}
          </div>
        )}
      </div>

      {/* Home — over the house body. All P1 utility-meter reads (what the
          DSO actually bills on) group here beneath the live house load:
          today's import/export, then lifetime totals with tariff splits. */}
      <div className="hv-callout hv-callout-home">
        <div className="hv-callout-value">
          <span className="hv-callout-num">{houseFmt.text}</span>
          {houseFmt.unit && <span className="hv-callout-unit">{houseFmt.unit}</span>}
        </div>
        <div className="hv-callout-label">Home</div>
        {(() => {
          const impT = todayImportState ? formatValue(toNumber(todayImportState), todayImportState?.unit || 'kWh') : null;
          const expT = todayExportState ? formatValue(toNumber(todayExportState), todayExportState?.unit || 'kWh') : null;
          const hasImpToday = impT && impT.text !== '—';
          const hasExpToday = expT && expT.text !== '—';
          const hasImpTotal = p1ImpFmt && p1ImpFmt.text !== '—';
          const hasExpTotal = p1ExpFmt && p1ExpFmt.text !== '—';
          if (!hasImpToday && !hasExpToday && !hasImpTotal && !hasExpTotal) return null;
          return (
            <div className="hv-cols">
              {hasImpToday && (
                <div className="hv-cell">
                  <span className="hv-cell-tag hv-tag-imp">P1 Imp today</span>
                  <span className="hv-cell-val">{impT.text}<span className="hv-cell-unit"> {impT.unit}</span></span>
                </div>
              )}
              {hasExpToday && (
                <div className="hv-cell">
                  <span className="hv-cell-tag hv-tag-exp">P1 Exp today</span>
                  <span className="hv-cell-val">{expT.text}<span className="hv-cell-unit"> {expT.unit}</span></span>
                </div>
              )}
              {hasImpTotal && (
                <div className="hv-cell">
                  <span className="hv-cell-tag hv-tag-imp">P1 Imp total</span>
                  <span className="hv-cell-val">{p1ImpFmt.text}<span className="hv-cell-unit"> {p1ImpFmt.unit}</span></span>
                  {hasImpTariff && (
                    <div className="hv-p1-tariffs">
                      {p1ImpT1Fmt && p1ImpT1Fmt.text !== '—' && (
                        <span className="hv-p1-tariff"><span className="hv-p1-tariff-tag">T1</span>{p1ImpT1Fmt.text}</span>
                      )}
                      {p1ImpT2Fmt && p1ImpT2Fmt.text !== '—' && (
                        <span className="hv-p1-tariff"><span className="hv-p1-tariff-tag">T2</span>{p1ImpT2Fmt.text}</span>
                      )}
                    </div>
                  )}
                </div>
              )}
              {hasExpTotal && (
                <div className="hv-cell">
                  <span className="hv-cell-tag hv-tag-exp">P1 Exp total</span>
                  <span className="hv-cell-val">{p1ExpFmt.text}<span className="hv-cell-unit"> {p1ExpFmt.unit}</span></span>
                  {hasExpTariff && (
                    <div className="hv-p1-tariffs">
                      {p1ExpT1Fmt && p1ExpT1Fmt.text !== '—' && (
                        <span className="hv-p1-tariff"><span className="hv-p1-tariff-tag">T1</span>{p1ExpT1Fmt.text}</span>
                      )}
                      {p1ExpT2Fmt && p1ExpT2Fmt.text !== '—' && (
                        <span className="hv-p1-tariff"><span className="hv-p1-tariff-tag">T2</span>{p1ExpT2Fmt.text}</span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* Grid — bottom-right corner. Live grid power plus the mirrored
          hourly chart and today's peaks; the P1 daily/lifetime energy
          totals live on the Home callout with the rest of the P1 reads. */}
      <div className={`hv-callout hv-callout-grid ${isExporting ? 'hv-good' : isImporting ? 'hv-bad' : ''}`}>
        <div className="hv-callout-value">
          <span className="hv-callout-num">{gridFmt.text}</span>
          {gridFmt.unit && <span className="hv-callout-unit">{gridFmt.unit}</span>}
        </div>
        <div className="hv-callout-label">
          {isExporting ? 'Export' : isImporting ? 'Import' : 'Grid'}
        </div>
        {(() => {
          const cells = [
            { key: 'imp',   tag: 'Imp',   cls: 'hv-tag-imp',   state: solaxTodayImportState },
            { key: 'exp',   tag: 'Exp',   cls: 'hv-tag-exp',   state: solaxTodayExportState },
            { key: 'house', tag: 'House', cls: 'hv-tag-house', state: solaxTodayHouseState },
          ].map((c) => ({
            ...c,
            fmt: c.state ? formatValue(toNumber(c.state), c.state?.unit || 'kWh') : null,
          })).filter((c) => c.fmt && c.fmt.text !== '—');
          if (cells.length === 0) return null;
          return (
            <div className="hv-cols hv-cols-3">
              <div className="hv-cols-caption">Solax</div>
              {cells.map((c) => (
                <div className="hv-cell" key={c.key}>
                  <span className={`hv-cell-tag ${c.cls}`}>{c.tag}</span>
                  <span className="hv-cell-val">{c.fmt.text}<span className="hv-cell-unit"> {c.fmt.unit}</span></span>
                </div>
              ))}
            </div>
          );
        })()}
        {hourlyGrid && hourlyGrid.length > 0 && (
          <div className="hv-mini-chart" title="By hour — export up, import down">
            <DualBarChart items={hourlyGrid} />
          </div>
        )}
        {(expPeakW != null || impPeakW != null) && (
          <div className="hv-mini-stats">
            {expPeakW != null && (() => {
              const f = formatValue(expPeakW, exportState?.unit || 'W');
              return <span className="hv-stat-up" title="Peak export today">↑ {f.text} {f.unit}</span>;
            })()}
            {impPeakW != null && (() => {
              const f = formatValue(impPeakW, importState?.unit || 'W');
              return <span className="hv-stat-down" title="Peak import today">↓ {f.text} {f.unit}</span>;
            })()}
          </div>
        )}
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

function EnergyChip({ metric, state, samples, hourlyPv }) {
  const v = toNumber(state);
  const { text, unit } = formatValue(v, state?.unit);
  const useHourly = metric.key === 'todaySolar' && hourlyPv && hourlyPv.length > 0;

  let maxLabel = null;
  let maxTitle = '24h peak';
  if (useHourly) {
    let maxV = -Infinity;
    for (const h of hourlyPv) if (Number.isFinite(h.v) && h.v > maxV) maxV = h.v;
    if (Number.isFinite(maxV)) {
      const { text: mt, unit: mu } = formatValue(maxV, 'W');
      maxLabel = mu ? `${mt} ${mu}` : mt;
    }
    maxTitle = 'Peak PV output today';
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
      {useHourly ? (
        <BarChart items={hourlyPv} accent={metric.accent} keyPrefix="h" />
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

// Generic bar-per-bucket chart used for both weekly (last 7 days) and
// hourly (today so far) breakdowns. `items` is [{key, v}]; each entry
// becomes one bar sized against the tallest bar in the set.
function BarChart({ items, accent, keyPrefix }) {
  if (!items || items.length === 0) return null;
  const w = 100, h = 30;
  let maxV = 0;
  for (const it of items) if (it.v > maxV) maxV = it.v;
  if (maxV <= 0) maxV = 1;
  const slot = w / items.length;
  const pad = 0.18;
  const barW = slot * (1 - 2 * pad);
  return (
    <svg
      className={`today-graph today-graph-${accent}`}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
    >
      {items.map((it, i) => {
        const barH = (it.v / maxV) * (h - 1);
        const x = i * slot + slot * pad;
        const y = h - barH;
        return (
          <rect
            key={`${keyPrefix}-${it.key ?? i}`}
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

// Bucket a 24 h stream of pvTotal power samples ({t: ms, v: W}) into
// per-hour averages. Wh is what actually equals kWh once summed —
// average W over an hour ≈ Wh over that hour, so a bar's height reads
// as "how much did we make that hour". Trims trailing empty hours so
// the chart doesn't lie flat past the current hour.
function bucketByHour(samples) {
  if (!samples || samples.length === 0) return [];
  const buckets = Array.from({ length: 24 }, () => ({ sum: 0, count: 0 }));
  for (const s of samples) {
    if (!s || !Number.isFinite(s.t) || !Number.isFinite(s.v)) continue;
    const h = new Date(s.t).getHours();
    if (h >= 0 && h < 24) {
      buckets[h].sum += s.v;
      buckets[h].count += 1;
    }
  }
  let lastActive = -1;
  const items = buckets.map((b, h) => {
    const avg = b.count > 0 ? b.sum / b.count : 0;
    if (avg > 0) lastActive = h;
    return { key: h, v: avg };
  });
  const cut = Math.max(lastActive + 1, 1);
  return items.slice(0, cut);
}

// Bucket the /solar/daily payload into last-N-days chart items, keyed
// by YYYY-MM-DD so React can match bars stably across polls. Carries the
// date parts so the Solar callout can print weekday initials under bars.
function bucketByDay(days) {
  if (!days || days.length === 0) return [];
  return days.map((d) => ({
    key: `${d.year}-${d.month}-${d.day}`,
    v: Math.max(0, Number(d.v) || 0),
    year: d.year,
    month: d.month,
    day: d.day,
  }));
}

function dayInitial(item) {
  return new Date(item.year, item.month - 1, item.day)
    .toLocaleDateString(undefined, { weekday: 'narrow' });
}

// True (un-bucketed) peak of a since-midnight sample stream; null when
// there's no usable sample so callers can hide the annotation.
function peakOf(samples) {
  let m = null;
  for (const s of samples || []) {
    const v = typeof s === 'number' ? s : s?.v;
    if (Number.isFinite(v) && (m == null || v > m)) m = v;
  }
  return m;
}

// Bucket import + export power histories into aligned per-hour averages
// (midnight → current hour) for the mirrored grid chart. Both series must
// share the hour axis, so they're cut at the same point.
function bucketPairByHour(impSamples, expSamples) {
  const mk = () => Array.from({ length: 24 }, () => ({ sum: 0, count: 0 }));
  const fill = (samples, buckets) => {
    let any = false;
    for (const s of samples || []) {
      if (!s || !Number.isFinite(s.t) || !Number.isFinite(s.v)) continue;
      const h = new Date(s.t).getHours();
      if (h >= 0 && h < 24) {
        buckets[h].sum += s.v;
        buckets[h].count += 1;
        any = true;
      }
    }
    return any;
  };
  const impB = mk();
  const expB = mk();
  const anyImp = fill(impSamples, impB);
  const anyExp = fill(expSamples, expB);
  if (!anyImp && !anyExp) return [];
  const cut = new Date().getHours() + 1;
  const items = [];
  for (let h = 0; h < cut; h++) {
    items.push({
      key: h,
      imp: impB[h].count ? Math.max(0, impB[h].sum / impB[h].count) : 0,
      exp: expB[h].count ? Math.max(0, expB[h].sum / expB[h].count) : 0,
    });
  }
  return items;
}

// Mirrored hourly grid chart: export grows up from the axis (green),
// import grows down (red). Position — not color alone — separates the
// two series, and both scale against the same max so heights compare.
function DualBarChart({ items }) {
  if (!items || items.length === 0) return null;
  const w = 100, h = 30;
  const mid = h / 2;
  let maxV = 0;
  for (const it of items) {
    if (it.imp > maxV) maxV = it.imp;
    if (it.exp > maxV) maxV = it.exp;
  }
  if (maxV <= 0) maxV = 1;
  const slot = w / items.length;
  const pad = 0.18;
  const barW = slot * (1 - 2 * pad);
  return (
    <svg className="dual-graph" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      {items.map((it, i) => {
        const x = (i * slot + slot * pad).toFixed(2);
        const expH = (it.exp / maxV) * (mid - 1);
        const impH = (it.imp / maxV) * (mid - 1);
        return (
          <g key={`ie-${it.key}`}>
            {expH > 0.05 && (
              <rect className="dual-graph-exp" x={x} y={(mid - expH).toFixed(2)}
                    width={barW.toFixed(2)} height={expH.toFixed(2)} rx="0.4" />
            )}
            {impH > 0.05 && (
              <rect className="dual-graph-imp" x={x} y={mid.toFixed(2)}
                    width={barW.toFixed(2)} height={impH.toFixed(2)} rx="0.4" />
            )}
          </g>
        );
      })}
      <line className="dual-graph-axis" x1="0" y1={mid} x2={w} y2={mid} />
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
    load();
    timerRef.current = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timerRef.current);
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
    const loadDaily = async () => {
      try {
        const r = await fetch('api/ha/solar/daily?days=7');
        if (!r.ok) return;
        const j = await r.json();
        if (cancelled) return;
        setMonthly(Array.isArray(j?.days) ? j.days : []);
      } catch { /* transient */ }
    };
    loadDaily();
    monthlyTimerRef.current = setInterval(loadDaily, 30 * 60 * 1000);
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
      <div className="solar-inner solar-inner-titleless">
        {error && <div className="solar-note solar-note-error">Fetch error</div>}
        {!error && !configured && (
          <div className="solar-note">Set Home Assistant token in appsettings.json to see live data.</div>
        )}

        <div className="solar-flow solar-flow-photo">
          <HouseView
            pvState={data?.pvTotal}
            pv1State={data?.pv1}
            pv2State={data?.pv2}
            pv1VoltageState={data?.pv1Voltage}
            pv2VoltageState={data?.pv2Voltage}
            pv1CurrentState={data?.pv1Current}
            pv2CurrentState={data?.pv2Current}
            importState={data?.import}
            exportState={data?.export}
            houseState={data?.houseUse}
            p1ImportTotal={data?.p1ImportTotal}
            p1ExportTotal={data?.p1ExportTotal}
            p1ImportT1={data?.p1ImportT1}
            p1ImportT2={data?.p1ImportT2}
            p1ExportT1={data?.p1ExportT1}
            p1ExportT2={data?.p1ExportT2}
            todaySolarState={data?.todaySolar}
            totalSolarState={data?.totalSolar}
            todayImportState={data?.todayImport}
            todayExportState={data?.todayExport}
            solaxTodayImportState={data?.solaxTodayImport}
            solaxTodayExportState={data?.solaxTodayExport}
            solaxTodayHouseState={data?.solaxTodayHouse}
            hourlyGrid={bucketPairByHour(history24h?.import, history24h?.export)}
            daily={bucketByDay(monthly)}
            pvPeakW={peakOf(history24h?.pvTotal)}
            impPeakW={peakOf(history24h?.import)}
            expPeakW={peakOf(history24h?.export)}
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
              hourlyPv={m.key === 'todaySolar' ? bucketByHour(history24h?.pvTotal) : null}
            />
          ))}
        </div>
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

