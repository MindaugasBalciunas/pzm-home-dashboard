import test from 'node:test';
import assert from 'node:assert/strict';
import { findFreeSpot, isFreePlacement, tilePlacementStyle } from '../src/lib/placement.js';

test('empty grid places at the top-left', () => {
  assert.deepEqual(findFreeSpot({}, 6, 6), { col: 1, row: 1 });
});

test('places beside an existing tile on the same row', () => {
  const o = { a: { col: 1, row: 1, colSpan: 6, rowSpan: 6 } };
  assert.deepEqual(findFreeSpot(o, 6, 6), { col: 7, row: 1 });
});

test('wraps below when the row is full', () => {
  const o = { a: { col: 1, row: 1, colSpan: 48, rowSpan: 4 } };
  assert.deepEqual(findFreeSpot(o, 6, 6), { col: 1, row: 5 });
});

test('never places past the right edge', () => {
  const o = { a: { col: 1, row: 1, colSpan: 44, rowSpan: 2 } };
  const spot = findFreeSpot(o, 6, 2);
  assert.ok(spot.col + 6 - 1 <= 48);
  assert.deepEqual(spot, { col: 1, row: 3 });
});

test('hidden tiles and non-tile keys do not block', () => {
  const o = { a: { col: 1, row: 1, colSpan: 48, rowSpan: 4, hidden: true }, _theme: { bg: '#000' }, _seededTemplate: 'v5' };
  assert.deepEqual(findFreeSpot(o, 6, 6), { col: 1, row: 1 });
});

test('fractional (free-placed) tiles block every cell they touch', () => {
  const o = { a: { col: 1.5, row: 1, colSpan: 2, rowSpan: 1 } };
  assert.deepEqual(findFreeSpot(o, 1, 1), { col: 4, row: 1 });
});

test('integer placement uses grid lines, fractional goes absolute', () => {
  assert.equal(isFreePlacement(1, 2, 3, 4), false);
  assert.equal(isFreePlacement(1.5, 2, 3, 4), true);
  assert.deepEqual(tilePlacementStyle(2, 3, 4, 5), { gridColumn: '2 / span 4', gridRow: '3 / span 5' });
  assert.equal(tilePlacementStyle(2.5, 3, 4, 5).position, 'absolute');
});
