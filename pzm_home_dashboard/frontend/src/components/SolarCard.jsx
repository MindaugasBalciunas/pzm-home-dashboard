import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { startPolling } from '../lib/poll.js';

const POLL_MS = 3000;

// House photo variants: public/ ships one render per season × day-phase
// (16 total, `<season>-<phase>.png`). The live card picks by wall clock;
// the BG demo loop (Experiments menu) cycles through all of them.
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const DAY_PHASES = ['morning', 'day', 'evening', 'night'];

function seasonForMonth(m) {
  if (m === 11 || m <= 1) return 'winter';
  if (m <= 4) return 'spring';
  if (m <= 7) return 'summer';
  return 'autumn';
}

function phaseForHour(h) {
  if (h < 6) return 'night';
  if (h < 11) return 'morning';
  if (h < 17) return 'day';
  if (h < 22) return 'evening';
  return 'night';
}

function backgroundForNow(now = new Date()) {
  const season = seasonForMonth(now.getMonth());
  const phase = phaseForHour(now.getHours());
  return { file: `${season}-${phase}.png`, label: `${season} · ${phase}` };
}

const DEMO_BACKGROUNDS = SEASONS.flatMap((season) =>
  DAY_PHASES.map((phase) => ({
    file: `${season}-${phase}.png`,
    label: `${season} · ${phase}`,
  })));
const DEMO_STEP_MS = 2000;

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

