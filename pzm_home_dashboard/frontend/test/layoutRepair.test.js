import test from 'node:test';
import assert from 'node:assert/strict';
import { repairLayout } from '../src/lib/layoutRepair.js';

test('clean layout is returned untouched (same object)', () => {
  const layout = { 'custom-1': { col: 1, row: 1, spec: { kind: 'number', unit: '°C', name: 'Café' } }, _theme: { bg: '#000' } };
  const out = repairLayout(layout);
  assert.equal(out.changed, false);
  assert.equal(out.layout, layout);
});

test('mojibake units are healed', () => {
  const out = repairLayout({ a: { col: 1, spec: { kind: 'number', unit: '\u00c2\u00b0C' } } });
  assert.equal(out.changed, true);
  assert.equal(out.layout.a.spec.unit, '°C');
  assert.equal(out.layout.a.col, 1);
});

test('genuine text containing Â is left alone', () => {
  const layout = { a: { spec: { name: 'Â propos' } } };
  assert.equal(repairLayout(layout).changed, false);
});

test('renamed entities are repointed', () => {
  const out = repairLayout({ a: { spec: { entityId: 'light.garage_rgbic_led' } } });
  assert.equal(out.layout.a.spec.entityId, 'light.garage_led_strip');
});

test('repair is idempotent', () => {
  const once = repairLayout({ a: { spec: { unit: '\u00c2\u00b0C' } } }).layout;
  assert.equal(repairLayout(once).changed, false);
});

test('non-object input passes through', () => {
  assert.deepEqual(repairLayout(null), { layout: null, changed: false });
  assert.equal(repairLayout([1]).changed, false);
});