function flowDur(v) {
  const w = Math.max(50, Math.min(6000, Math.abs(v || 0)));
  return `${Math.max(0.4, 2.6 - Math.log10(w) * 0.4).toFixed(2)}s`;
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
  bgImage = 'house.png',
  bgLabel = null,
  editMode = false,
  flowPoint = null,
  onFlowPointChange = null,
  calloutPos = null,
  onCalloutPosChange = null,
}) {
  // Previous background stays mounted beneath the incoming one so image
  // swaps (hour/season boundaries, demo loop) crossfade instead of pop.
  const prevBgRef = useRef(bgImage);
  const prevBg = prevBgRef.current;
  useEffect(() => { prevBgRef.current = bgImage; }, [bgImage]);

  // Junction where the solar bus / house feed / grid legs meet, in the
  // flow svg's 0–100 coordinate space. User-adjustable in edit mode.
  const rootRef = useRef(null);
  const clampN = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const jx = clampN(Number(flowPoint?.x) || 78, 5, 95);
  const jy = clampN(Number(flowPoint?.y) || 50, 10, 90);
  const onJunctionDown = (e) => {
    if (!editMode || !onFlowPointChange) return;
    e.stopPropagation();
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect || rect.width < 1 || rect.height < 1) return;
    const move = (ev) => {
      const x = ((ev.clientX - rect.left) / rect.width) * 100;
      const y = ((ev.clientY - rect.top) / rect.height) * 100;
      onFlowPointChange({
        x: Math.round(clampN(x, 5, 95)),
        y: Math.round(clampN(y, 10, 90)),
      });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  // Callout cards are repositionable in edit mode. Custom positions are
  // stored as left/top percentages of the house view; when unset, the
  // stylesheet's default anchors apply.
  const posStyle = (key) => {
    const p = calloutPos?.[key];
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return undefined;
    return { left: `${p.x}%`, top: `${p.y}%`, right: 'auto', bottom: 'auto', transform: 'none' };
  };
  const beginCalloutDrag = (e, key) => {
    if (!editMode || !onCalloutPosChange) return;
    e.stopPropagation();
    e.preventDefault();
    const rect = rootRef.current?.getBoundingClientRect();
    const elRect = e.currentTarget.getBoundingClientRect();
    if (!rect || rect.width < 1 || rect.height < 1) return;
    // Keep the grab point under the pointer so the card doesn't jump when
    // a CSS-anchored (right/bottom/translate) position becomes a custom one.
    const grabDx = e.clientX - elRect.left;
    const grabDy = e.clientY - elRect.top;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const maxX = Math.max(0, 100 - (elRect.width / rect.width) * 100);
    const maxY = Math.max(0, 100 - (elRect.height / rect.height) * 100);
    const move = (ev) => {
      const x = ((ev.clientX - grabDx - rect.left) / rect.width) * 100;
      const y = ((ev.clientY - grabDy - rect.top) / rect.height) * 100;
      onCalloutPosChange(key, {
        x: Math.round(clampN(x, 0, maxX) * 10) / 10,
        y: Math.round(clampN(y, 0, maxY) * 10) / 10,
      });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };
  const calloutProps = (key) => ({
    ref: (el) => { calloutRefs.current[key] = el; },
    style: posStyle(key),
    ...(editMode && onCalloutPosChange
      ? { onPointerDown: (e) => beginCalloutDrag(e, key) }
      : {}),
  });

  // Each flow line runs from its callout card to the junction dot as an
  // "L" (vertical + horizontal legs), so lines follow the cards wherever
  // they're dragged. Card anchors (centres, in the 0–100 flow space) were
  // previously measured after EVERY render — a forced reflow on each 3 s
  // poll. Now a ResizeObserver watches the view and the callout cards, so
  // measurement only happens when a size actually changes (data making a
  // card grow, tile resize, font load); position-only changes are covered
  // by the calloutPos effect below.
  const calloutRefs = useRef({});
  const [anchors, setAnchors] = useState({});
  const measureAnchors = useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect || rect.width < 1 || rect.height < 1) return;
    const next = {};
    for (const [k, el] of Object.entries(calloutRefs.current)) {
      if (!el) continue;
      const r = el.getBoundingClientRect();
      next[k] = {
        cx: ((r.left + r.width / 2 - rect.left) / rect.width) * 100,
        cy: ((r.top + r.height / 2 - rect.top) / rect.height) * 100,
        left: ((r.left - rect.left) / rect.width) * 100,
        bottom: ((r.bottom - rect.top) / rect.height) * 100,
      };
    }
    setAnchors((prev) => {
      const keys = Object.keys(next);
      if (keys.length === Object.keys(prev).length
          && keys.every((k) => prev[k]
            && Math.abs(prev[k].cx - next[k].cx) < 0.3
            && Math.abs(prev[k].cy - next[k].cy) < 0.3
            && Math.abs(prev[k].bottom - next[k].bottom) < 0.3)) {
        return prev;
      }
      return next;
    });
  }, []);
  useEffect(() => {
    measureAnchors();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measureAnchors);
    if (rootRef.current) ro.observe(rootRef.current);
    for (const el of Object.values(calloutRefs.current)) {
      if (el) ro.observe(el);
    }
    return () => ro.disconnect();
  }, [measureAnchors]);
  // Dragging a callout changes its position without changing its size, so
  // the observer stays quiet — re-measure explicitly.
  useEffect(() => { measureAnchors(); }, [calloutPos, measureAnchors]);
  const anchor = (key, fallback) => {
    const p = anchors[key];
    return p && Number.isFinite(p.cx) && Number.isFinite(p.cy) ? p : fallback;
  };

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
    <div className="house-view" ref={rootRef}>
      {/* Background is set inline so the URL resolves against the document base
          rather than the CSS file location — under HAOS ingress the stylesheet
          lives in /assets/, but the photos sit next to index.html. */}
      {prevBg !== bgImage && (
        <div
          className="house-view-bg"
          style={{ backgroundImage: `url('${prevBg}')` }}
        />
      )}
      <div
        key={bgImage}
        className="house-view-bg house-view-bg-fade"
        style={{ backgroundImage: `url('${bgImage}')` }}
      />
      {bgLabel && <div className="hv-bg-pill">{bgLabel}</div>}

      {/*
        Straight vertical/horizontal segments only. The junction where the
        solar bus, house feed and grid legs meet is user-adjustable in edit
        mode (drag the ring) because the cover-cropped photo shifts under
        the lines with tile shape; it persists as flowX/flowY on the tile.
      */}
      <svg className="house-view-flow" viewBox="0 0 100 100" preserveAspectRatio="none">
        {(() => {
          const solA = anchor('pvTotal', { cx: 12, cy: 10, left: 2, bottom: 20 });
          const pv2A = anchor('pv2', { cx: 36, cy: 6, left: 30, bottom: 12 });
          const pv1A = anchor('pv1', { cx: 58, cy: 6, left: 52, bottom: 12 });
          const homA = anchor('home', { cx: 88, cy: 8, left: 78, bottom: 16 });
          const grdA = anchor('grid', { cx: 88, cy: 80, left: 78, bottom: 90 });
          // Solar cards drop a short leg from their bottom edge onto a
          // shared horizontal bus, which feeds the junction — so the first
          // turn stays close to each card and the legs merge into one run.
          // Home / Grid legs attach at their card's LEFT edge, approached
          // horizontally; direction of travel follows the energy.
          const busY = clampN(
            Math.max(solA.bottom, pv1A.bottom, pv2A.bottom) + 2.5, 4, jy - 2);
          const busX1 = Math.min(solA.cx, pv1A.cx, pv2A.cx, jx);
          const busX2 = Math.max(solA.cx, pv1A.cx, pv2A.cx, jx);
          return (
            <>
              <path d={`M ${pv2A.cx} ${pv2A.bottom} V ${busY}`}
                    className={`hv-line ${active(pv2) ? 'hv-line-active' : ''}`}
                    style={pv2Line} />
              <path d={`M ${pv1A.cx} ${pv1A.bottom} V ${busY}`}
                    className={`hv-line ${active(pv1) ? 'hv-line-active' : ''}`}
                    style={pv1Line} />
              <path d={`M ${solA.cx} ${solA.bottom} V ${busY} M ${busX1} ${busY} H ${busX2} M ${jx} ${busY} V ${jy}`}
                    className={`hv-line ${active(pv) ? 'hv-line-active' : ''}`}
                    style={solarBusLine} />
              <path d={`M ${jx} ${jy} V ${homA.cy} H ${homA.left}`}
                    className={`hv-line ${active(house) ? 'hv-line-active' : ''}`}
                    style={houseLine} />
              <path d={isImporting
                      ? `M ${grdA.left} ${grdA.cy} H ${jx} V ${jy}`
                      : `M ${jx} ${jy} V ${grdA.cy} H ${grdA.left}`}
                    className={`hv-line ${(isExporting || isImporting) ? 'hv-line-active' : ''}`}
                    style={gridLine} />
            </>
          );
        })()}
      </svg>

      {/* Edit mode: draggable junction handle. stopPropagation so grabbing
          it never lifts / drags the whole tile. */}
      {editMode && (
        <div
          className="hv-junction"
          style={{ left: `${jx}%`, top: `${jy}%` }}
          onPointerDown={onJunctionDown}
          title="Drag to move the flow junction"
        >
          <span className="hv-junction-dot" />
        </div>
      )}

      {/* Solar (PV Total) — top-left. Live PV wattage as the marquee
          number; today's cumulative harvest as a small sub-line so the
          "how much did we make today so far" question is answered
          without leaving the diagram. */}
      <div className="hv-callout hv-callout-pv-total" {...calloutProps('pvTotal')}>
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
      <div className="hv-callout hv-callout-pv2" {...calloutProps('pv2')}>
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
      <div className="hv-callout hv-callout-pv1" {...calloutProps('pv1')}>
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
      <div className="hv-callout hv-callout-home" {...calloutProps('home')}>
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
      <div
        className={`hv-callout hv-callout-grid ${isExporting ? 'hv-good' : isImporting ? 'hv-bad' : ''}`}
        {...calloutProps('grid')}
      >
        <div className="hv-callout-value">
          <span className="hv-callout-num">{gridFmt.text}</span>
          {gridFmt.unit && <span className="hv-callout-unit">{gridFmt.unit}</span>}
        </div>
        <div className="hv-callout-label">
          {isExporting ? 'Export' : isImporting ? 'Import' : 'Grid'}
        </div>
        {(() => {
          // Solax daily stats. Each cell falls back so the block never
          // silently vanishes when a dedicated sensor is missing:
          // imp/exp fall back to the today_* entities (Solax dailies by
          // default) and House-today is derived from the energy balance
          // (solar + import − export) when no sensor provides it.
          const impN = toNumber(solaxTodayImportState) ?? toNumber(todayImportState);
          const expN = toNumber(solaxTodayExportState) ?? toNumber(todayExportState);
          let houseN = toNumber(solaxTodayHouseState);
          if (houseN == null) {
            const sol = toNumber(todaySolarState);
            if (sol != null && impN != null && expN != null) {
              houseN = Math.max(0, sol + impN - expN);
            }
          }
          const cells = [
            { key: 'imp',   tag: 'Imp',   cls: 'hv-tag-imp',   v: impN },
            { key: 'exp',   tag: 'Exp',   cls: 'hv-tag-exp',   v: expN },
            { key: 'house', tag: 'House', cls: 'hv-tag-house', v: houseN },
          ].map((c) => ({ ...c, fmt: formatValue(c.v, 'kWh') }))
            .filter((c) => c.fmt.text !== '—');
          if (cells.length === 0) return null;
          return (
            <div className="hv-cols hv-cols-3">
              <div className="hv-cols-caption">Solax today</div>
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

function SolarCard({
  col, row, colSpan, rowSpan, editMode,
  onStartMove, onStartResize,
  bgDemo = false,
  flowX = null,
  flowY = null,
  onFlowPointChange = null,
  calloutPos = null,
  onCalloutPosChange = null,
}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [history24h, setHistory24h] = useState({});
  const [monthly, setMonthly] = useState([]);
  const [demoIdx, setDemoIdx] = useState(0);
  // Raw payload of the last snapshot poll. Comparing response text before
  // parsing lets a quiet system (overnight: PV 0, nothing moving) skip the
  // setData entirely — no re-render of the whole card every 3 s.
  const lastPayloadRef = useRef('');

  // Experiments → BG demo loop: cycle every season × day-phase variant.
  useEffect(() => {
    if (!bgDemo) return undefined;
    setDemoIdx(0);
    const id = setInterval(() => setDemoIdx((i) => i + 1), DEMO_STEP_MS);
    return () => clearInterval(id);
  }, [bgDemo]);

  // Wall-clock background. Checked once a minute; the state only changes
  // when the photo actually swaps (hour/season boundary), so the check
  // itself never causes a re-render. Needed because data polls no longer
  // re-render the card when the payload is unchanged (quiet nights).
  const [bgNow, setBgNow] = useState(backgroundForNow);
  useEffect(() => {
    const id = setInterval(() => {
      setBgNow((prev) => {
        const next = backgroundForNow();
        return next.file === prev.file ? prev : next;
      });
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  const bg = bgDemo
    ? DEMO_BACKGROUNDS[demoIdx % DEMO_BACKGROUNDS.length]
    : bgNow;

  useEffect(() => startPolling(async () => {
    try {
      const r = await fetch('api/ha/solar');
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

  useEffect(() => startPolling(async () => {
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
  }, 5 * 60 * 1000), []);

  useEffect(() => startPolling(async () => {
    try {
      const r = await fetch('api/ha/solar/daily?days=7');
      if (!r.ok) return;
      const j = await r.json();
      setMonthly(Array.isArray(j?.days) ? j.days : []);
    } catch { /* transient */ }
  }, 30 * 60 * 1000), []);

  // Bucketing walks every history sample; key it to the 5-minutely history
  // payload instead of redoing the work on each 3 s snapshot render.
  const hourlyGrid = useMemo(
    () => bucketPairByHour(history24h?.import, history24h?.export),
    [history24h],
  );
  const hourlyPv = useMemo(() => bucketByHour(history24h?.pvTotal), [history24h]);
  const daily = useMemo(() => bucketByDay(monthly), [monthly]);
  const pvPeakW = useMemo(() => peakOf(history24h?.pvTotal), [history24h]);
  const impPeakW = useMemo(() => peakOf(history24h?.import), [history24h]);
  const expPeakW = useMemo(() => peakOf(history24h?.export), [history24h]);

  const flowPoint = useMemo(
    () => (flowX != null || flowY != null ? { x: flowX, y: flowY } : null),
    [flowX, flowY],
  );

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
            hourlyGrid={hourlyGrid}
            daily={daily}
            pvPeakW={pvPeakW}
            impPeakW={impPeakW}
            expPeakW={expPeakW}
            bgImage={bg.file}
            bgLabel={bgDemo ? bg.label : null}
            editMode={editMode}
            flowPoint={flowPoint}
            onFlowPointChange={onFlowPointChange}
            calloutPos={calloutPos}
            onCalloutPosChange={onCalloutPosChange}
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
              hourlyPv={m.key === 'todaySolar' ? hourlyPv : null}
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

export default memo(SolarCard);
